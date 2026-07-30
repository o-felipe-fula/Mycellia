// E4 Fatia 1 (Spec 30): viewer read-only de .canvas (JSON Canvas / Obsidian).
// Contratos pinados: roteamento do kind novo · render dos 4 tipos de nó + arestas ·
// markdown nos nós text (wiki-link achatado) · navegação por clique em nó file ·
// fail-soft de JSON corrompido · ZERO write (read-only por construção).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';
import { getFileKind } from '../utils/fileKind';
import CanvasViewer from '../components/CanvasViewer';

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

describe('E4 Fatia 1 — CanvasViewer (.canvas read-only)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useAppStore.setState({ currentVault: VAULT, notifications: [] });
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

  it('renderiza os 4 tipos de nó + arestas com fidelidade (fixture cobre a spec inteira)', async () => {
    mockReadFile({
      [CANVAS_PATH]: JSON.stringify(FIXTURE),
      'C:\\MyVault\\Subpasta\\Nota Alvo.md': '# Alvo\ncorpo da nota alvo',
    });

    render(<CanvasViewer path={CANVAS_PATH} />);

    // 5 nós presentes
    await waitFor(() => {
      expect(screen.getAllByTestId(/^canvas-node-/)).toHaveLength(5);
    });
    // 2 arestas
    expect(screen.getAllByTestId(/^canvas-edge-/)).toHaveLength(2);
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

  it('clique em nó file .md navega: openTab com o path absoluto do vault', async () => {
    mockReadFile({
      [CANVAS_PATH]: JSON.stringify(FIXTURE),
      'C:\\MyVault\\Subpasta\\Nota Alvo.md': 'corpo',
    });
    const openTabSpy = vi.fn();
    const originalOpenTab = useAppStore.getState().openTab;
    useAppStore.setState({ openTab: openTabSpy });

    try {
      render(<CanvasViewer path={CANVAS_PATH} />);
      const fileNode = await screen.findByTestId('canvas-node-n2');
      fireEvent.click(fileNode);
      expect(openTabSpy).toHaveBeenCalledWith('C:\\MyVault\\Subpasta\\Nota Alvo.md');
    } finally {
      useAppStore.setState({ openTab: originalOpenTab });
    }
  });

  it('fail-soft: JSON corrompido → fallback read-only com o conteúdo cru + notificação (sem crash)', async () => {
    mockReadFile({ [CANVAS_PATH]: '{isso não é json' });

    render(<CanvasViewer path={CANVAS_PATH} />);

    const fallback = await screen.findByTestId('canvas-fallback');
    expect(fallback.textContent).toContain('{isso não é json');
    expect(
      useAppStore.getState().notifications.some((n) => n.message.includes('inválido'))
    ).toBe(true);
  });

  it('read-only por construção: NENHUM write em toda a vida do viewer (abrir + pan + zoom)', async () => {
    mockReadFile({
      [CANVAS_PATH]: JSON.stringify(FIXTURE),
      'C:\\MyVault\\Subpasta\\Nota Alvo.md': 'corpo',
    });

    render(<CanvasViewer path={CANVAS_PATH} />);
    const surface = await screen.findByTestId('canvas-surface');

    // interações de navegação (pan + zoom) — nada disso pode gerar escrita
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { clientX: 180, clientY: 140 });
    fireEvent.pointerUp(surface);
    fireEvent.wheel(surface, { deltaY: -240, clientX: 150, clientY: 150 });

    const writeCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === 'write_file' || cmd === 'export_text_file');
    expect(writeCalls).toHaveLength(0);
  });
});
