// E2 Fatia A (Spec 28) — painel de tags: carrega do índice, renderiza a árvore com
// contagens e o clique dispara a busca `#tag` (painel esquerdo + grafo, tudo reusado).
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TagsPanel from '../components/TagsPanel';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

describe('TagsPanel (E2 Fatia A)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_all_tags') {
        return [
          { tag: 'foco', count: 5 },
          { tag: 'projeto', count: 1 },
          { tag: 'projeto/mycellia', count: 2 },
        ];
      }
      return undefined;
    });

    useAppStore.setState({ isIndexing: false });
  });

  it('carrega as tags do índice e renderiza a árvore com contagens agregadas', async () => {
    render(<TagsPanel />);

    await waitFor(() => {
      expect(screen.getByText('foco')).toBeInTheDocument();
      expect(screen.getByText('projeto')).toBeInTheDocument();
    });

    // Contagem agregada do pai: 1 (própria) + 2 (mycellia) = 3
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    // Filha começa recolhida
    expect(screen.queryByText('mycellia')).toBeNull();
  });

  it('expande a tag aninhada pelo caret e clicar numa tag dispara a busca', async () => {
    const setLeftPanelModeSpy = vi.fn();
    const setGraphSearchQuerySpy = vi.fn();
    useAppStore.setState({
      setLeftPanelMode: setLeftPanelModeSpy,
      setGraphSearchQuery: setGraphSearchQuerySpy,
    });

    render(<TagsPanel />);

    await waitFor(() => {
      expect(screen.getByText('projeto')).toBeInTheDocument();
    });

    // Expande "projeto" → filha aparece
    fireEvent.click(screen.getByRole('button', { name: 'Expandir' }));
    expect(screen.getByText('mycellia')).toBeInTheDocument();

    // Clique na filha → busca pelo caminho COMPLETO
    fireEvent.click(screen.getByTitle('Buscar #projeto/mycellia'));
    expect(setLeftPanelModeSpy).toHaveBeenCalledWith('search');
    expect(setGraphSearchQuerySpy).toHaveBeenCalledWith('#projeto/mycellia');
  });

  it('vault sem tags mostra o estado vazio educativo', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === 'get_all_tags' ? [] : undefined,
    );

    render(<TagsPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Nenhuma tag no vault ainda/i)).toBeInTheDocument();
    });
  });
});
