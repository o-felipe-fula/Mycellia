import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import BacklinksPanel from '../components/BacklinksPanel';
import { useAppStore } from '../store/appStore';

describe('BacklinksPanel — conexões bidirecionais (entrada + saída)', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeNoteBacklinks: [],
      activeNoteOutgoingLinks: [],
      isBacklinksLoading: false,
    });
    vi.clearAllMocks();
  });

  it('deve mostrar as duas seções com os estados vazios', () => {
    render(<BacklinksPanel />);
    expect(screen.getByText('Apontam para cá')).toBeInTheDocument();
    expect(screen.getByText('Esta nota aponta para')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma nota aponta para esta ainda.')).toBeInTheDocument();
    expect(screen.getByText('Esta nota não referencia nenhuma outra.')).toBeInTheDocument();
  });

  it('cenário do relato: Nota 1 com [[Nota 2]] deve ver a Nota 2 na seção de saída', () => {
    // Na Nota 1 (origem), não há backlinks de entrada — mas a saída DEVE aparecer
    useAppStore.setState({
      activeNoteBacklinks: [],
      activeNoteOutgoingLinks: [
        { target_name: 'Nota 2', target_path: 'C:\\Vaults\\Mycellia\\Nota 2.md', target_title: 'Nota 2' },
      ],
    });
    render(<BacklinksPanel />);

    expect(screen.getByText('Nenhuma nota aponta para esta ainda.')).toBeInTheDocument();
    expect(screen.getByText('Nota 2')).toBeInTheDocument();
  });

  it('deve renderizar entrada e saída juntas, com link não-resolvido marcado como "criar"', () => {
    useAppStore.setState({
      activeNoteBacklinks: [
        { source_path: 'C:\\Vaults\\Mycellia\\Origem.md', source_title: 'Origem', context: 'Link para [[Ativa]]' },
      ],
      activeNoteOutgoingLinks: [
        { target_name: 'Destino Existente', target_path: 'C:\\Vaults\\Mycellia\\Destino Existente.md', target_title: 'Destino Existente' },
        { target_name: 'Destino Futuro', target_path: null, target_title: null },
      ],
    });
    render(<BacklinksPanel />);

    expect(screen.getByText('Origem')).toBeInTheDocument();
    expect(screen.getByText('Destino Existente')).toBeInTheDocument();
    expect(screen.getByText('Destino Futuro')).toBeInTheDocument();
    expect(screen.getByText('criar')).toBeInTheDocument();
    expect(screen.getByTitle('Nota ainda não criada — clique para criar')).toBeInTheDocument();
  });

  it('clique em saída resolvida abre a nota; em não-resolvida cria via handleWikiLinkClick', () => {
    const openTabSpy = vi.fn();
    const wikiClickSpy = vi.fn();
    useAppStore.setState({
      openTab: openTabSpy,
      handleWikiLinkClick: wikiClickSpy,
      activeNoteOutgoingLinks: [
        { target_name: 'Existente', target_path: 'C:\\Vaults\\Mycellia\\Existente.md', target_title: 'Existente' },
        { target_name: 'Nova Nota', target_path: null, target_title: null },
      ],
    });
    render(<BacklinksPanel />);

    fireEvent.click(screen.getByText('Existente'));
    expect(openTabSpy).toHaveBeenCalledWith('C:\\Vaults\\Mycellia\\Existente.md');
    expect(wikiClickSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Nova Nota'));
    expect(wikiClickSpy).toHaveBeenCalledWith('Nova Nota');
  });
});
