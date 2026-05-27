import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

// Dicionário simulando o sistema de arquivos
let mockFiles: Record<string, string> = {};

describe('Bug 3 Overwrite Regression Test (Self-contained Pending Save)', () => {
  beforeEach(() => {
    // Reseta o estado do sistema de arquivos mock
    mockFiles = {
      'C:\\MyVault\\Nota A.md': 'Conteúdo Original da Nota A',
      'C:\\MyVault\\Nota B.md': 'Conteúdo Original da Nota B',
    };

    // Fecha o vault e reseta o estado da store
    const store = useAppStore.getState();
    store.closeVault();

    // Configura a implementação específica do invoke para este teste
    vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
      if (cmd === 'load_config') {
        return {
          current_vault: 'C:\\MyVault',
          recent_vaults: ['C:\\MyVault'],
          theme: 'dark',
          sidebar_width: 260,
        };
      }
      if (cmd === 'load_vault_tree') {
        const children = Object.keys(mockFiles).map(path => {
          const name = path.split('\\').pop() || '';
          return { name, path, is_dir: false };
        });
        return {
          name: 'MyVault',
          path: 'C:\\MyVault',
          is_dir: true,
          children,
        };
      }
      if (cmd === 'read_file') {
        const path = (args as { path: string })?.path;
        const normalized = path.replace(/\\/g, '/');
        const key = Object.keys(mockFiles).find(k => k.replace(/\\/g, '/') === normalized);
        if (key) {
          return mockFiles[key];
        }
        throw new Error(`File not found: ${path}`);
      }
      if (cmd === 'write_file') {
        const { path, content } = args as { path: string; content: string };
        const normalized = path.replace(/\\/g, '/');
        const key = Object.keys(mockFiles).find(k => k.replace(/\\/g, '/') === normalized) || path;
        mockFiles[key] = content;
        return;
      }
      if (cmd === 'create_item') {
        const { parentPath, name } = args as { parentPath: string; name: string };
        const newPath = `${parentPath}\\${name}`;
        mockFiles[newPath] = '';
        return newPath;
      }
      if (cmd === 'get_all_notes') {
        return Object.keys(mockFiles).map(path => {
          const basename = path.split('\\').pop()?.replace('.md', '') || '';
          return { path, basename };
        });
      }
      if (cmd === 'get_backlinks') {
        return [];
      }
      return;
    });
  });

  it('deve salvar a nota A no disco e carregar a nota B de forma independente, sem corrupção de dados', async () => {
    // 1. Inicializa o aplicativo (isso dispara initApp e carrega o vault)
    await useAppStore.getState().initApp();

    // 2. Abre a Nota A
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');
    expect(useAppStore.getState().activeTab).toBe('C:\\MyVault\\Nota A.md');
    expect(useAppStore.getState().activeNoteContent).toBe('Conteúdo Original da Nota A');

    // 3. Edita o conteúdo da Nota A
    await useAppStore.getState().updateActiveNoteContent('Conteúdo Editado da Nota A');
    expect(useAppStore.getState().activeNoteContent).toBe('Conteúdo Editado da Nota A');

    // 4. Alterna para a Nota B
    await useAppStore.getState().openTab('C:\\MyVault\\Nota B.md');

    // 5. Validação de integridade física
    // - O estado ativo deve ser o da Nota B
    expect(useAppStore.getState().activeTab).toBe('C:\\MyVault\\Nota B.md');
    expect(useAppStore.getState().activeNoteContent).toBe('Conteúdo Original da Nota B');

    // - O arquivo B no disco deve continuar exatamente igual ao original (sem sobrescrita)
    expect(mockFiles['C:\\MyVault\\Nota B.md']).toBe('Conteúdo Original da Nota B');

    // - O arquivo A no disco deve ter sido salvo com a modificação realizada
    expect(mockFiles['C:\\MyVault\\Nota A.md']).toBe('Conteúdo Editado da Nota A');
  });

  it('deve salvar as propriedades (frontmatter) da nota A no disco e carregar a nota B de forma independente, sem corrupção', async () => {
    await useAppStore.getState().initApp();

    // 1. Abre a Nota A
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');
    expect(useAppStore.getState().activeNoteContent).toBe('Conteúdo Original da Nota A');

    // 2. Edita as propriedades (frontmatter) da Nota A
    await useAppStore.getState().updateActiveNoteFrontmatter((doc) => {
      doc.set('author', 'Felipe Fulanetti');
    });

    // 3. Alterna imediatamente para a Nota B (sem esperar o debounce de 500ms)
    await useAppStore.getState().openTab('C:\\MyVault\\Nota B.md');

    // 4. Validação de integridade física
    // - O estado ativo deve ser o da Nota B
    expect(useAppStore.getState().activeTab).toBe('C:\\MyVault\\Nota B.md');
    expect(useAppStore.getState().activeNoteContent).toBe('Conteúdo Original da Nota B');

    // - O arquivo B no disco deve continuar exatamente igual ao original (sem sobrescrita)
    expect(mockFiles['C:\\MyVault\\Nota B.md']).toBe('Conteúdo Original da Nota B');

    // - O arquivo A no disco deve ter sido salvo com a propriedade editada e mantido o corpo
    expect(mockFiles['C:\\MyVault\\Nota A.md']).toContain('author: Felipe Fulanetti');
    expect(mockFiles['C:\\MyVault\\Nota A.md']).toContain('Conteúdo Original da Nota A');
  });

  it('deve salvar pendencias de Nota A no disco e criar e carregar Nota C ao clicar em link inexistente (test_wiki_link_click_transition_save)', async () => {
    await useAppStore.getState().initApp();

    // 1. Abre a Nota A
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');
    expect(useAppStore.getState().activeNoteContent).toBe('Conteúdo Original da Nota A');

    // 2. Edita o conteúdo da Nota A
    await useAppStore.getState().updateActiveNoteContent('Conteúdo da Nota A com link para [[Nota C]]');

    // 3. Simula clique em [[Nota C]] (que ainda não existe)
    await useAppStore.getState().handleWikiLinkClick('Nota C');

    // 4. Validações
    // - Nota A foi salva no disco com o conteúdo editado
    expect(mockFiles['C:\\MyVault\\Nota A.md']).toBe('Conteúdo da Nota A com link para [[Nota C]]');

    // - Nota C foi criada no disco vazia
    expect(mockFiles['C:\\MyVault\\Nota C.md']).toBe('');

    // - Aba ativa agora é a Nota C (com caminho nativo)
    expect(useAppStore.getState().activeTab).toBe('C:\\MyVault\\Nota C.md');
    expect(useAppStore.getState().activeNoteContent).toBe('');
  });
});
