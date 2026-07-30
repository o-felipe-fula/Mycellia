// E4 Fatia 1 (Spec 30): viewer READ-ONLY de .canvas — JSON Canvas (jsoncanvas.org), a spec
// aberta do Obsidian Canvas. Renderer próprio leve: nós como divs posicionados + arestas em
// SVG, pan/zoom por transform CSS. Sem lib de grafo (read-only não justifica dependência).
// NENHUM caminho de escrita existe neste componente — o arquivo jamais é gravado (Spec 30
// L1: edição completa do .canvas é a fase E4.2). Fidelidade D18b: nada do vault migrado
// pode ficar invisível/quebrado.
import { useEffect, useRef, useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { Shapes, FileText, File as FileIcon, Link2, Image as ImageIcon } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { getFileKind, getExtension } from '../utils/fileKind';
import { renderMarkdownFragment } from '../utils/exportNote';

interface CanvasViewerProps {
  path: string;
}

// ── Subset lido do JSON Canvas 1.0 (campos desconhecidos são ignorados de propósito) ──
type Side = 'top' | 'right' | 'bottom' | 'left';
interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
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
interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  label?: string;
  color?: string;
}
interface CanvasScene {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
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

function anchorPoint(n: CanvasNode, side: Side): { x: number; y: number } {
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
function pickSides(a: CanvasNode, b: CanvasNode): [Side, Side] {
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

// ── Card de nó `file`: preview de .md (mesmo pipeline do export), <img> pra imagem,
//    ícone+nome pro resto. Clique navega (openTab) ou delega (app padrão). ──
function FileNodeCard({ relPath }: { relPath: string }) {
  const { currentVault } = useAppStore();
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const name = relPath.split(/[\\/]/).pop() || relPath;
  const ext = getExtension(relPath);
  const abs = currentVault ? joinVaultPath(currentVault, relPath) : relPath;
  const kind = getFileKind(relPath);

  useEffect(() => {
    let cancelled = false;
    setPreviewHtml(null);
    if (kind !== 'markdown') return;
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
  }, [abs, kind]);

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

export default function CanvasViewer({ path }: CanvasViewerProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<CanvasScene | null>(null);
  const [rawFallback, setRawFallback] = useState<string | null>(null);
  const [view, setView] = useState({ tx: 60, ty: 60, s: 1 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const { openTab, openInDefaultApp, currentVault } = useAppStore();

  const filename = path.split(/[\\/]/).pop() || '';

  // Load + parse com fail-soft: JSON inválido nunca crasha nem some com o conteúdo —
  // vira visualização crua read-only + toast (recuperação: editar fora ou renomear pra .json)
  useEffect(() => {
    let cancelled = false;
    setScene(null);
    setRawFallback(null);
    invoke<string>('read_file', { path })
      .then((raw) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(raw) as Partial<CanvasScene>;
          const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
          const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
          setScene({ nodes, edges });
        } catch {
          setRawFallback(raw);
          useAppStore
            .getState()
            .notify('warning', 'Canvas com JSON inválido — exibindo o conteúdo cru (somente leitura).');
        }
      })
      .catch((e) => {
        if (!cancelled) {
          useAppStore.getState().notify('error', `Não foi possível ler o canvas: ${e}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Zoom-to-fit ao carregar a cena (D18b: abrir já enxergando o mapa inteiro)
  useEffect(() => {
    if (!scene || scene.nodes.length === 0) return;
    const el = outerRef.current;
    const minX = Math.min(...scene.nodes.map((n) => n.x));
    const minY = Math.min(...scene.nodes.map((n) => n.y));
    const maxX = Math.max(...scene.nodes.map((n) => n.x + n.width));
    const maxY = Math.max(...scene.nodes.map((n) => n.y + n.height));
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
  }, [scene]);

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

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    const start = dragRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const handlePointerUp = () => {
    dragRef.current = null;
  };

  // Clique (não-drag) em nó file: navegação D18b — .md/text/pdf/canvas abrem em aba;
  // resto delega pro app padrão. Nó link tenta o navegador via opener (toast se falhar).
  const handleFileNodeClick = (relPath: string) => {
    if (movedRef.current) return;
    if (!currentVault) return;
    const abs = joinVaultPath(currentVault, relPath);
    if (getFileKind(abs) === 'external') {
      void openInDefaultApp(abs);
    } else {
      void openTab(abs);
    }
  };
  const handleLinkNodeClick = (url: string) => {
    if (movedRef.current) return;
    void openInDefaultApp(url);
  };

  // ── Fallback de JSON corrompido: conteúdo cru, somente leitura, zero write ──
  if (rawFallback !== null) {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden">
        <CanvasHeader filename={filename} badge="canvas · json inválido" />
        <div className="flex-shrink-0 text-xs text-[var(--text-muted)] mb-2 select-none">
          Visualização somente leitura. Para corrigir, edite o arquivo fora do app (ou renomeie para .json).
        </div>
        <pre
          data-testid="canvas-fallback"
          className="flex-1 min-h-0 overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--substrate-base)] p-4 text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap"
        >
          {rawFallback}
        </pre>
      </div>
    );
  }

  const nodes = scene?.nodes ?? [];
  const edges = scene?.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = nodes.filter((n) => n.type === 'group');
  const foreground = nodes.filter((n) => n.type !== 'group');

  // Bounding box (inclui uma folga pras curvas das arestas saírem do retângulo dos nós)
  const PAD = 200;
  const minX = nodes.length ? Math.min(...nodes.map((n) => n.x)) - PAD : 0;
  const minY = nodes.length ? Math.min(...nodes.map((n) => n.y)) - PAD : 0;
  const maxX = nodes.length ? Math.max(...nodes.map((n) => n.x + n.width)) + PAD : 0;
  const maxY = nodes.length ? Math.max(...nodes.map((n) => n.y + n.height)) + PAD : 0;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <CanvasHeader filename={filename} badge="canvas · leitura" />

      <div
        ref={outerRef}
        data-testid="canvas-surface"
        className="flex-1 min-h-0 relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--substrate-base)] cursor-grab active:cursor-grabbing select-none"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div
          className="absolute top-0 left-0"
          style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, transformOrigin: '0 0' }}
        >
          {/* grupos atrás de tudo (semântica visual do Canvas) */}
          {groups.map((n) => {
            const color = canvasColor(n.color) ?? 'var(--border-subtle)';
            return (
              <div
                key={n.id}
                data-testid={`canvas-node-${n.id}`}
                className="absolute rounded-xl border-2 border-dashed"
                style={{ left: n.x, top: n.y, width: n.width, height: n.height, borderColor: color, background: 'transparent' }}
              >
                {n.label && (
                  <span
                    className="absolute -top-6 left-1 px-1.5 text-xs font-semibold rounded select-none"
                    style={{ color }}
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
                const stroke = canvasColor(e.color) ?? 'var(--text-muted)';
                return (
                  <g key={e.id} data-testid={`canvas-edge-${e.id}`}>
                    <path d={geo.d} fill="none" stroke={stroke} strokeWidth={2 / Math.sqrt(view.s)} />
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
            </svg>
          )}

          {/* nós de frente: text / file / link */}
          {foreground.map((n) => {
            const color = canvasColor(n.color);
            const border = color ?? 'var(--border-subtle)';
            const bg = color ? `${color}1f` : 'var(--substrate-raised)';
            const base = 'absolute rounded-lg border overflow-hidden';
            const style = { left: n.x, top: n.y, width: n.width, height: n.height, borderColor: border, background: bg };

            if (n.type === 'text') {
              return (
                <div key={n.id} data-testid={`canvas-node-${n.id}`} className={base} style={style}>
                  <div
                    className="canvas-md w-full h-full overflow-hidden px-3 py-2 text-sm leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderMarkdownFragment(n.text ?? '') }}
                  />
                </div>
              );
            }
            if (n.type === 'file') {
              return (
                <div
                  key={n.id}
                  data-testid={`canvas-node-${n.id}`}
                  className={`${base} cursor-pointer hover:border-[var(--accent-dim)] transition-colors`}
                  style={style}
                  onClick={() => n.file && handleFileNodeClick(n.file)}
                  title={n.file}
                >
                  <FileNodeCard relPath={n.file ?? ''} />
                </div>
              );
            }
            // link
            return (
              <div
                key={n.id}
                data-testid={`canvas-node-${n.id}`}
                className={`${base} cursor-pointer hover:border-[var(--accent-dim)] transition-colors`}
                style={style}
                onClick={() => n.url && handleLinkNodeClick(n.url)}
                title={n.url}
              >
                <div className="w-full h-full flex items-center gap-2 px-3 text-sm text-[var(--text-secondary)]">
                  <Link2 className="w-4 h-4 flex-shrink-0 text-[var(--accent-dim)]" />
                  <span className="truncate">{n.url}</span>
                </div>
              </div>
            );
          })}
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
