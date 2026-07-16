import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StatusBar from '../components/StatusBar';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

describe('StatusBar Component', () => {
  beforeEach(() => {
    useAppStore.setState({
      currentVault: 'C:\\Vaults\\Mycellia',
      fileTree: {
        name: 'Mycellia',
        path: 'C:\\Vaults\\Mycellia',
        is_dir: true,
        children: [
          { name: 'Nota 1.md', path: 'C:\\Vaults\\Mycellia\\Nota 1.md', is_dir: false },
          { name: 'Nota 2.md', path: 'C:\\Vaults\\Mycellia\\Nota 2.md', is_dir: false },
          {
            name: 'Pasta',
            path: 'C:\\Vaults\\Mycellia\\Pasta',
            is_dir: true,
            children: [
              { name: 'Nota 3.md', path: 'C:\\Vaults\\Mycellia\\Pasta\\Nota 3.md', is_dir: false },
            ],
          },
        ],
      },
      isIndexing: false,
      indexingProgressText: null,
      isWatching: true,
      activeNoteContent: 'Esta é uma nota de teste com sete palavras.',
      editorWideMode: false,
    });
  });

  it('deve renderizar o nome do vault e contagem de arquivos corretos', () => {
    render(<StatusBar />);
    expect(screen.getByText('Mycellia')).toBeInTheDocument();
    // 3 arquivos não-diretórios na árvore
    expect(screen.getByText('3 arquivos')).toBeInTheDocument();
  });

  it('deve exibir o status do watcher como ativo', () => {
    render(<StatusBar />);
    expect(screen.getByText('Watch ativo')).toBeInTheDocument();
  });

  it('deve exibir o status do watcher como inativo (neutro) se isWatching for falso', () => {
    useAppStore.setState({ isWatching: false });
    render(<StatusBar />);
    expect(screen.getByText('Watch inativo')).toBeInTheDocument();
    const span = screen.getByText('Watch inativo');
    expect(span.className).toContain('text-[var(--text-muted)]');
  });

  it('deve exibir status de indexado quando não estiver indexando', () => {
    render(<StatusBar />);
    expect(screen.getByText('Índice atualizado')).toBeInTheDocument();
  });

  it('deve exibir status de indexando e a contagem de progresso', () => {
    useAppStore.setState({ isIndexing: true, indexingProgressText: '120/1500' });
    render(<StatusBar />);
    expect(screen.getByText('Indexando (120/1500)…')).toBeInTheDocument();
  });

  it('deve exibir status de indexando (iniciando) se o progresso for nulo', () => {
    useAppStore.setState({ isIndexing: true, indexingProgressText: null });
    render(<StatusBar />);
    expect(screen.getByText('Indexando (iniciando)…')).toBeInTheDocument();
  });

  it('deve calcular a contagem de palavras com debounce', async () => {
    vi.useFakeTimers();
    render(<StatusBar />);

    // Inicialmente deve mostrar 0 palavras antes do debounce
    expect(screen.getByText('0 palavras')).toBeInTheDocument();

    // Passar o tempo do debounce (300ms)
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Agora deve calcular: "Esta é uma nota de teste com sete palavras." = 9 palavras
    expect(screen.getByText('9 palavras')).toBeInTheDocument();

    vi.useRealTimers();
  });

  // E1 (Spec 25) — toggle da largura da linha do editor
  it('deve exibir o toggle de largura como "Confortável" por default e alternar para "Cheia" persistindo no config', () => {
    render(<StatusBar />);

    const toggle = screen.getByRole('button', { name: /alternar largura da linha/i });
    expect(toggle).toHaveTextContent('Confortável');

    fireEvent.click(toggle);

    expect(useAppStore.getState().editorWideMode).toBe(true);
    expect(toggle).toHaveTextContent('Cheia');
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      'save_config',
      expect.objectContaining({
        config: expect.objectContaining({ editor_wide_mode: true }),
      }),
    );

    // Alterna de volta e persiste false
    fireEvent.click(toggle);
    expect(useAppStore.getState().editorWideMode).toBe(false);
    expect(toggle).toHaveTextContent('Confortável');
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      'save_config',
      expect.objectContaining({
        config: expect.objectContaining({ editor_wide_mode: false }),
      }),
    );
  });

  it('não exibe o toggle de largura quando nenhuma nota está aberta', () => {
    useAppStore.setState({ activeNoteContent: null });
    render(<StatusBar />);
    expect(screen.queryByRole('button', { name: /alternar largura da linha/i })).toBeNull();
  });
});
