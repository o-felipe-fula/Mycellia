// E4.3 (Spec 31): editor NATIVO de .canvas — JSON Canvas (jsoncanvas.org), o formato do
// Obsidian Canvas. Evolução do viewer do E4.1: renderer próprio leve (nós como divs
// posicionados + arestas em SVG, pan/zoom por transform CSS) + edição com round-trip
// sagrado (parse/serialize em utils/jsonCanvas preserva campos desconhecidos e mimetiza
// o writer do Obsidian ⇒ diff mínimo no git do vault).
// Save = pipeline sagrado INTEIRO (onChange → updateActiveNoteContent → pendingSave →
// write atômico). Dirty POR CONSTRUÇÃO: onChange só dispara em commit de mutação real
// (fim de drag com delta, delete, undo/redo, ...) — pan/zoom/seleção NUNCA geram write.
// Semântica de interação = Obsidian: clique seleciona, duplo-clique age (navegar/editar).
import { useEffect, useRef, useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { Shapes, FileText, File as FileIcon, Link2, Image as ImageIcon } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import i18n from '../i18n';
import { getFileKind, getExtension } from '../utils/fileKind';
import { renderMarkdownFragment } from '../utils/exportNote';
import { findFileInTree, findFilePathInTree } from '../editor/utils';
import {
  parseScene,
  serializeScene,
  cloneScene,
  removeNode,
  removeEdge,
  moveNodes,
  withFields,
  withoutField,
  newCanvasId,
  num,
  str,
  type Raw,
  type RawScene,
} from '../utils/jsonCanvas';

interface CanvasEditorProps {
  content: string;
  onChange: (value: string) => void;
}

// ── Views tipadas por cima dos objetos crus (o cru é a fonte de verdade do save) ──
type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
function asSide(v: string | undefined): Side | undefined {
  return SIDES.includes(v as Side) ? (v as Side) : undefined;
}

interface NodeView {
  raw: Raw;
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
}
function toNodeView(raw: Raw): NodeView {
  return {
    raw,
    id: str(raw, 'id') ?? '',
    type: str(raw, 'type') ?? 'text',
    x: num(raw, 'x'),
    y: num(raw, 'y'),
    width: num(raw, 'width'),
    height: num(raw, 'height'),
    color: str(raw, 'color'),
    text: str(raw, 'text'),
    file: str(raw, 'file'),
    url: str(raw, 'url'),
    label: str(raw, 'label'),
  };
}

interface EdgeView {
  raw: Raw;
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  label?: string;
  color?: string;
}
function toEdgeView(raw: Raw): EdgeView {
  return {
    raw,
    id: str(raw, 'id') ?? '',
    fromNode: str(raw, 'fromNode') ?? '',
    toNode: str(raw, 'toNode') ?? '',
    fromSide: asSide(str(raw, 'fromSide')),
    toSide: asSide(str(raw, 'toSide')),
    label: str(raw, 'label'),
    color: str(raw, 'color'),
  };
}

// Paleta oficial do Obsidian Canvas ("1".."6") + passthrough de hex
const PALETTE: Record<string, string> = {
  '1': '#fb464c',
  '2': '#e9973f',
  '3': '#e0de71',
  '4': '#44cf6e',
  '5': '#53dfdd',
  '6': '#a882ff',
};
function canvasColor(c?: string): string | null {
  if (!c) return null;
  return PALETTE[c] ?? (c.startsWith('#') ? c : null);
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

// Paths de nó file no JSON Canvas são relativos à RAIZ do vault (semântica do Obsidian)
function joinVaultPath(vault: string, rel: string): string {
  const sep = vault.includes('\\') ? '\\' : '/';
  return vault.replace(/[\\/]+$/, '') + sep + rel.replace(/[\\/]+/g, sep);
}

const NORMALS: Record<Side, [number, number]> = {
  top: [0, -1],
  bottom: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

function anchorPoint(n: NodeView, side: Side): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: n.x + n.width / 2, y: n.y };
    case 'bottom':
      return { x: n.x + n.width / 2, y: n.y + n.height };
    case 'left':
      return { x: n.x, y: n.y + n.height / 2 };
    case 'right':
      return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

// Sem fromSide/toSide no arquivo: escolhe o par de lados pelo eixo dominante entre os centros
function pickSides(a: NodeView, b: NodeView): [Side, Side] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

interface EdgeGeometry {
  d: string;
  arrow: string;
  mid: { x: number; y: number };
}

// Bezier cúbica saindo perpendicular aos lados (visual do Obsidian) + seta manual no destino
function edgeGeometry(from: { x: number; y: number }, fromSide: Side, to: { x: number; y: number }, toSide: Side): EdgeGeometry {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const k = Math.min(160, Math.max(40, dist * 0.4));
  const [fnx, fny] = NORMALS[fromSide];
  const [tnx, tny] = NORMALS[toSide];
  const c1 = { x: from.x + fnx * k, y: from.y + fny * k };
  const c2 = { x: to.x + tnx * k, y: to.y + tny * k };
  const d = `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;

  // Seta: triângulo alinhado à tangente final (direção c2 → destino)
  const tx = to.x - c2.x;
  const ty = to.y - c2.y;
  const len = Math.hypot(tx, ty) || 1;
  const ux = tx / len;
  const uy = ty / len;
  const size = 10;
  const bx = to.x - ux * size;
  const by = to.y - uy * size;
  const arrow = `M ${to.x} ${to.y} L ${bx - uy * (size / 2)} ${by + ux * (size / 2)} L ${bx + uy * (size / 2)} ${by - ux * (size / 2)} Z`;

  // Ponto médio da cúbica em t=0.5: (p0 + 3c1 + 3c2 + p3) / 8 — âncora do label
  const mid = {
    x: (from.x + 3 * c1.x + 3 * c2.x + to.x) / 8,
    y: (from.y + 3 * c1.y + 3 * c2.y + to.y) / 8,
  };
  return { d, arrow, mid };
}

// Resultado da resolução de um nó `file` contra o vault ATUAL (ver resolveFileNode)
interface FileNodeTarget {
  abs: string;
  missing: boolean;
}

// ── Card de nó `file`: preview de .md (mesmo pipeline do export), <img> pra imagem,
//    ícone+nome pro resto. Duplo-clique navega (openTab) ou delega (app padrão). ──
function FileNodeCard({ relPath, target }: { relPath: string; target: FileNodeTarget }) {
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const name = relPath.split(/[\\/]/).pop() || relPath;
  const ext = getExtension(relPath);
  const { abs, missing } = target;
  const kind = getFileKind(abs);

  useEffect(() => {
    let cancelled = false;
    setPreviewHtml(null);
    if (missing || kind !== 'markdown') return;
    invoke<string>('read_file', { path: abs })
      .then((raw) => {
        if (!cancelled) setPreviewHtml(renderMarkdownFragment(raw));
      })
      .catch(() => {
        // Preview é cosmético: falhou a leitura → card fica só com o nome (sem toast)
      });
    return () => {
      cancelled = true;
    };
  }, [abs, kind, missing]);

  if (missing) {
    return (
      <div className="w-full h-full flex flex-col overflow-hidden">
        <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-[var(--text-secondary)] border-b border-[var(--border-subtle)] select-none">
          {kind === 'markdown' ? <FileText className="w-3.5 h-3.5 flex-shrink-0" /> : <FileIcon className="w-3.5 h-3.5 flex-shrink-0" />}
          <span className="truncate">{name}</span>
        </div>
        <div className="flex-1 flex items-center justify-center px-3 text-xs italic text-[var(--text-muted)] select-none text-center">
          {i18n.t('canvas.notFound')}
        </div>
      </div>
    );
  }

  if (IMAGE_EXTS.has(ext)) {
    return (
      <div className="w-full h-full flex flex-col overflow-hidden">
        <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--text-muted)] border-b border-[var(--border-subtle)] select-none">
          <ImageIcon className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{name}</span>
        </div>
        <img src={convertFileSrc(abs)} alt={name} className="flex-1 min-h-0 w-full object-contain" draggable={false} />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-[var(--text-secondary)] border-b border-[var(--border-subtle)] select-none">
        {kind === 'markdown' ? <FileText className="w-3.5 h-3.5 flex-shrink-0" /> : <FileIcon className="w-3.5 h-3.5 flex-shrink-0" />}
        <span className="truncate">{name}</span>
      </div>
      {previewHtml !== null ? (
        <div
          className="canvas-md flex-1 min-h-0 overflow-hidden px-3 py-2 text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-muted)] select-none">{ext || 'arquivo'}</div>
      )}
    </div>
  );
}

type Selection = { kind: 'node' | 'edge'; id: string } | null;
type Corner = 'nw' | 'ne' | 'sw' | 'se';
const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];
const MIN_NODE_SIZE = 40;
const UNDO_CAP = 100;

// Edição inline em curso: texto de nó text, label de aresta ou label de grupo
type EditingState =
  | { kind: 'node-text'; id: string; draft: string }
  | { kind: 'edge-label'; id: string; draft: string }
  | { kind: 'group-label'; id: string; draft: string };

// Input flutuante de label (aresta/grupo): Enter commita, Esc cancela, blur commita
function LabelInput({
  left,
  top,
  width,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  left: number;
  top: number;
  width: number;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      data-testid="canvas-label-input"
      autoFocus
      className="absolute z-10 px-1.5 py-0.5 text-xs font-semibold rounded border border-[var(--accent)] bg-[var(--substrate-raised)] text-[var(--text-primary)] outline-none"
      style={{ left, top, width }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onCancel();
        else if (e.key === 'Enter') onCommit();
      }}
      onBlur={onCommit}
    />
  );
}

export default function CanvasEditor({ content, onChange }: CanvasEditorProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  // Parse 1x por montagem (key={activeTab} no FileViewer): o estado canônico da cena vive
  // AQUI enquanto a aba está ativa — re-parsear a cada prop criaria loop save→prop→remount.
  const [scene, setScene] = useState<RawScene | null>(() => parseScene(content));
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState({ tx: 60, ty: 60, s: 1 });
  const [editing, setEditing] = useState<EditingState | null>(null);
  // Aresta em criação (drag de um ponto de conexão): preview + hit-test no drop
  const [edgeDraft, setEdgeDraft] = useState<{ fromId: string; fromSide: Side; end: { x: number; y: number } } | null>(null);

  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const panRef = useRef<{ x: number; y: number } | null>(null);
  const panMovedRef = useRef(false);
  const nodeDragRef = useRef<{
    origins: Map<string, { x: number; y: number }>;
    startX: number;
    startY: number;
    moved: boolean;
    preDrag: RawScene;
  } | null>(null);
  const resizeRef = useRef<{
    id: string;
    corner: Corner;
    orig: { x: number; y: number; w: number; h: number };
    startX: number;
    startY: number;
    moved: boolean;
    preDrag: RawScene;
  } | null>(null);
  const undoRef = useRef<RawScene[]>([]);
  const redoRef = useRef<RawScene[]>([]);
  const notifiedRef = useRef(false);

  const { openTab, openInDefaultApp, currentVault, fileTree, activeTab } = useAppStore();
  const filename = activeTab ? activeTab.split(/[\\/]/).pop() || '' : '';

  // Nós `file` guardam o path relativo da ÉPOCA em que o canvas foi salvo no Obsidian.
  // Vault reorganizado desde então ⇒ caminho morto com o arquivo vivo em outra pasta.
  // Fallback com a MESMA semântica dos wiki-links (F4, exato-primeiro): 1) path exato
  // relativo à raiz → 2) basename na árvore inteira → 3) marcado como inexistente.
  // Sem árvore carregada, segue otimista no path exato (read fail-soft cobre o resto).
  const resolveFileNode = (relPath: string): FileNodeTarget => {
    const abs = currentVault ? joinVaultPath(currentVault, relPath) : relPath;
    if (!fileTree) return { abs, missing: false };
    if (findFilePathInTree(fileTree, abs)) return { abs, missing: false };
    const name = relPath.split(/[\\/]/).pop() || relPath;
    const found = findFileInTree(fileTree, name);
    if (found) return { abs: found, missing: false };
    return { abs, missing: true };
  };

  // Zoom-to-fit UMA vez, na montagem (D18b) — edições posteriores não podem re-enquadrar
  useEffect(() => {
    const s0 = sceneRef.current;
    if (!s0 || s0.nodes.length === 0) return;
    const views = s0.nodes.map(toNodeView);
    const el = outerRef.current;
    const minX = Math.min(...views.map((n) => n.x));
    const minY = Math.min(...views.map((n) => n.y));
    const maxX = Math.max(...views.map((n) => n.x + n.width));
    const maxY = Math.max(...views.map((n) => n.y + n.height));
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    if (w === 0 || h === 0) {
      // jsdom/medida indisponível: garante conteúdo visível sem escala
      setView({ tx: -minX + 40, ty: -minY + 40, s: 1 });
      return;
    }
    const s = Math.min(w / bw, h / bh, 1.5) * 0.92;
    setView({ tx: (w - bw * s) / 2 - minX * s, ty: (h - bh * s) / 2 - minY * s, s });
  }, []);

  // ── Commits de mutação (ÚNICOS pontos que disparam onChange ⇒ write) ──
  const applyCommit = (next: RawScene, prev: RawScene) => {
    undoRef.current.push(cloneScene(prev));
    if (undoRef.current.length > UNDO_CAP) undoRef.current.shift();
    redoRef.current = [];
    setScene(next);
    onChange(serializeScene(next));
  };
  // Drags atualizam a cena AO VIVO (sem write); no fim, o snapshot pré-drag vira undo
  const commitAfterDrag = (preDrag: RawScene) => {
    const current = sceneRef.current;
    if (!current) return;
    undoRef.current.push(preDrag);
    if (undoRef.current.length > UNDO_CAP) undoRef.current.shift();
    redoRef.current = [];
    onChange(serializeScene(current));
  };
  const undo = () => {
    const prev = undoRef.current.pop();
    const current = sceneRef.current;
    if (!prev || !current) return;
    redoRef.current.push(cloneScene(current));
    setScene(prev);
    onChange(serializeScene(prev));
  };
  const redo = () => {
    const next = redoRef.current.pop();
    const current = sceneRef.current;
    if (!next || !current) return;
    undoRef.current.push(cloneScene(current));
    setScene(next);
    onChange(serializeScene(next));
  };

  // ── Fallback de JSON corrompido: conteúdo cru, somente leitura, zero write ──
  if (scene === null) {
    if (!notifiedRef.current) {
      notifiedRef.current = true;
      useAppStore
        .getState()
        .notify('warning', i18n.t('canvas.invalidJsonToast'));
    }
    return (
      <div className="flex flex-col h-full w-full overflow-hidden">
        <CanvasHeader filename={filename} badge={i18n.t('canvas.badgeCanvasInvalid')} />
        <div className="flex-shrink-0 text-xs text-[var(--text-muted)] mb-2 select-none">
          {i18n.t('canvas.readOnlyHint')}
        </div>
        <pre
          data-testid="canvas-fallback"
          className="flex-1 min-h-0 overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--substrate-base)] p-4 text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap"
        >
          {content}
        </pre>
      </div>
    );
  }

  const nodes = scene.nodes.map(toNodeView);
  const edges = scene.edges.map(toEdgeView);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = nodes.filter((n) => n.type === 'group');
  const foreground = nodes.filter((n) => n.type !== 'group');
  const selectedNode = selection?.kind === 'node' ? (byId.get(selection.id) ?? null) : null;

  const focusSurface = () => outerRef.current?.focus();

  // Tela → coordenadas de cena (inverte o transform de pan/zoom)
  const toSceneCoords = (clientX: number, clientY: number) => {
    const rect = outerRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (rect?.left ?? 0) - view.tx) / view.s,
      y: (clientY - (rect?.top ?? 0) - view.ty) / view.s,
    };
  };

  // ── Edição inline: texto de nó text · labels de aresta/grupo · cor da seleção ──
  const commitTextEdit = () => {
    const ed = editing;
    if (!ed || ed.kind !== 'node-text') return;
    setEditing(null);
    const prev = sceneRef.current;
    if (!prev) return;
    const raw = prev.nodes.find((n) => n.id === ed.id);
    if (!raw || (str(raw, 'text') ?? '') === ed.draft) return;
    applyCommit({ ...prev, nodes: prev.nodes.map((n) => (n === raw ? withFields(n, { text: ed.draft }) : n)) }, prev);
  };
  const commitLabelEdit = () => {
    const ed = editing;
    if (!ed || (ed.kind !== 'edge-label' && ed.kind !== 'group-label')) return;
    setEditing(null);
    const prev = sceneRef.current;
    if (!prev) return;
    const value = ed.draft.trim();
    if (ed.kind === 'edge-label') {
      const raw = prev.edges.find((x) => x.id === ed.id);
      if (!raw || (str(raw, 'label') ?? '') === value) return;
      const next = value === '' ? withoutField(raw, 'label') : withFields(raw, { label: value });
      applyCommit({ ...prev, edges: prev.edges.map((x) => (x === raw ? next : x)) }, prev);
    } else {
      const raw = prev.nodes.find((x) => x.id === ed.id);
      if (!raw || (str(raw, 'label') ?? '') === value) return;
      const next = value === '' ? withoutField(raw, 'label') : withFields(raw, { label: value });
      applyCommit({ ...prev, nodes: prev.nodes.map((x) => (x === raw ? next : x)) }, prev);
    }
  };
  const setSelectionColor = (color: string | null) => {
    const sel = selection;
    const prev = sceneRef.current;
    if (!sel || !prev) return;
    const mut = (raw: Raw) => (color === null ? withoutField(raw, 'color') : withFields(raw, { color }));
    if (sel.kind === 'node') {
      const raw = prev.nodes.find((x) => x.id === sel.id);
      if (!raw || str(raw, 'color') === (color ?? undefined)) return;
      applyCommit({ ...prev, nodes: prev.nodes.map((x) => (x === raw ? mut(x) : x)) }, prev);
    } else {
      const raw = prev.edges.find((x) => x.id === sel.id);
      if (!raw || str(raw, 'color') === (color ?? undefined)) return;
      applyCommit({ ...prev, edges: prev.edges.map((x) => (x === raw ? mut(x) : x)) }, prev);
    }
  };

  // ── Criar nó text: duplo-clique no VAZIO (semântica Obsidian); já abre em edição ──
  const createTextNodeAt = (sx: number, sy: number) => {
    const prev = sceneRef.current;
    if (!prev) return;
    const id = newCanvasId();
    const node: Raw = { id, type: 'text', text: '', x: Math.round(sx - 125), y: Math.round(sy - 30), width: 250, height: 60 };
    applyCommit({ ...prev, nodes: [...prev.nodes, node] }, prev);
    setSelection({ kind: 'node', id });
    setEditing({ kind: 'node-text', id, draft: '' });
  };
  const handleSurfaceDoubleClick = (e: React.MouseEvent) => {
    // Só o vazio: dblclick em nó/aresta tem target próprio e semântica própria
    if (e.target !== e.currentTarget) return;
    const p = toSceneCoords(e.clientX, e.clientY);
    createTextNodeAt(p.x, p.y);
  };

  // ── Criar aresta: drag de um ponto de conexão do nó selecionado até outro nó ──
  const handleConnectPointerDown = (e: React.PointerEvent, n: NodeView, side: Side) => {
    if (e.button > 0) return;
    e.stopPropagation();
    focusSurface();
    setEdgeDraft({ fromId: n.id, fromSide: side, end: anchorPoint(n, side) });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const handleConnectPointerMove = (e: React.PointerEvent) => {
    if (!edgeDraft) return;
    const end = toSceneCoords(e.clientX, e.clientY);
    setEdgeDraft((d) => (d ? { ...d, end } : d));
  };
  const handleConnectPointerUp = (e: React.PointerEvent) => {
    const d = edgeDraft;
    setEdgeDraft(null);
    if (!d) return;
    const end = toSceneCoords(e.clientX, e.clientY);
    const target = nodes.find(
      (n) => n.id !== d.fromId && end.x >= n.x && end.x <= n.x + n.width && end.y >= n.y && end.y <= n.y + n.height
    );
    const from = byId.get(d.fromId);
    if (!target || !from) return;
    const toSide = pickSides(from, target)[1];
    const prev = sceneRef.current;
    if (!prev) return;
    const id = newCanvasId();
    const newEdge: Raw = { id, fromNode: d.fromId, fromSide: d.fromSide, toNode: target.id, toSide };
    applyCommit({ ...prev, edges: [...prev.edges, newEdge] }, prev);
    setSelection({ kind: 'edge', id });
  };

  // ── Pan (superfície) + deselecionar no clique vazio ──
  const clampScale = (s: number) => Math.min(4, Math.max(0.05, s));
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = outerRef.current?.getBoundingClientRect();
    const px = e.clientX - (rect?.left ?? 0);
    const py = e.clientY - (rect?.top ?? 0);
    setView((v) => {
      const s2 = clampScale(v.s * Math.exp(-e.deltaY * 0.0015));
      const ratio = s2 / v.s;
      return { s: s2, tx: px - (px - v.tx) * ratio, ty: py - (py - v.ty) * ratio };
    });
  };
  // Guard de botão: rejeita só botão secundário EXPLÍCITO (no jsdom `button` vem null)
  const handleSurfacePointerDown = (e: React.PointerEvent) => {
    if (e.button > 0) return;
    focusSurface();
    panRef.current = { x: e.clientX, y: e.clientY };
    panMovedRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const handleSurfacePointerMove = (e: React.PointerEvent) => {
    const start = panRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) panMovedRef.current = true;
    panRef.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const handleSurfacePointerUp = () => {
    if (panRef.current && !panMovedRef.current) setSelection(null);
    panRef.current = null;
  };

  // ── Drag de nó (grupo arrasta os nós CONTIDOS — semântica Obsidian) ──
  const collectDragOrigins = (n: NodeView): Map<string, { x: number; y: number }> => {
    const map = new Map<string, { x: number; y: number }>([[n.id, { x: n.x, y: n.y }]]);
    if (n.type === 'group') {
      for (const other of nodes) {
        if (other.id === n.id) continue;
        const cx = other.x + other.width / 2;
        const cy = other.y + other.height / 2;
        if (cx >= n.x && cx <= n.x + n.width && cy >= n.y && cy <= n.y + n.height) {
          map.set(other.id, { x: other.x, y: other.y });
        }
      }
    }
    return map;
  };
  const handleNodePointerDown = (e: React.PointerEvent, n: NodeView) => {
    if (e.button > 0) return;
    e.stopPropagation();
    focusSurface();
    setSelection({ kind: 'node', id: n.id });
    const current = sceneRef.current;
    if (!current) return;
    nodeDragRef.current = {
      origins: collectDragOrigins(n),
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      preDrag: cloneScene(current),
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const handleNodePointerMove = (e: React.PointerEvent) => {
    const d = nodeDragRef.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    if (!d.moved) return;
    const dx = (e.clientX - d.startX) / view.s;
    const dy = (e.clientY - d.startY) / view.s;
    setScene((s) => (s ? moveNodes(s, d.origins, dx, dy) : s));
  };
  const handleNodePointerUp = () => {
    const d = nodeDragRef.current;
    nodeDragRef.current = null;
    if (d?.moved) commitAfterDrag(d.preDrag);
  };

  // ── Resize por 4 handles de canto (mínimo 40×40) ──
  const handleResizePointerDown = (e: React.PointerEvent, n: NodeView, corner: Corner) => {
    if (e.button > 0) return;
    e.stopPropagation();
    focusSurface();
    const current = sceneRef.current;
    if (!current) return;
    resizeRef.current = {
      id: n.id,
      corner,
      orig: { x: n.x, y: n.y, w: n.width, h: n.height },
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      preDrag: cloneScene(current),
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const handleResizePointerMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    if (Math.abs(e.clientX - r.startX) + Math.abs(e.clientY - r.startY) > 2) r.moved = true;
    if (!r.moved) return;
    const dx = (e.clientX - r.startX) / view.s;
    const dy = (e.clientY - r.startY) / view.s;
    const { orig, corner } = r;
    let x = orig.x;
    let y = orig.y;
    let w = orig.w;
    let h = orig.h;
    if (corner === 'ne' || corner === 'se') w = Math.max(MIN_NODE_SIZE, orig.w + dx);
    if (corner === 'nw' || corner === 'sw') {
      w = Math.max(MIN_NODE_SIZE, orig.w - dx);
      x = orig.x + (orig.w - w);
    }
    if (corner === 'sw' || corner === 'se') h = Math.max(MIN_NODE_SIZE, orig.h + dy);
    if (corner === 'nw' || corner === 'ne') {
      h = Math.max(MIN_NODE_SIZE, orig.h - dy);
      y = orig.y + (orig.h - h);
    }
    setScene((s) =>
      s
        ? {
            ...s,
            nodes: s.nodes.map((raw) =>
              raw.id === r.id
                ? withFields(raw, {
                    x: Math.round(x),
                    y: Math.round(y),
                    width: Math.round(w),
                    height: Math.round(h),
                  })
                : raw
            ),
          }
        : s
    );
  };
  const handleResizePointerUp = () => {
    const r = resizeRef.current;
    resizeRef.current = null;
    if (r?.moved) commitAfterDrag(r.preDrag);
  };

  // ── Teclado: Delete/Backspace apaga a seleção (cascata de arestas), Ctrl+Z/Y undo/redo ──
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Edição inline aberta: o teclado pertence ao textarea/input (que dão stopPropagation;
    // este guard é o cinto extra pra Delete/Ctrl+Z nunca vazarem pra cena)
    if (editing) return;
    if (e.key === 'Escape') {
      setSelection(null);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
      e.preventDefault();
      const prev = sceneRef.current;
      if (!prev) return;
      const next = selection.kind === 'node' ? removeNode(prev, selection.id) : removeEdge(prev, selection.id);
      applyCommit(next, prev);
      setSelection(null);
      return;
    }
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') || (e.ctrlKey && e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      redo();
    }
  };

  // ── Navegação (semântica Obsidian): DUPLO-clique age; clique simples só seleciona ──
  const handleFileNodeDoubleClick = (relPath: string) => {
    if (!currentVault) return;
    const { abs, missing } = resolveFileNode(relPath);
    if (missing) {
      useAppStore.getState().notify('warning', i18n.t('canvas.notInVault', { path: relPath }));
      return;
    }
    if (getFileKind(abs) === 'external') {
      void openInDefaultApp(abs);
    } else {
      void openTab(abs);
    }
  };

  // Bounding box (inclui uma folga pras curvas das arestas saírem do retângulo dos nós)
  const PAD = 200;
  const minX = nodes.length ? Math.min(...nodes.map((n) => n.x)) - PAD : 0;
  const minY = nodes.length ? Math.min(...nodes.map((n) => n.y)) - PAD : 0;
  const maxX = nodes.length ? Math.max(...nodes.map((n) => n.x + n.width)) + PAD : 0;
  const maxY = nodes.length ? Math.max(...nodes.map((n) => n.y + n.height)) + PAD : 0;

  const handleSize = 10 / view.s;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <CanvasHeader filename={filename} badge={i18n.t('canvas.badgeCanvas')} />

      <div
        ref={outerRef}
        data-testid="canvas-surface"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex-1 min-h-0 relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--substrate-base)] cursor-grab active:cursor-grabbing select-none outline-none focus:border-[var(--border-default)]"
        onWheel={handleWheel}
        onPointerDown={handleSurfacePointerDown}
        onPointerMove={handleSurfacePointerMove}
        onPointerUp={handleSurfacePointerUp}
        onPointerLeave={handleSurfacePointerUp}
        onDoubleClick={handleSurfaceDoubleClick}
      >
        {/* mini-paleta da seleção: 6 cores do Obsidian + limpar */}
        {selection && (
          <div
            data-testid="canvas-color-toolbar"
            className="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--substrate-raised)] px-2 py-1.5 shadow-lg"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {Object.entries(PALETTE).map(([key, hex]) => (
              <button
                key={key}
                data-testid={`canvas-color-${key}`}
                title={`Cor ${key}`}
                className="w-4 h-4 rounded-full border border-[var(--border-strong)] cursor-pointer"
                style={{ background: hex }}
                onClick={() => setSelectionColor(key)}
              />
            ))}
            <button
              data-testid="canvas-color-clear"
              title={i18n.t('canvas.clearColor')}
              className="w-4 h-4 rounded-full border border-[var(--border-strong)] cursor-pointer text-[10px] leading-none text-[var(--text-muted)]"
              onClick={() => setSelectionColor(null)}
            >
              ✕
            </button>
          </div>
        )}
        <div
          className="absolute top-0 left-0"
          style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, transformOrigin: '0 0' }}
        >
          {/* grupos atrás de tudo (semântica visual do Canvas) */}
          {groups.map((n) => {
            const color = canvasColor(n.color) ?? 'var(--border-subtle)';
            const isSelected = selection?.kind === 'node' && selection.id === n.id;
            return (
              <div
                key={n.id}
                data-testid={`canvas-node-${n.id}`}
                className="absolute rounded-xl border-2 border-dashed"
                style={{
                  left: n.x,
                  top: n.y,
                  width: n.width,
                  height: n.height,
                  borderColor: isSelected ? 'var(--accent)' : color,
                  background: 'transparent',
                  cursor: 'move',
                }}
                onPointerDown={(e) => handleNodePointerDown(e, n)}
                onPointerMove={handleNodePointerMove}
                onPointerUp={handleNodePointerUp}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setSelection({ kind: 'node', id: n.id });
                  setEditing({ kind: 'group-label', id: n.id, draft: n.label ?? '' });
                }}
              >
                {n.label && (
                  <span
                    className="absolute -top-6 left-1 px-1.5 text-xs font-semibold rounded select-none"
                    style={{ color: isSelected ? 'var(--accent)' : color }}
                  >
                    {n.label}
                  </span>
                )}
              </div>
            );
          })}

          {/* arestas entre grupos e nós */}
          {nodes.length > 0 && (
            <svg
              className="absolute pointer-events-none"
              style={{ left: minX, top: minY }}
              width={maxX - minX}
              height={maxY - minY}
              viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
            >
              {edges.map((e) => {
                const a = byId.get(e.fromNode);
                const b = byId.get(e.toNode);
                if (!a || !b) return null; // aresta órfã: ignora sem quebrar o resto
                const [fallbackFrom, fallbackTo] = pickSides(a, b);
                const fromSide = e.fromSide ?? fallbackFrom;
                const toSide = e.toSide ?? fallbackTo;
                const geo = edgeGeometry(anchorPoint(a, fromSide), fromSide, anchorPoint(b, toSide), toSide);
                const isSelected = selection?.kind === 'edge' && selection.id === e.id;
                const stroke = isSelected ? 'var(--accent)' : (canvasColor(e.color) ?? 'var(--text-muted)');
                return (
                  <g key={e.id} data-testid={`canvas-edge-${e.id}`}>
                    <path
                      d={geo.d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={(isSelected ? 3 : 2) / Math.sqrt(view.s)}
                    />
                    {/* trilho invisível largo: alvo de clique pra selecionar a aresta */}
                    <path
                      data-testid={`canvas-edge-hit-${e.id}`}
                      d={geo.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14 / Math.sqrt(view.s)}
                      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                      onPointerDown={(ev) => {
                        ev.stopPropagation();
                        focusSurface();
                        setSelection({ kind: 'edge', id: e.id });
                      }}
                      onDoubleClick={(ev) => {
                        ev.stopPropagation();
                        setSelection({ kind: 'edge', id: e.id });
                        setEditing({ kind: 'edge-label', id: e.id, draft: e.label ?? '' });
                      }}
                    />
                    <path d={geo.arrow} fill={stroke} />
                    {e.label && (
                      <text
                        x={geo.mid.x}
                        y={geo.mid.y - 6}
                        textAnchor="middle"
                        className="text-xs font-semibold"
                        fill="var(--text-secondary)"
                        style={{ paintOrder: 'stroke', stroke: 'var(--substrate-base)', strokeWidth: 4 }}
                      >
                        {e.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* preview da aresta em criação (tracejada, sem write até o drop) */}
              {edgeDraft &&
                (() => {
                  const from = byId.get(edgeDraft.fromId);
                  if (!from) return null;
                  const a = anchorPoint(from, edgeDraft.fromSide);
                  return (
                    <line
                      data-testid="canvas-edge-draft"
                      x1={a.x}
                      y1={a.y}
                      x2={edgeDraft.end.x}
                      y2={edgeDraft.end.y}
                      stroke="var(--accent)"
                      strokeWidth={2 / Math.sqrt(view.s)}
                      strokeDasharray="6 4"
                    />
                  );
                })()}
            </svg>
          )}

          {/* nós de frente: text / file / link */}
          {foreground.map((n) => {
            const color = canvasColor(n.color);
            const isSelected = selection?.kind === 'node' && selection.id === n.id;
            const border = isSelected ? 'var(--accent)' : (color ?? 'var(--border-subtle)');
            const bg = color ? `${color}1f` : 'var(--substrate-raised)';
            const base = 'absolute rounded-lg border overflow-hidden';
            const style: React.CSSProperties = {
              left: n.x,
              top: n.y,
              width: n.width,
              height: n.height,
              borderColor: border,
              background: bg,
              cursor: 'move',
              boxShadow: isSelected ? '0 0 0 1px var(--accent)' : undefined,
            };
            const dragProps = {
              onPointerDown: (e: React.PointerEvent) => handleNodePointerDown(e, n),
              onPointerMove: handleNodePointerMove,
              onPointerUp: handleNodePointerUp,
            };

            if (n.type === 'text') {
              const nodeEditing = editing?.kind === 'node-text' && editing.id === n.id ? editing : null;
              return (
                <div
                  key={n.id}
                  data-testid={`canvas-node-${n.id}`}
                  className={base}
                  style={style}
                  {...dragProps}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setSelection({ kind: 'node', id: n.id });
                    setEditing({ kind: 'node-text', id: n.id, draft: n.text ?? '' });
                  }}
                >
                  {nodeEditing ? (
                    <textarea
                      data-testid={`canvas-node-editor-${n.id}`}
                      autoFocus
                      className="w-full h-full resize-none bg-transparent px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)] outline-none"
                      value={nodeEditing.draft}
                      onChange={(ev) => setEditing({ ...nodeEditing, draft: ev.target.value })}
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onDoubleClick={(ev) => ev.stopPropagation()}
                      onKeyDown={(ev) => {
                        ev.stopPropagation();
                        if (ev.key === 'Escape') setEditing(null);
                        else if (ev.key === 'Enter' && ev.ctrlKey) commitTextEdit();
                      }}
                      onBlur={commitTextEdit}
                    />
                  ) : (
                    <div
                      className="canvas-md w-full h-full overflow-hidden px-3 py-2 text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownFragment(n.text ?? '') }}
                    />
                  )}
                </div>
              );
            }
            if (n.type === 'file') {
              const target = resolveFileNode(n.file ?? '');
              return (
                <div
                  key={n.id}
                  data-testid={`canvas-node-${n.id}`}
                  className={`${base} hover:border-[var(--accent-dim)] transition-colors ${target.missing ? 'opacity-60' : ''}`}
                  style={style}
                  {...dragProps}
                  onDoubleClick={() => n.file && handleFileNodeDoubleClick(n.file)}
                  title={n.file}
                >
                  <FileNodeCard relPath={n.file ?? ''} target={target} />
                </div>
              );
            }
            // link
            return (
              <div
                key={n.id}
                data-testid={`canvas-node-${n.id}`}
                className={`${base} hover:border-[var(--accent-dim)] transition-colors`}
                style={style}
                {...dragProps}
                onDoubleClick={() => n.url && void openInDefaultApp(n.url)}
                title={n.url}
              >
                <div className="w-full h-full flex items-center gap-2 px-3 text-sm text-[var(--text-secondary)]">
                  <Link2 className="w-4 h-4 flex-shrink-0 text-[var(--accent-dim)]" />
                  <span className="truncate">{n.url}</span>
                </div>
              </div>
            );
          })}

          {/* handles de resize do nó selecionado (irmãos dos nós: não sofrem clip do overflow) */}
          {selectedNode &&
            CORNERS.map((corner) => {
              const hx = corner === 'nw' || corner === 'sw' ? selectedNode.x : selectedNode.x + selectedNode.width;
              const hy = corner === 'nw' || corner === 'ne' ? selectedNode.y : selectedNode.y + selectedNode.height;
              const cursor = corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize';
              return (
                <div
                  key={corner}
                  data-testid={`canvas-resize-${corner}`}
                  className="absolute rounded-full border-2 border-[var(--accent)] bg-[var(--substrate-base)]"
                  style={{
                    left: hx - handleSize / 2,
                    top: hy - handleSize / 2,
                    width: handleSize,
                    height: handleSize,
                    cursor,
                  }}
                  onPointerDown={(e) => handleResizePointerDown(e, selectedNode, corner)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                />
              );
            })}

          {/* pontos de conexão do nó selecionado: drag até outro nó cria aresta */}
          {selectedNode &&
            !editing &&
            SIDES.map((side) => {
              const p = anchorPoint(selectedNode, side);
              const dot = 9 / view.s;
              return (
                <div
                  key={side}
                  data-testid={`canvas-connect-${side}`}
                  className="absolute rounded-full bg-[var(--accent)] border border-[var(--accent-contrast)]"
                  style={{ left: p.x - dot / 2, top: p.y - dot / 2, width: dot, height: dot, cursor: 'crosshair' }}
                  onPointerDown={(e) => handleConnectPointerDown(e, selectedNode, side)}
                  onPointerMove={handleConnectPointerMove}
                  onPointerUp={handleConnectPointerUp}
                />
              );
            })}

          {/* input flutuante de label de ARESTA (dblclick na aresta) */}
          {editing?.kind === 'edge-label' &&
            (() => {
              const ev = edges.find((x) => x.id === editing.id);
              if (!ev) return null;
              const a = byId.get(ev.fromNode);
              const b = byId.get(ev.toNode);
              if (!a || !b) return null;
              const [ff, ft] = pickSides(a, b);
              const geo = edgeGeometry(
                anchorPoint(a, ev.fromSide ?? ff),
                ev.fromSide ?? ff,
                anchorPoint(b, ev.toSide ?? ft),
                ev.toSide ?? ft
              );
              return (
                <LabelInput
                  left={geo.mid.x - 60}
                  top={geo.mid.y - 26}
                  width={120}
                  value={editing.draft}
                  onChange={(v) => setEditing({ ...editing, draft: v })}
                  onCommit={commitLabelEdit}
                  onCancel={() => setEditing(null)}
                />
              );
            })()}

          {/* input flutuante de label de GRUPO (dblclick no grupo) */}
          {editing?.kind === 'group-label' &&
            (() => {
              const g = byId.get(editing.id);
              if (!g) return null;
              return (
                <LabelInput
                  left={g.x + 4}
                  top={g.y - 30}
                  width={160}
                  value={editing.draft}
                  onChange={(v) => setEditing({ ...editing, draft: v })}
                  onCommit={commitLabelEdit}
                  onCancel={() => setEditing(null)}
                />
              );
            })()}
        </div>
      </div>
    </div>
  );
}

function CanvasHeader({ filename, badge }: { filename: string; badge: string }) {
  return (
    <div className="flex-shrink-0 flex items-center gap-2 mb-4 select-none pr-2">
      <Shapes className="w-5 h-5 text-[var(--accent-dim)] flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate text-[27px] font-display font-semibold text-[var(--text-primary)] py-1">
        {filename}
      </span>
      <span className="flex-shrink-0 rounded-md px-2 py-1 text-xs font-mono font-semibold uppercase border text-[var(--text-muted)] border-[var(--border-subtle)] bg-[var(--substrate-raised)]/50">
        {badge}
      </span>
    </div>
  );
}
