// E4.3 (Spec 31): editor nativo de .canvas (JSON Canvas / Obsidian) com round-trip.
// Contratos pinados: roteamento do kind · render dos 4 tipos de nó + arestas · round-trip
// byte-idêntico do writer formato-Obsidian · preservação de campos desconhecidos em
// mutação · mover/redimensionar mudam SÓ a geometria do nó certo · delete cascateia
// arestas · undo/redo · navegação por DUPLO-clique (semântica Obsidian, Spec 31) ·
// resolução de nó file exato→basename (vault reorganizado) · fail-soft de JSON corrompido ·
// ZERO write sem mutação real (abrir + pan + zoom + selecionar não chamam onChange).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore, FileNode } from '../store/appStore';
import { getFileKind } from '../utils/fileKind';
import { parseScene, serializeScene } from '../utils/jsonCanvas';
import CanvasEditor from '../components/CanvasEditor';

// jsdom não implementa PointerEvent: o fireEvent.pointer* cairia num Event genérico SEM
// clientX/clientY/button e a matemática de drag do editor viraria NaN. Polyfill mínimo
// em cima de MouseEvent (que o jsdom implementa completo) — só pros testes deste arquivo.
if (!('PointerEvent' in window)) {
  class PointerEventPolyfill extends MouseEvent {
    public pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = PointerEventPolyfill;
}

const VAULT = 'C:\\MyVault';
const CANVAS_PATH = 'C:\\MyVault\\Mapas\\Fluxo.canvas';

const FIXTURE = {
  nodes: [
    // cobre a spec inteira do JSON Canvas: text, file (.md e imagem), link, group
    { id: 'n1', type: 'text', text: '# Título\n**negrito** e [[Nota Alvo|apelido]]', x: 0, y: 0, width: 300, height: 200, color: '4' },
    { id: 'n2', type: 'file', file: 'Subpasta/Nota Alvo.md', x: 400, y: 0, width: 320, height: 240 },
    { id: 'n3', type: 'link', url: 'https://exemplo.com/pagina', x: 0, y: 300, width: 300, height: 80 },
    { id: 'n4', type: 'group', label: 'Grupo A', x: -40, y: -40, width: 820, height: 320, color: '#ff00ff' },
    { id: 'n5', type: 'file', file: 'Imagens/foto.png', x: 800, y: 0, width: 200, height: 150 },
  ],
  edges: [
    { id: 'e1', fromNode: 'n1', fromSide: 'right', toNode: 'n2', toSide: 'left', label: 'liga' },
    { id: 'e2', fromNode: 'n2', toNode: 'n3' },
  ],
};

// String EXATA no formato do writer do Obsidian (tab + um nó/aresta compacto por linha),
// com campos DESCONHECIDOS no topo, no nó e na aresta — o aceite do round-trip da Spec 31
const OBSIDIAN_RAW = `{\n\t"nodes":[\n\t\t{"id":"n1","type":"text","text":"# A","x":0,"y":0,"width":300,"height":200,"styleAttributes":{"shape":"oval"}},\n\t\t{"id":"n2","type":"text","text":"B","x":400,"y":0,"width":200,"height":100}\n\t],\n\t"edges":[\n\t\t{"id":"e1","fromNode":"n1","fromSide":"right","toNode":"n2","toSide":"left","customMeta":"x"}\n\t],\n\t"metadata":{"version":"1.0-1"}\n}`;

// Árvore com a nota em pasta NOVA (o canvas aponta pro path antigo da era Obsidian)
const TREE: FileNode = {
  name: 'MyVault',
  path: VAULT,
  is_dir: true,
  children: [
    {
      name: '60_Library',
      path: 'C:\\MyVault\\60_Library',
      is_dir: true,
      children: [
        {
          name: 'IA',
          path: 'C:\\MyVault\\60_Library\\IA',
          is_dir: true,
          children: [
            { name: 'Nota Alvo.md', path: 'C:\\MyVault\\60_Library\\IA\\Nota Alvo.md', is_dir: false },
          ],
        },
      ],
    },
  ],
};

function mockReadFile(files: Record<string, string>) {
  vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
    if (cmd === 'read_file') {
      const path = (args as { path: string }).path.replace(/\//g, '\\');
      const key = Object.keys(files).find((k) => k.replace(/\//g, '\\') === path);
      if (key) return files[key];
      throw new Error(`File not found: ${path}`);
    }
    return undefined;
  });
}

/** Seleciona um nó por clique (pointerDown+Up sem movimento) */
function selectNode(el: HTMLElement) {
  fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(el);
}

/** Arrasta um elemento por (dx, dy) em coordenadas de tela */
function dragBy(el: HTMLElement, dx: number, dy: number) {
  fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(el, { clientX: 100 + dx, clientY: 100 + dy });
  fireEvent.pointerUp(el);
}

describe('E4.3 — CanvasEditor (.canvas nativo com round-trip)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useAppStore.setState({ currentVault: VAULT, notifications: [], fileTree: null, activeTab: CANVAS_PATH });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('roteamento: .canvas ganha kind próprio; demais kinds inalterados (regressão E5)', () => {
    expect(getFileKind('C:\\v\\Mapa.canvas')).toBe('canvas');
    expect(getFileKind('C:\\v\\nota.md')).toBe('markdown');
    expect(getFileKind('C:\\v\\dados.json')).toBe('text');
    expect(getFileKind('C:\\v\\doc.pdf')).toBe('pdf');
    expect(getFileKind('C:\\v\\binario.exe')).toBe('external');
  });

  it('round-trip byte-idêntico: parse→serialize sem mutação preserva o arquivo do Obsidian', () => {
    const scene = parseScene(OBSIDIAN_RAW);
    expect(scene).not.toBeNull();
    expect(serializeScene(scene!)).toBe(OBSIDIAN_RAW);
    // variante com trailing newline (preservado byte a byte)
    const withNl = OBSIDIAN_RAW + '\n';
    expect(serializeScene(parseScene(withNl)!)).toBe(withNl);
    // arrays vazios ficam inline (formato do Obsidian)
    const empty = `{\n\t"nodes":[],\n\t"edges":[]\n}`;
    expect(serializeScene(parseScene(empty)!)).toBe(empty);
  });

  it('renderiza os 4 tipos de nó + arestas com fidelidade (fixture cobre a spec inteira)', async () => {
    mockReadFile({ 'C:\\MyVault\\Subpasta\\Nota Alvo.md': '# Alvo\ncorpo da nota alvo' });

    render(<CanvasEditor content={JSON.stringify(FIXTURE)} onChange={vi.fn()} />);

    // 5 nós presentes
    expect(screen.getAllByTestId(/^canvas-node-/)).toHaveLength(5);
    // 2 arestas (cada uma = traço visível + trilho invisível de clique)
    expect(screen.getAllByTestId(/^canvas-edge-e/)).toHaveLength(2);
    expect(screen.getAllByTestId(/^canvas-edge-hit-e/)).toHaveLength(2);
    // nó text: markdown renderizado + wiki-link achatado pro alias
    const textNode = screen.getByTestId('canvas-node-n1');
    expect(textNode.querySelector('strong')?.textContent).toBe('negrito');
    expect(textNode.textContent).toContain('apelido');
    expect(textNode.textContent).not.toContain('[[');
    // nó file .md: preview do conteúdo renderizado
    await waitFor(() => {
      expect(screen.getByTestId('canvas-node-n2').textContent).toContain('corpo da nota alvo');
    });
    // nó link: URL visível
    expect(screen.getByTestId('canvas-node-n3').textContent).toContain('exemplo.com');
    // nó group: label visível
    expect(screen.getByTestId('canvas-node-n4').textContent).toContain('Grupo A');
    // aresta com label
    expect(screen.getByText('liga')).toBeTruthy();
  });

  it('ZERO write sem mutação real: abrir + pan + zoom + selecionar + deselecionar', async () => {
    mockReadFile({ 'C:\\MyVault\\Subpasta\\Nota Alvo.md': 'corpo' });
    const onChange = vi.fn();

    render(<CanvasEditor content={JSON.stringify(FIXTURE)} onChange={onChange} />);
    const surface = await screen.findByTestId('canvas-surface');

    // pan + zoom
    fireEvent.pointerDown(surface, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { clientX: 180, clientY: 140 });
    fireEvent.pointerUp(surface);
    fireEvent.wheel(surface, { deltaY: -240, clientX: 150, clientY: 150 });
    // selecionar nó (clique sem movimento) + deselecionar no vazio
    selectNode(screen.getByTestId('canvas-node-n1'));
    fireEvent.pointerDown(surface, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(surface);

    expect(onChange).not.toHaveBeenCalled();
    const writeCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === 'write_file' || cmd === 'export_text_file');
    expect(writeCalls).toHaveLength(0);
  });

  it('mover nó: commit no fim do drag muda SÓ x/y do nó certo; desconhecidos preservados', () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={OBSIDIAN_RAW} onChange={onChange} />);

    dragBy(screen.getByTestId('canvas-node-n1'), 80, 40);

    expect(onChange).toHaveBeenCalledTimes(1);
    const saved = onChange.mock.calls[0][0] as string;
    const scene = parseScene(saved)!;
    const n1 = scene.nodes.find((n) => n.id === 'n1')!;
    expect(n1.x).toBe(80);
    expect(n1.y).toBe(40);
    // campos desconhecidos e ordem preservados; nó n2, aresta e metadata intocados byte a byte
    expect(n1.styleAttributes).toEqual({ shape: 'oval' });
    expect(saved).toContain('{"id":"n2","type":"text","text":"B","x":400,"y":0,"width":200,"height":100}');
    expect(saved).toContain('"customMeta":"x"');
    expect(saved).toContain('\t"metadata":{"version":"1.0-1"}');
  });

  it('redimensionar pelo handle SE: muda width/height, preserva x/y', () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={OBSIDIAN_RAW} onChange={onChange} />);

    selectNode(screen.getByTestId('canvas-node-n1'));
    dragBy(screen.getByTestId('canvas-resize-se'), 50, 30);

    expect(onChange).toHaveBeenCalledTimes(1);
    const scene = parseScene(onChange.mock.calls[0][0] as string)!;
    const n1 = scene.nodes.find((n) => n.id === 'n1')!;
    expect(n1).toMatchObject({ x: 0, y: 0, width: 350, height: 230 });
  });

  it('delete cascateia: apagar nó remove as arestas conectadas', () => {
    mockReadFile({ 'C:\\MyVault\\Subpasta\\Nota Alvo.md': 'corpo' });
    const onChange = vi.fn();
    render(<CanvasEditor content={JSON.stringify(FIXTURE)} onChange={onChange} />);

    selectNode(screen.getByTestId('canvas-node-n2'));
    fireEvent.keyDown(screen.getByTestId('canvas-surface'), { key: 'Delete' });

    expect(onChange).toHaveBeenCalledTimes(1);
    const scene = parseScene(onChange.mock.calls[0][0] as string)!;
    expect(scene.nodes.map((n) => n.id)).toEqual(['n1', 'n3', 'n4', 'n5']);
    expect(scene.edges).toEqual([]); // e1 e e2 referenciavam n2 — cascata
  });

  it('undo/redo (Ctrl+Z / Ctrl+Shift+Z) restauram e reaplicam a mutação', () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={OBSIDIAN_RAW} onChange={onChange} />);
    const surface = screen.getByTestId('canvas-surface');

    dragBy(screen.getByTestId('canvas-node-n1'), 80, 40);
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true, shiftKey: true });

    expect(onChange).toHaveBeenCalledTimes(3);
    // undo restaura o arquivo ORIGINAL byte a byte
    expect(onChange.mock.calls[1][0]).toBe(OBSIDIAN_RAW);
    const afterRedo = parseScene(onChange.mock.calls[2][0] as string)!;
    expect(afterRedo.nodes.find((n) => n.id === 'n1')).toMatchObject({ x: 80, y: 40 });
  });

  it('editar texto: dblclick abre textarea com o markdown cru; Ctrl+Enter commita', () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={OBSIDIAN_RAW} onChange={onChange} />);

    fireEvent.doubleClick(screen.getByTestId('canvas-node-n1'));
    const editor = screen.getByTestId('canvas-node-editor-n1') as HTMLTextAreaElement;
    expect(editor.value).toBe('# A');
    fireEvent.change(editor, { target: { value: '# A editado' } });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });

    expect(onChange).toHaveBeenCalledTimes(1);
    const scene = parseScene(onChange.mock.calls[0][0] as string)!;
    const n1 = scene.nodes.find((n) => n.id === 'n1')!;
    expect(n1.text).toBe('# A editado');
    expect(n1.styleAttributes).toEqual({ shape: 'oval' }); // desconhecidos intactos
  });

  it('editar texto: Esc cancela sem write', () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={OBSIDIAN_RAW} onChange={onChange} />);

    fireEvent.doubleClick(screen.getByTestId('canvas-node-n1'));
    const editor = screen.getByTestId('canvas-node-editor-n1');
    fireEvent.change(editor, { target: { value: 'descartado' } });
    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('canvas-node-editor-n1')).toBeNull();
    expect(screen.getByTestId('canvas-node-n1').textContent).toContain('A'); // original de volta
  });

  it('criar nó text: dblclick no vazio commita nó novo (250×60) já em edição', () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={OBSIDIAN_RAW} onChange={onChange} />);

    // zoom-to-fit fallback do jsdom: tx=40, ty=40, s=1 ⇒ tela (500,300) = cena (460,260)
    fireEvent.doubleClick(screen.getByTestId('canvas-surface'), { clientX: 500, clientY: 300 });

    expect(onChange).toHaveBeenCalledTimes(1);
    const scene = parseScene(onChange.mock.calls[0][0] as string)!;
    expect(scene.nodes).toHaveLength(3);
    const novo = scene.nodes.find((n) => n.id !== 'n1' && n.id !== 'n2')!;
    expect(novo).toMatchObject({ type: 'text', text: '', x: 335, y: 230, width: 250, height: 60 });
    expect(novo.id).toMatch(/^[0-9a-f]{16}$/); // id padrão Obsidian
    // já nasce em edição
    expect(screen.getByTestId(`canvas-node-editor-${novo.id}`)).toBeTruthy();
  });

  it('cor da seleção: paleta aplica ("5") e limpar REMOVE a chave color', () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={OBSIDIAN_RAW} onChange={onChange} />);

    selectNode(screen.getByTestId('canvas-node-n1'));
    fireEvent.click(screen.getByTestId('canvas-color-5'));
    fireEvent.click(screen.getByTestId('canvas-color-clear'));

    expect(onChange).toHaveBeenCalledTimes(2);
    const comCor = parseScene(onChange.mock.calls[0][0] as string)!.nodes.find((n) => n.id === 'n1')!;
    expect(comCor.color).toBe('5');
    const semCor = parseScene(onChange.mock.calls[1][0] as string)!.nodes.find((n) => n.id === 'n1')!;
    expect(Object.keys(semCor)).not.toContain('color');
  });

  it('label de aresta: dblclick no trilho abre input; Enter grava (desconhecidos intactos)', () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={OBSIDIAN_RAW} onChange={onChange} />);

    fireEvent.doubleClick(screen.getByTestId('canvas-edge-hit-e1'));
    const input = screen.getByTestId('canvas-label-input') as HTMLInputElement;
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: 'liga em' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    const e1 = parseScene(onChange.mock.calls[0][0] as string)!.edges.find((e) => e.id === 'e1')!;
    expect(e1.label).toBe('liga em');
    expect(e1.customMeta).toBe('x');
  });

  it('label de grupo: dblclick no grupo abre input com o label atual; Enter grava', async () => {
    mockReadFile({ 'C:\\MyVault\\Subpasta\\Nota Alvo.md': 'corpo' });
    const onChange = vi.fn();
    render(<CanvasEditor content={JSON.stringify(FIXTURE)} onChange={onChange} />);

    fireEvent.doubleClick(screen.getByTestId('canvas-node-n4'));
    const input = screen.getByTestId('canvas-label-input') as HTMLInputElement;
    expect(input.value).toBe('Grupo A');
    fireEvent.change(input, { target: { value: 'Grupo B' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    const g = parseScene(onChange.mock.calls[0][0] as string)!.nodes.find((n) => n.id === 'n4')!;
    expect(g.label).toBe('Grupo B');
  });

  it('criar aresta: drag do ponto de conexão até outro nó grava fromSide/toSide', () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={OBSIDIAN_RAW} onChange={onChange} />);

    selectNode(screen.getByTestId('canvas-node-n1'));
    // âncora right de n1 = cena (300,100) = tela (340,140); centro de n2 = cena (500,50) = tela (540,90)
    const dot = screen.getByTestId('canvas-connect-right');
    fireEvent.pointerDown(dot, { button: 0, clientX: 340, clientY: 140 });
    fireEvent.pointerMove(dot, { clientX: 540, clientY: 90 });
    fireEvent.pointerUp(dot, { clientX: 540, clientY: 90 });

    expect(onChange).toHaveBeenCalledTimes(1);
    const scene = parseScene(onChange.mock.calls[0][0] as string)!;
    expect(scene.edges).toHaveLength(2);
    const nova = scene.edges.find((e) => e.id !== 'e1')!;
    expect(nova).toMatchObject({ fromNode: 'n1', fromSide: 'right', toNode: 'n2', toSide: 'left' });
    expect(nova.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('navegação virou DUPLO-clique (semântica Obsidian): abre a nota via openTab', async () => {
    mockReadFile({ 'C:\\MyVault\\Subpasta\\Nota Alvo.md': 'corpo' });
    const openTabSpy = vi.fn();
    const originalOpenTab = useAppStore.getState().openTab;
    useAppStore.setState({ openTab: openTabSpy });

    try {
      render(<CanvasEditor content={JSON.stringify(FIXTURE)} onChange={vi.fn()} />);
      const fileNode = await screen.findByTestId('canvas-node-n2');
      // clique simples NÃO navega (agora seleciona)
      fireEvent.click(fileNode);
      expect(openTabSpy).not.toHaveBeenCalled();
      fireEvent.doubleClick(fileNode);
      expect(openTabSpy).toHaveBeenCalledWith('C:\\MyVault\\Subpasta\\Nota Alvo.md');
    } finally {
      useAppStore.setState({ openTab: originalOpenTab });
    }
  });

  it('nó file com path da era Obsidian resolve por basename na árvore (vault reorganizado)', async () => {
    const MOVED = 'C:\\MyVault\\60_Library\\IA\\Nota Alvo.md';
    mockReadFile({ [MOVED]: 'corpo da nota que MUDOU de pasta' });
    useAppStore.setState({ fileTree: TREE });
    const openTabSpy = vi.fn();
    const originalOpenTab = useAppStore.getState().openTab;
    useAppStore.setState({ openTab: openTabSpy });

    try {
      render(
        <CanvasEditor
          content={JSON.stringify({
            nodes: [{ id: 'm1', type: 'file', file: 'Estudos/A.I/Nota Alvo.md', x: 0, y: 0, width: 320, height: 240 }],
            edges: [],
          })}
          onChange={vi.fn()}
        />
      );
      const fileNode = await screen.findByTestId('canvas-node-m1');
      // preview veio do path NOVO (resolvido por basename, semântica F4 dos wiki-links)
      await waitFor(() => {
        expect(fileNode.textContent).toContain('corpo da nota que MUDOU de pasta');
      });
      // duplo-clique navega pro path NOVO
      fireEvent.doubleClick(fileNode);
      expect(openTabSpy).toHaveBeenCalledWith(MOVED);
    } finally {
      useAppStore.setState({ openTab: originalOpenTab });
    }
  });

  it('nó file inexistente até por basename: card avisa, duplo-clique não navega e notifica', async () => {
    mockReadFile({});
    useAppStore.setState({ fileTree: TREE });
    const openTabSpy = vi.fn();
    const originalOpenTab = useAppStore.getState().openTab;
    useAppStore.setState({ openTab: openTabSpy });

    try {
      render(
        <CanvasEditor
          content={JSON.stringify({
            nodes: [{ id: 'x1', type: 'file', file: 'Sumiu/Fantasma.md', x: 0, y: 0, width: 320, height: 240 }],
            edges: [],
          })}
          onChange={vi.fn()}
        />
      );
      const fileNode = await screen.findByTestId('canvas-node-x1');
      expect(fileNode.textContent).toContain('não encontrado no vault');
      fireEvent.doubleClick(fileNode);
      expect(openTabSpy).not.toHaveBeenCalled();
      expect(
        useAppStore.getState().notifications.some((n) => n.message.includes('não está mais no vault'))
      ).toBe(true);
    } finally {
      useAppStore.setState({ openTab: originalOpenTab });
    }
  });

  it('fail-soft: JSON corrompido → fallback read-only com o conteúdo cru + notificação (sem crash)', () => {
    const onChange = vi.fn();
    render(<CanvasEditor content={'{isso não é json'} onChange={onChange} />);

    const fallback = screen.getByTestId('canvas-fallback');
    expect(fallback.textContent).toContain('{isso não é json');
    expect(
      useAppStore.getState().notifications.some((n) => n.message.includes('inválido'))
    ).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('conteúdo vazio = canvas novo em branco (sem crash, sem write)', () => {
    const onChange = vi.fn();
    render(<CanvasEditor content="" onChange={onChange} />);
    expect(screen.getByTestId('canvas-surface')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
