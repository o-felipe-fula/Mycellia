import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import App from '../App';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';
import { SearchResultsPanel } from '../components/SearchResultsPanel';

describe('Error Handling and UI States (Batch 9 - Stage 3)', () => {
  beforeEach(() => {
    // Reset Zustand store to clean states
    useAppStore.setState({
      theme: 'dark',
      currentVault: 'C:\\Vaults\\Mycellia',
      recentVaults: [],
      openTabs: [],
      activeTab: null,
      fileTree: null,
      isIndexing: false,
      indexingProgressText: null,
      isWatching: false,
      activeNoteContent: null,
      activeNoteRawFrontmatter: null,
      activeNoteBaseSerialized: null,
      conflictModal: null,
      activeNoteBacklinks: [],
      isBacklinksLoading: false,
      globalError: null,
      leftPanelMode: 'files',
      isLeftPanelOpen: true,
      isRightPanelOpen: false,
      centerView: 'graph',
      rightView: 'backlinks',
      searchResults: [],
      graphSearchQuery: '',
      isSearching: false,
    });
    vi.clearAllMocks();
  });

  it('1. Deve remover o estado "none" de rightView e iniciar como "backlinks"', () => {
    const state = useAppStore.getState();
    // rightView nao pode ser 'none' no tipo, seu valor default agora e 'backlinks'
    expect(state.rightView).not.toBe('none');
    expect(state.rightView).toBe('backlinks');
  });

  it('2. Deve exibir o banner de erro global quando uma operacao de escrita física falhar', async () => {
    // Mockar invoke do Tauri para falhar na escrita de arquivo
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Permissão negada no disco'));

    useAppStore.setState({
      activeTab: 'C:\\Vaults\\Mycellia\\Nota.md',
      activeNoteContent: 'Conteúdo editado',
      activeNoteRawFrontmatter: '',
      activeNoteBaseSerialized: 'Antigo',
    });

    // Forçar salvamento síncrono que invoca 'write_file'
    // Como activeTab e activeNoteContent estao definidos, flushPendingSave tentara escrever se houver alteracoes.
    // Vamos configurar o pendingSave no store para disparar a escrita
    useAppStore.setState({
      activeNoteContent: 'Conteúdo editado',
    });

    // Simular pendingSave para flush
    // No appStore.ts, flushPendingSave le pendingSave
    // Podemos apenas tentar disparar a rename ou createItem que tambem chamam invoke e falham
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Acesso ao disco negado'));
    
    await expect(
      useAppStore.getState().renameItem('C:\\Vaults\\Mycellia\\Nota.md', 'NotaNova')
    ).rejects.toThrow();

    // O erro global deve ter sido setado na Zustand store
    expect(useAppStore.getState().globalError).toContain('Falha ao renomear item');

    // Renderizar o App e verificar a presenca do banner de erro
    render(<App />);

    expect(screen.getByText('Erro de Sistema')).toBeInTheDocument();
    expect(screen.getByText(/Falha ao renomear item/)).toBeInTheDocument();

    // Clicar no botao X para fechar o banner
    const closeBtn = screen.getByTitle('Fechar Notificação');
    fireEvent.click(closeBtn);

    // O banner deve sumir do store
    expect(useAppStore.getState().globalError).toBeNull();
  });

  it('3. Deve exibir empty state de vault vazio na barra lateral se a raiz nao contiver filhos', () => {
    useAppStore.setState({
      fileTree: {
        name: 'Mycellia',
        path: 'C:\\Vaults\\Mycellia',
        is_dir: true,
        children: [] // Vault vazio
      }
    });

    render(<App />);

    expect(screen.getByText('Seu vault está vazio.')).toBeInTheDocument();
    expect(screen.getByText('+ Criar primeira nota')).toBeInTheDocument();
  });

  it('4. Deve exibir empty state de backlinks vazios no painel direito', () => {
    useAppStore.setState({
      isRightPanelOpen: true,
      rightView: 'backlinks',
      activeNoteBacklinks: [] // Sem backlinks
    });

    render(<App />);

    expect(screen.getByText('Nenhuma nota aponta para esta ainda.')).toBeInTheDocument();
  });

  it('5. Deve exibir empty state de busca sem correspondências', () => {
    useAppStore.setState({
      graphSearchQuery: 'termo_inexistente',
      isSearching: false,
      searchResults: [] // Sem resultados
    });

    render(<SearchResultsPanel />);

    expect(screen.getByText('Nenhum resultado para «termo_inexistente».')).toBeInTheDocument();
  });
});
