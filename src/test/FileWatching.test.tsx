import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

interface TestWindow extends Window {
  __triggerTauriEvent?: (event: string, payload: unknown) => void;
}

let mockFiles: Record<string, string> = {};

describe('File Watching and Disk Synchronization tests', () => {
  beforeEach(() => {
    mockFiles = {
      'C:\\MyVault\\Nota A.md': '---\r\ntitle:   Nota A\r\ntags: [rust]\r\n---   \r\nConteúdo Original da Nota A',
      'C:\\MyVault\\Nota B.md': 'Conteúdo Original da Nota B',
    };

    const store = useAppStore.getState();
    store.closeVault();

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
        const children = Object.keys(mockFiles).map((path) => {
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
        const key = Object.keys(mockFiles).find((k) => k.replace(/\\/g, '/') === normalized);
        if (key) {
          return mockFiles[key];
        }
        throw new Error(`File not found: ${path}`);
      }
      if (cmd === 'write_file') {
        const { path, content } = args as { path: string; content: string };
        const normalized = path.replace(/\\/g, '/');
        const key = Object.keys(mockFiles).find((k) => k.replace(/\\/g, '/') === normalized) || path;
        mockFiles[key] = content;
        return;
      }
      if (cmd === 'get_all_notes') {
        return Object.keys(mockFiles).map((path) => {
          const basename = path.split('\\').pop()?.replace('.md', '') || '';
          return { path, basename };
        });
      }
      if (cmd === 'get_backlinks') {
        return [];
      }
      if (cmd === 'start_watching' || cmd === 'stop_watching') {
        return;
      }
      return;
    });
  });

  it('Corrida do Eco: não deve disparar recarga se o evento do watcher for um eco de nossa própria escrita', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');

    // Registra o listener de mudanças
    const unlisten = await useAppStore.getState().setupVaultChangeListener();

    // Edita e salva (salvar atualiza o base)
    await useAppStore.getState().updateActiveNoteContent('Nova edição local');
    await useAppStore.getState().flushPendingSave();

    // Dispara evento de watcher indicando que foi eco
    (window as TestWindow).__triggerTauriEvent?.('vault-change', [
      { path: 'C:\\MyVault\\Nota A.md', changeType: 'modify', isEcho: true },
    ]);

    expect(useAppStore.getState().conflictModal).toBeNull();
    expect(useAppStore.getState().activeNoteContent).toBe('Nova edição local');

    unlisten();
  });

  it('Recarga Silenciosa com Blink: deve recarregar a nota com frontmatter irregular se alterada sem edições locais', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');

    const unlisten = await useAppStore.getState().setupVaultChangeListener();

    // Nota no disco é alterada externamente
    mockFiles['C:\\MyVault\\Nota A.md'] = '---\r\ntitle:   Nota A\r\ntags: [rust]\r\n---   \r\nConteúdo Alterado Externamente';

    // Dispara modificação (não-eco)
    (window as TestWindow).__triggerTauriEvent?.('vault-change', [
      { path: 'C:\\MyVault\\Nota A.md', changeType: 'modify', isEcho: false },
    ]);

    // Como não há edições locais, deve recarregar silenciosamente
    // Usamos setTimeout ou esperamos a Promise resolver já que loadActiveNote roda async
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(useAppStore.getState().conflictModal).toBeNull();
    expect(useAppStore.getState().activeNoteContent).toBe('Conteúdo Alterado Externamente');

    unlisten();
  });

  it('Conflito de Modificação: deve exibir modal de conflito se nota ativa for alterada com edições locais', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');

    const unlisten = await useAppStore.getState().setupVaultChangeListener();

    // Usuário edita localmente sem salvar
    await useAppStore.getState().updateActiveNoteContent('Alteração Local do Usuário');

    // Nota no disco é alterada externamente
    mockFiles['C:\\MyVault\\Nota A.md'] = '---\r\ntitle:   Nota A\r\ntags: [rust]\r\n---   \r\nConteúdo do Disco Diferente';

    // Dispara modificação
    (window as TestWindow).__triggerTauriEvent?.('vault-change', [
      { path: 'C:\\MyVault\\Nota A.md', changeType: 'modify', isEcho: false },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Deve abrir o modal de conflito de modificação
    const modal = useAppStore.getState().conflictModal;
    expect(modal).not.toBeNull();
    expect(modal?.path).toBe('C:\\MyVault\\Nota A.md');
    expect(modal?.diskContent).toBe('---\r\ntitle:   Nota A\r\ntags: [rust]\r\n---   \r\nConteúdo do Disco Diferente');

    // Testar resolução: manter alteração local (sobrescreve disco)
    await useAppStore.getState().resolveConflict('keep-local');
    expect(useAppStore.getState().conflictModal).toBeNull();
    expect(useAppStore.getState().activeNoteContent).toBe('Alteração Local do Usuário');
    expect(mockFiles['C:\\MyVault\\Nota A.md']).toContain('Alteração Local do Usuário');

    unlisten();
  });

  it('Conflito de Deleção: deve exibir modal de conflito de exclusão e fechar ou salvar/recriar', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');

    const unlisten = await useAppStore.getState().setupVaultChangeListener();

    // Usuário edita localmente
    await useAppStore.getState().updateActiveNoteContent('Alterações Locais Importantes');

    // Nota deletada no disco
    delete mockFiles['C:\\MyVault\\Nota A.md'];

    // Dispara deleção
    (window as TestWindow).__triggerTauriEvent?.('vault-change', [
      { path: 'C:\\MyVault\\Nota A.md', changeType: 'delete', isEcho: false },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Deve abrir o modal de conflito com diskContent: null
    const modal = useAppStore.getState().conflictModal;
    expect(modal).not.toBeNull();
    expect(modal?.path).toBe('C:\\MyVault\\Nota A.md');
    expect(modal?.diskContent).toBeNull();

    // Resolve: salvar e recriar
    await useAppStore.getState().resolveConflict('keep-local');
    expect(useAppStore.getState().conflictModal).toBeNull();
    expect(mockFiles['C:\\MyVault\\Nota A.md']).toContain('Alterações Locais Importantes');

    unlisten();
  });

  it('test_conflict_uses_frozen_snapshot: deve garantir que a resolucao de conflito use o snapshot congelado mesmo que o buffer seja limpo apos falha de leitura transitoria', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');

    const unlisten = await useAppStore.getState().setupVaultChangeListener();

    // 1. Usuário edita localmente e salva via autosave (dirty = false, base atualizado)
    const contentUsuario = 'Edição congelada do usuário';
    await useAppStore.getState().updateActiveNoteContent(contentUsuario);
    await useAppStore.getState().flushPendingSave();
    expect(useAppStore.getState().activeNoteContent).toBe(contentUsuario);

    // 2. Simula falha de leitura transitória no read_file deletando o arquivo do mock
    delete mockFiles['C:\\MyVault\\Nota A.md'];

    // 3. Watcher envia 'modify'
    (window as TestWindow).__triggerTauriEvent?.('vault-change', [
      { path: 'C:\\MyVault\\Nota A.md', changeType: 'modify', isEcho: false },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // O catch de loadActiveNote NÃO deve limpar o activeNoteContent porque a nota já estava carregada
    expect(useAppStore.getState().activeNoteContent).toBe(contentUsuario);

    // 4. Usuário faz mais edições locais (dirty = true)
    await useAppStore.getState().updateActiveNoteContent(contentUsuario + ' mais edicoes');

    // 5. Watcher envia 'delete'
    (window as TestWindow).__triggerTauriEvent?.('vault-change', [
      { path: 'C:\\MyVault\\Nota A.md', changeType: 'delete', isEcho: false },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // O modal de conflito deve estar aberto e com o snapshot congelado correto
    const modal = useAppStore.getState().conflictModal;
    expect(modal).not.toBeNull();
    expect(modal?.localContentSnapshot).toContain(contentUsuario + ' mais edicoes');

    // 6. Resolve mantendo o local, gravando no disco o snapshot congelado
    await useAppStore.getState().resolveConflict('keep-local');
    expect(useAppStore.getState().conflictModal).toBeNull();
    expect(mockFiles['C:\\MyVault\\Nota A.md']).toContain(contentUsuario + ' mais edicoes');

    unlisten();
  });

  it('test_autosave_failure_preserves_buffer: o erro de write_file no autosave deve preservar o buffer local em memoria e manter o estado dirty', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');

    // Salva o mock original
    const originalMock = vi.mocked(invoke).getMockImplementation();

    // Sobrescreve temporariamente para simular falha no write_file
    vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
      if (cmd === 'write_file') {
        throw new Error('Disk write failed');
      }
      if (originalMock) {
        return originalMock(cmd, args as Record<string, unknown>);
      }
      return undefined;
    });

    const newContent = 'Nova alteracao local';
    await useAppStore.getState().updateActiveNoteContent(newContent);

    // O editor deve estar dirty
    expect(useAppStore.getState().activeNoteContent).toBe(newContent);
    expect(useAppStore.getState().activeNoteBaseSerialized).not.toBe(newContent);

    // Dispara flush (que chamará write_file e falhará)
    await useAppStore.getState().flushPendingSave();

    // O buffer na store NÃO foi zerado/limpo e o estado permanece dirty
    expect(useAppStore.getState().activeNoteContent).toBe(newContent);
    expect(useAppStore.getState().activeNoteBaseSerialized).not.toBe(newContent);

    // Restaura o mock original
    if (originalMock) {
      vi.mocked(invoke).mockImplementation(originalMock);
    }
  });

  it('Falso-delete do Watcher (Windows): nao deve fechar a aba se o arquivo ainda existir no disco', async () => {
    await useAppStore.getState().initApp();
    useAppStore.setState({ platform: 'windows' });
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');
    const unlisten = await useAppStore.getState().setupVaultChangeListener();

    // O arquivo existe no disco (mockFiles contém o path)
    expect(mockFiles['C:\\MyVault\\Nota A.md']).toBeDefined();

    // Watcher emite evento 'delete'
    (window as TestWindow).__triggerTauriEvent?.('vault-change', [
      { path: 'C:\\MyVault\\Nota A.md', changeType: 'delete', isEcho: false },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // A aba NAO deve fechar porque o arquivo fisico ainda existe
    expect(useAppStore.getState().activeTab).toBe('C:\\MyVault\\Nota A.md');
    unlisten();
  });

  it('Falso-delete do Watcher (Linux): nao deve fechar a aba se o arquivo ainda existir no disco', async () => {
    await useAppStore.getState().initApp();
    useAppStore.setState({ platform: 'linux' });
    
    // Adiciona uma nota com path estilo Linux no mockFiles
    mockFiles['/home/user/vault/Nota Linux.md'] = 'Conteudo da Nota Linux';
    
    await useAppStore.getState().openTab('/home/user/vault/Nota Linux.md');
    const unlisten = await useAppStore.getState().setupVaultChangeListener();

    // O arquivo existe no disco (mockFiles contém o path)
    expect(mockFiles['/home/user/vault/Nota Linux.md']).toBeDefined();

    // Watcher emite evento 'delete'
    (window as TestWindow).__triggerTauriEvent?.('vault-change', [
      { path: '/home/user/vault/Nota Linux.md', changeType: 'delete', isEcho: false },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // A aba NAO deve fechar porque o arquivo fisico ainda existe
    expect(useAppStore.getState().activeTab).toBe('/home/user/vault/Nota Linux.md');
    unlisten();
  });

  it('Delete Real do Watcher (Windows): deve fechar a aba se o arquivo nao existir mais no disco', async () => {
    await useAppStore.getState().initApp();
    useAppStore.setState({ platform: 'windows' });
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');
    const unlisten = await useAppStore.getState().setupVaultChangeListener();

    // O arquivo some de fato
    delete mockFiles['C:\\MyVault\\Nota A.md'];

    // Watcher emite evento 'delete'
    (window as TestWindow).__triggerTauriEvent?.('vault-change', [
      { path: 'C:\\MyVault\\Nota A.md', changeType: 'delete', isEcho: false },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // A aba deve ser fechada pois o arquivo de fato sumiu do disco
    expect(useAppStore.getState().activeTab).toBeNull();
    unlisten();
  });

  it('Delete Real do Watcher (Linux): deve fechar a aba se o arquivo nao existir mais no disco', async () => {
    await useAppStore.getState().initApp();
    useAppStore.setState({ platform: 'linux' });
    
    // Adiciona nota Linux
    mockFiles['/home/user/vault/Nota Linux.md'] = 'Conteudo da Nota Linux';
    
    await useAppStore.getState().openTab('/home/user/vault/Nota Linux.md');
    const unlisten = await useAppStore.getState().setupVaultChangeListener();

    // O arquivo some de fato
    delete mockFiles['/home/user/vault/Nota Linux.md'];

    // Watcher emite evento 'delete'
    (window as TestWindow).__triggerTauriEvent?.('vault-change', [
      { path: '/home/user/vault/Nota Linux.md', changeType: 'delete', isEcho: false },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // A aba deve ser fechada pois o arquivo de fato sumiu do disco
    expect(useAppStore.getState().activeTab).toBeNull();
    unlisten();
  });

  it('Wiki-link Desempate (Linux): prioriza exato, fallback para case-insensitive e avisa sobre colisao', async () => {
    await useAppStore.getState().initApp();
    useAppStore.setState({ 
      platform: 'linux',
      currentVault: '/home/user/vault'
    });

    // Mock das duas notas que diferem apenas no caso
    mockFiles['/home/user/vault/Nota.md'] = 'Conteudo de Nota Caps';
    mockFiles['/home/user/vault/nota.md'] = 'Conteudo de nota Lower';

    // Atualiza a lista de notas existentes na store
    await useAppStore.getState().refreshExistingNotes();

    // 1. [[Nota]] deve abrir /home/user/vault/Nota.md (match exato)
    await useAppStore.getState().handleWikiLinkClick('Nota');
    expect(useAppStore.getState().activeTab).toBe('/home/user/vault/Nota.md');

    // 2. [[nota]] deve abrir /home/user/vault/nota.md (match exato)
    await useAppStore.getState().handleWikiLinkClick('nota');
    expect(useAppStore.getState().activeTab).toBe('/home/user/vault/nota.md');

    // 3. [[NOTA]] (sem match exato) deve cair no fallback e disparar aviso de ambiguidade
    useAppStore.setState({ globalError: null });
    await useAppStore.getState().handleWikiLinkClick('NOTA');
    
    // Deve abrir uma das duas notas (pelo menos resolve para uma delas, por ex Nota.md ou nota.md)
    expect(useAppStore.getState().activeTab).toBeDefined();
    
    // Deve disparar o aviso de colisão no globalError
    expect(useAppStore.getState().globalError).toContain('Aviso de Ambiguidade: Múltiplos arquivos colidindo insensivelmente');
  });
});
