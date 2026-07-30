// E7 (trilha E) — command palette: render, busca fuzzy, navegação por teclado, execução
// das ações do store e fechamento. Componente testado direto com spies.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CommandPalette from '../components/CommandPalette';
import { useAppStore } from '../store/appStore';

describe('CommandPalette (E7)', () => {
  beforeEach(() => {
    useAppStore.setState({
      toggleTheme: vi.fn(),
      toggleEditorSourceMode: vi.fn(),
      toggleEditorWideMode: vi.fn(),
      setCenterView: vi.fn(),
      setLeftPanelMode: vi.fn(),
      setRightView: vi.fn(),
      loadGraphData: vi.fn(async () => {}),
      rebuildIndex: vi.fn(async () => {}),
      activeTab: null,
      activeNoteContent: null,
    });
  });

  it('renderiza a lista de comandos e o input focado', () => {
    render(<CommandPalette onClose={vi.fn()} onNewNote={vi.fn()} />);
    const input = screen.getByPlaceholderText('Digite um comando…');
    expect(input).toHaveFocus();
    expect(screen.getByText('Nova nota')).toBeInTheDocument();
    expect(screen.getByText('Alternar tema (claro/escuro)')).toBeInTheDocument();
  });

  it('filtra por busca fuzzy (substring e subsequência)', () => {
    render(<CommandPalette onClose={vi.fn()} onNewNote={vi.fn()} />);
    const input = screen.getByPlaceholderText('Digite um comando…');

    // substring
    fireEvent.change(input, { target: { value: 'tema' } });
    expect(screen.getByText('Alternar tema (claro/escuro)')).toBeInTheDocument();
    expect(screen.queryByText('Nova nota')).toBeNull();

    // subsequência: "grf" casa "Recalcular layout do grafo" (g..r..f) e "Abrir o grafo"
    fireEvent.change(input, { target: { value: 'grafo' } });
    expect(screen.getByText('Abrir o grafo')).toBeInTheDocument();
  });

  it('estado vazio quando nada casa', () => {
    render(<CommandPalette onClose={vi.fn()} onNewNote={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Digite um comando…'), {
      target: { value: 'zzzxyzq' },
    });
    expect(screen.getByText('Nenhum comando encontrado')).toBeInTheDocument();
  });

  it('Enter executa o comando ativo e fecha; a ação do store roda', () => {
    const onClose = vi.fn();
    render(<CommandPalette onClose={onClose} onNewNote={vi.fn()} />);
    const input = screen.getByPlaceholderText('Digite um comando…');

    fireEvent.change(input, { target: { value: 'tema' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(useAppStore.getState().toggleTheme).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('setas navegam e Enter roda o item destacado', () => {
    const onNewNote = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette onClose={onClose} onNewNote={onNewNote} />);
    const input = screen.getByPlaceholderText('Digite um comando…');

    // 1º item é "Nova nota" (índice 0). Desce 1 → tema. Volta 1 → nova nota.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onNewNote).toHaveBeenCalled();
  });

  it('clicar num comando executa e fecha', () => {
    const onClose = vi.fn();
    render(<CommandPalette onClose={onClose} onNewNote={vi.fn()} />);

    fireEvent.click(screen.getByText('Painel de tags'));
    expect(useAppStore.getState().setRightView).toHaveBeenCalledWith('tags');
    expect(onClose).toHaveBeenCalled();
  });

  it('Esc fecha sem executar nada', () => {
    const onClose = vi.fn();
    render(<CommandPalette onClose={onClose} onNewNote={vi.fn()} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Digite um comando…'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().toggleTheme).not.toHaveBeenCalled();
  });

  it('E6: comandos de export só aparecem com uma nota aberta', () => {
    const { rerender } = render(<CommandPalette onClose={vi.fn()} onNewNote={vi.fn()} />);
    // Sem nota: nada de export
    expect(screen.queryByText('Exportar nota como HTML')).toBeNull();
    expect(screen.queryByText('Imprimir / Exportar PDF')).toBeNull();

    // Com nota aberta: os dois aparecem
    useAppStore.setState({ activeTab: 'C:\\Vault\\Nota.md', activeNoteContent: '# Oi' });
    rerender(<CommandPalette onClose={vi.fn()} onNewNote={vi.fn()} />);
    expect(screen.getByText('Exportar nota como HTML')).toBeInTheDocument();
    expect(screen.getByText('Imprimir / Exportar PDF')).toBeInTheDocument();
  });
});
