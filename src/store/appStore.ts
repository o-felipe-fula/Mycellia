import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import YAML from 'yaml';
import { parseRawNote, serializeRawNote } from '../utils/markdown';
import { getFileKind } from '../utils/fileKind';

// F3 (Spec 17): os tipos de dados vivem em ./types e a telemetria de cold start em
// ./telemetry — re-exportados aqui para os 19 consumidores continuarem importando
// de '../store/appStore' sem mudança.
import type {
  NotificationType,
  AppNotification,
  NotifyOptions,
  FileNode,
  Backlink,
  OutgoingLink,
  SearchResult,
  GraphData,
  GraphPosition,
  AppConfig,
} from './types';
import { telemetry, checkAndPrintConsolidatedMetrics } from './telemetry';
import { createNotificationsSlice } from './notificationsSlice';
import { createGraphSlice } from './graphSlice';
import { createLayoutSlice } from './layoutSlice';
import { ensureDifferentViews } from './viewLayout';

export type {
  NotificationType,
  NotificationAction,
  AppNotification,
  NotifyOptions,
  FileNode,
  Backlink,
  OutgoingLink,
  GraphNode,
  GraphLink,
  SearchResult,
  TagCount,
  GraphData,
  GraphPosition,
  AppConfig,
} from './types';

export interface AppState {
  theme: 'light' | 'dark';
  currentVault: string | null;
  recentVaults: string[];
  openTabs: string[];
  activeTab: string | null;
  fileTree: FileNode | null;
  sidebarWidth: number;
  isIndexing: boolean;
  indexingProgress: number;
  isWatching: boolean;
  indexingProgressText: string | null;
  activeNoteContent: string | null;
  activeNoteRawFrontmatter: string | null;
  activeNoteYamlDoc: YAML.Document | null;
  activeNoteBaseSerialized: string | null;
  // E5 (Spec 29): path cujo conteúdo está de fato em activeNoteContent — o FileViewer só
  // monta o PlainTextEditor quando bate com activeTab (nunca com conteúdo stale de outra aba)
  activeContentPath: string | null;
  conflictModal: { path: string; diskContent: string | null; localContentSnapshot: string } | null;
  existingNotes: Map<string, string>; // Mapeia lowercase basename/relative path para absolute path
  activeNoteBacklinks: Backlink[];
  activeNoteOutgoingLinks: OutgoingLink[];
  isBacklinksLoading: boolean;

  // Graph State
  graphData: GraphData | null;
  graphViewMode: '2d' | '3d';
  graphPositions: Record<string, GraphPosition>;
  graphSearchQuery: string;
  isGraphSimulating: boolean;
  searchResults: SearchResult[];
  matchingPaths: Set<string>;
  isSearching: boolean;

  // Layout & Navigation State
  leftPanelMode: 'files' | 'search';
  isLeftPanelOpen: boolean;
  isRightPanelOpen: boolean;
  centerView: 'editor' | 'graph';
  rightView: 'backlinks' | 'graph' | 'editor' | 'tags';
  platform: string;
  rightPanelWidth: number;
  isNoteDirty: boolean;
  globalError: string | null;
  setGlobalError: (error: string | null) => void;
  notifications: AppNotification[];
  notify: (type: NotificationType, message: string, opts?: NotifyOptions) => string;
  dismissNotification: (id: string) => void;
  rebuildIndex: () => Promise<void>;

  // Ações de Inicialização e Configuração
  initApp: () => Promise<void>;
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setSidebarWidth: (width: number) => void;

  // Ações de Vault e Arquivos
  loadVault: (path: string) => Promise<void>;
  closeVault: () => Promise<void>;
  createItem: (parentPath: string, name: string, isDir: boolean) => Promise<string | undefined>;
  renameItem: (path: string, newName: string) => Promise<void>;
  moveItem: (path: string, newParentPath: string) => Promise<void>;
  deleteItem: (path: string) => Promise<void>;
  openInDefaultApp: (path: string) => Promise<void>;

  // Abas
  openTab: (path: string) => Promise<void>;
  closeTab: (path: string) => Promise<void>;
  setActiveTab: (path: string | null) => Promise<void>;

  // Edição de Notas
  loadActiveNote: (path: string) => Promise<void>;
  updateActiveNoteContent: (content: string) => Promise<void>;
  updateActiveNoteFrontmatter: (updateFn: (doc: YAML.Document) => void) => Promise<void>;
  flushPendingSave: () => Promise<void>;

  // Conflitos e Watching
  showConflictModal: (path: string, diskContent: string | null, localContentSnapshot: string) => void;
  resolveConflict: (resolution: 'keep-local' | 'load-disk') => Promise<void>;
  setupVaultChangeListener: () => Promise<UnlistenFn>;

  // Backlinks & Wiki-links
  refreshExistingNotes: () => Promise<void>;
  loadBacklinks: (path: string) => Promise<void>;
  handleWikiLinkClick: (targetName: string) => Promise<void>;

  // Graph Actions
  loadGraphData: () => Promise<void>;
  toggleGraphViewMode: () => void;
  saveGraphPositions: (positions: Record<string, GraphPosition>) => Promise<void>;
  setGraphSearchQuery: (query: string) => void;
  searchNotesFts: (query: string) => Promise<void>;

  // Layout & Navigation Actions
  setLeftPanelMode: (mode: 'files' | 'search') => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setRightPanelWidth: (width: number) => void;
  setCenterView: (view: 'editor' | 'graph') => void;
  setRightView: (view: 'backlinks' | 'graph' | 'editor' | 'tags') => void;
  swapViews: () => void;

  // E1 (Spec 25): largura da linha do editor (false = confortável, true = cheia)
  editorWideMode: boolean;
  toggleEditorWideMode: () => void;

  // E1.6 (Spec 27): modo Fonte — corpo da nota cru, sem decorações (sessão)
  editorSourceMode: boolean;
  toggleEditorSourceMode: () => void;

  // E2 Fatia B (Spec 28): heading pendente de scroll após navegar por [[Nota#Título]]
  pendingScrollToHeading: string | null;
  setPendingScrollToHeading: (heading: string | null) => void;
}

// Salva as configurações de forma atômica no Rust AppData
async function saveConfigHelper(state: {
  currentVault: string | null;
  recentVaults: string[];
  theme: 'light' | 'dark';
  sidebarWidth: number;
  editorWideMode: boolean;
  rightPanelWidth: number;
}) {
  try {
    const config: AppConfig = {
      current_vault: state.currentVault,
      recent_vaults: state.recentVaults,
      theme: state.theme,
      sidebar_width: state.sidebarWidth,
      editor_wide_mode: state.editorWideMode,
      right_panel_width: state.rightPanelWidth,
    };
    await invoke('save_config', { config });
  } catch (e) {
    console.error('Failed to save config:', e);
    useAppStore.getState().notify('warning', 'Falha ao salvar configurações.');
  }
}

// Parser and serializer imported from utils/markdown

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSave: { path: string; content: string } | null = null;

// Falha de save (F1.2): notificação persistente, com "Tentar de novo", deduplicada (uma por vez),
// preservando o texto (restaura pendingSave). O fluxo de escrita atômica em si NÃO muda.
let saveErrorNotifId: string | null = null;

function clearSaveError() {
  if (saveErrorNotifId) {
    useAppStore.getState().dismissNotification(saveErrorNotifId);
    saveErrorNotifId = null;
  }
}

function handleSaveFailure(path: string, content: string, e: unknown) {
  const msg = `Falha ao salvar a nota: ${e}`;
  console.error(msg, e);
  // Restaura o pendingSave para NÃO perder o texto e permitir o retry (botão / próximo autosave).
  pendingSave = { path, content };
  if (saveErrorNotifId) {
    useAppStore.getState().dismissNotification(saveErrorNotifId);
  }
  saveErrorNotifId = useAppStore.getState().notify('error', msg, {
    persistent: true,
    // Captura {path, content} da falha no closure: o retry salva a nota que FALHOU,
    // mesmo que o usuário tenha trocado de nota (pendingSave global pode ter mudado).
    action: {
      label: 'Tentar de novo',
      run: () => {
        pendingSave = { path, content };
        useAppStore.getState().flushPendingSave();
      },
    },
  });
}

// BUG-02: raiz do vault sumiu (renomeada/movida/excluída com o app aberto). O Rust aborta o
// batch do watcher (preserva o índice) e emite 'vault-root-lost'; aqui vira notificação
// persistente, deduplicada (o evento repete a cada batch enquanto a raiz não voltar).
// Um batch válido subsequente de 'vault-change' (raiz voltou / vault trocado) limpa — self-heal.
let vaultRootLostNotifId: string | null = null;

function clearVaultRootLost() {
  if (vaultRootLostNotifId) {
    useAppStore.getState().dismissNotification(vaultRootLostNotifId);
    vaultRootLostNotifId = null;
  }
}

function handleVaultRootLost(vaultPath: string) {
  const state = useAppStore.getState();
  // Dedup: se a notificação ainda está visível, não flicka nem duplica
  if (vaultRootLostNotifId && state.notifications.some((n) => n.id === vaultRootLostNotifId)) {
    return;
  }
  const msg = `A pasta do vault (${vaultPath}) foi movida, renomeada ou excluída com o app aberto. Reabra o vault para continuar — o índice foi preservado.`;
  console.error(msg);
  vaultRootLostNotifId = state.notify('error', msg, { persistent: true });
}

const scheduleSaveHelper = () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    if (!pendingSave) return;
    const { path, content } = pendingSave;
    pendingSave = null;
    try {
      await invoke('write_file', { path, content, allowCreate: false });
      if (useAppStore.getState().activeTab === path) {
        useAppStore.setState({ activeNoteBaseSerialized: content });
      }
      clearSaveError();
    } catch (e) {
      handleSaveFailure(path, content, e);
    }
  }, 500);
};

export const useAppStore = create<AppState>((set, get) => ({
  // F3 (Spec 17): slices frios compostos por spread — grafo/busca, layout e notificações.
  // O núcleo sagrado (save/vault/abas/watcher) permanece aqui embaixo.
  ...createNotificationsSlice(set, get),
  ...createGraphSlice(set, get),
  ...createLayoutSlice(set),

  theme: 'dark',
  currentVault: null,
  recentVaults: [],
  openTabs: [],
  activeTab: null,
  fileTree: null,
  sidebarWidth: 260,
  isIndexing: false,
  indexingProgress: 0,
  isWatching: false,
  indexingProgressText: null,
  activeNoteContent: null,
  activeNoteRawFrontmatter: null,
  activeNoteYamlDoc: null,
  activeNoteBaseSerialized: null,
  activeContentPath: null,
  conflictModal: null,
  existingNotes: new Map<string, string>(),
  activeNoteBacklinks: [],
  activeNoteOutgoingLinks: [],
  isBacklinksLoading: false,
  platform: 'windows',
  isNoteDirty: false,
  editorWideMode: false,
  pendingScrollToHeading: null,
  setPendingScrollToHeading: (heading: string | null) => set({ pendingScrollToHeading: heading }),

  initApp: async () => {
    const initStart = performance.now();
    try {
      let osPlatform = 'windows';
      try {
        osPlatform = await invoke<string>('get_platform');
      } catch (err) {
        console.error('Failed to get platform:', err);
      }
      set({ platform: osPlatform });

      const config = await invoke<AppConfig>('load_config');
      telemetry.dbLoadTime = performance.now() - initStart;

      try {
        telemetry.rustStartupTime = await invoke<number>('get_rust_bootstrap_time');
      } catch (err) {
        console.error('Failed to get rust startup time:', err);
      }

      // Aplica o tema carregado no document element
      const finalTheme = config.theme === 'light' ? 'light' : 'dark';
      if (finalTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      }

      set({
        theme: finalTheme,
        currentVault: config.current_vault,
        recentVaults: config.recent_vaults,
        sidebarWidth: config.sidebar_width,
        editorWideMode: config.editor_wide_mode ?? false,
        rightPanelWidth: config.right_panel_width ?? 300,
      });

      // Se havia um vault ativo anterior, carrega-o
      if (config.current_vault) {
        await get().loadVault(config.current_vault);
      }
    } catch (e) {
      console.error('Failed to initialize app config:', e);
      get().setGlobalError(`Falha ao inicializar o app: ${e}`);
    }
  },

  toggleTheme: () =>
    set((state) => {
      const nextTheme: 'light' | 'dark' = state.theme === 'light' ? 'dark' : 'light';
      if (nextTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      }

      const newState = { ...state, theme: nextTheme };
      saveConfigHelper({
        currentVault: newState.currentVault,
        recentVaults: newState.recentVaults,
        theme: newState.theme,
        sidebarWidth: newState.sidebarWidth,
        editorWideMode: newState.editorWideMode,
        rightPanelWidth: newState.rightPanelWidth,
      });

      return { theme: nextTheme };
    }),

  setTheme: (theme) =>
    set((state) => {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      }

      const newState = { ...state, theme };
      saveConfigHelper({
        currentVault: newState.currentVault,
        recentVaults: newState.recentVaults,
        theme: newState.theme,
        sidebarWidth: newState.sidebarWidth,
        editorWideMode: newState.editorWideMode,
        rightPanelWidth: newState.rightPanelWidth,
      });

      return { theme };
    }),

  setSidebarWidth: (width) =>
    set((state) => {
      const newState = { ...state, sidebarWidth: width };
      saveConfigHelper({
        currentVault: newState.currentVault,
        recentVaults: newState.recentVaults,
        theme: newState.theme,
        sidebarWidth: newState.sidebarWidth,
        editorWideMode: newState.editorWideMode,
        rightPanelWidth: newState.rightPanelWidth,
      });
      return { sidebarWidth: width };
    }),

  // E8: persiste a largura do painel direito (chamada no mouseup do splitter — 1x por
  // drag, como o setSidebarWidth). Sobrescreve a versão de sessão do layoutSlice.
  setRightPanelWidth: (width: number) =>
    set((state) => {
      const newState = { ...state, rightPanelWidth: width };
      saveConfigHelper({
        currentVault: newState.currentVault,
        recentVaults: newState.recentVaults,
        theme: newState.theme,
        sidebarWidth: newState.sidebarWidth,
        editorWideMode: newState.editorWideMode,
        rightPanelWidth: newState.rightPanelWidth,
      });
      return { rightPanelWidth: width };
    }),

  toggleEditorWideMode: () =>
    set((state) => {
      const newState = { ...state, editorWideMode: !state.editorWideMode };
      saveConfigHelper({
        currentVault: newState.currentVault,
        recentVaults: newState.recentVaults,
        theme: newState.theme,
        sidebarWidth: newState.sidebarWidth,
        editorWideMode: newState.editorWideMode,
        rightPanelWidth: newState.rightPanelWidth,
      });
      return { editorWideMode: newState.editorWideMode };
    }),

  loadVault: async (path: string) => {
    telemetry.hasTreeLoaded = false;
    telemetry.hasIndexed = false;
    telemetry.hasGraphLoaded = false;
    telemetry.treeLoadStartTime = performance.now();
    let tree: FileNode;
    try {
      tree = await invoke<FileNode>('load_vault_tree', { vaultPath: path });
    } catch (e) {
      console.error('Failed to load vault tree:', e);
      get().setGlobalError(`Falha ao carregar o vault: ${e}`);
      return;
    }
    telemetry.treeLoadTime = performance.now() - telemetry.treeLoadStartTime;
    telemetry.hasTreeLoaded = true;

    set((state) => {
      const filteredRecent = state.recentVaults.filter((v) => v !== path);
      const nextRecent = [path, ...filteredRecent].slice(0, 5);

      const newState = {
        ...state,
        currentVault: path,
        recentVaults: nextRecent,
        fileTree: tree,
      };

      saveConfigHelper({
        currentVault: newState.currentVault,
        recentVaults: newState.recentVaults,
        theme: newState.theme,
        sidebarWidth: newState.sidebarWidth,
        editorWideMode: newState.editorWideMode,
        rightPanelWidth: newState.rightPanelWidth,
      });

      return newState;
    });

    // Começa a assistir o novo vault
    try {
      await invoke('start_watching', { vaultPath: path });
      set({ isWatching: true });
    } catch (e) {
      console.error('Failed to start watching vault:', e);
      get().notify('warning', 'Monitoramento de arquivos não iniciou; mudanças externas podem não aparecer.');
      set({ isWatching: false });
    }

    // Dispara indexação incremental em background (não bloqueia a UI)
    invoke('start_indexing_command', { vaultPath: path }).catch((err) => {
      console.error('Failed to start background indexing:', err);
      get().notify('error', 'Falha ao iniciar a indexação do vault.');
    });
    await get().refreshExistingNotes();
  },

  closeVault: async () => {
    await get().flushPendingSave();
    try {
      await invoke('stop_watching');
    } catch (e) {
      console.error('Failed to stop watching vault:', e);
    }
    const newState = {
      theme: get().theme,
      currentVault: null,
      recentVaults: get().recentVaults,
      openTabs: [],
      activeTab: null,
      fileTree: null,
      sidebarWidth: get().sidebarWidth,
      isIndexing: false,
      indexingProgress: 0,
      isWatching: false,
      indexingProgressText: null,
      activeNoteContent: null,
      activeNoteRawFrontmatter: null,
      activeNoteYamlDoc: null,
      activeNoteBaseSerialized: null,
      activeContentPath: null,
    };
    saveConfigHelper({
      currentVault: newState.currentVault,
      recentVaults: newState.recentVaults,
      theme: newState.theme,
      sidebarWidth: newState.sidebarWidth,
      editorWideMode: get().editorWideMode,
      rightPanelWidth: get().rightPanelWidth,
    });
    set(newState);
  },

  createItem: async (parentPath: string, name: string, isDir: boolean) => {
    const { currentVault } = get();
    if (!currentVault) return;

    try {
      const path = await invoke<string>('create_item', { parentPath, name, isDir });
      await get().loadVault(currentVault);
      return path;
    } catch (e) {
      const msg = `Falha ao criar item: ${e}`;
      console.error(msg, e);
      get().setGlobalError(msg);
      throw e;
    }
  },

  renameItem: async (path: string, newName: string) => {
    const { currentVault, openTabs, activeTab } = get();
    if (!currentVault) return;

    if (activeTab === path) {
      await get().flushPendingSave();
    }

    try {
      const newPath = await invoke<string>('rename_item', { path, newName });

      const updatedTabs = openTabs.map((t) => (t === path ? newPath : t));
      const updatedActiveTab = activeTab === path ? newPath : activeTab;

      set({ openTabs: updatedTabs, activeTab: updatedActiveTab });

      await get().loadVault(currentVault);
    } catch (e) {
      const msg = `Falha ao renomear item: ${e}`;
      console.error(msg, e);
      get().setGlobalError(msg);
      throw e;
    }
  },

  moveItem: async (path: string, newParentPath: string) => {
    const { currentVault, openTabs, activeTab } = get();
    if (!currentVault) return;

    const normalizePath = (p: string) => {
      const clean = p.replace(/\\/g, '/');
      return get().platform === 'windows' ? clean.toLowerCase() : clean;
    };
    const isPathUnderOrEqual = (child: string, parent: string) => {
      const normChild = normalizePath(child);
      const normParent = normalizePath(parent);
      if (normChild === normParent) return true;
      return normChild.startsWith(normParent.endsWith('/') ? normParent : normParent + '/');
    };
    const mapPathPrefix = (p: string, oldPath: string, newPath: string) => {
      const normP = normalizePath(p);
      const normOld = normalizePath(oldPath);
      if (normP === normOld) {
        return newPath;
      }
      const prefix = normOld.endsWith('/') ? normOld : normOld + '/';
      if (normP.startsWith(prefix)) {
        let sliceIndex = oldPath.length;
        if (!oldPath.endsWith('/') && !oldPath.endsWith('\\')) {
          sliceIndex += 1;
        }
        const suffix = p.slice(sliceIndex);
        const sep = newPath.includes('\\') ? '\\' : '/';
        const cleanNewPath = (newPath.endsWith('/') || newPath.endsWith('\\'))
          ? newPath.slice(0, -1)
          : newPath;
        const mappedSuffix = sep === '\\' ? suffix.replace(/\//g, '\\') : suffix.replace(/\\/g, '/');
        return `${cleanNewPath}${sep}${mappedSuffix}`;
      }
      return p;
    };

    if (activeTab && isPathUnderOrEqual(activeTab, path)) {
      await get().flushPendingSave();
    }

    try {
      const newPath = await invoke<string>('move_item', { path, newParentPath });

      const updatedTabs = openTabs.map((t) => mapPathPrefix(t, path, newPath));
      const updatedActiveTab = activeTab ? mapPathPrefix(activeTab, path, newPath) : activeTab;

      set({ openTabs: updatedTabs, activeTab: updatedActiveTab });

      await get().loadVault(currentVault);
      
      if (updatedActiveTab) {
        await get().loadBacklinks(updatedActiveTab);
      }
      await get().loadGraphData();
    } catch (e) {
      const msg = `Falha ao mover item: ${e}`;
      console.error(msg, e);
      get().setGlobalError(msg);
      throw e;
    }
  },

  deleteItem: async (path: string) => {
    const { currentVault, openTabs, activeTab } = get();
    if (!currentVault) return;

    if (activeTab === path) {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
      }
      set({ activeNoteContent: null, activeNoteRawFrontmatter: null, activeNoteYamlDoc: null, activeNoteBacklinks: [], activeNoteOutgoingLinks: [] });
    }

    try {
      await invoke('delete_item', { path });

      const updatedTabs = openTabs.filter((t) => t !== path);
      let updatedActiveTab = activeTab;
      if (activeTab === path) {
        updatedActiveTab = updatedTabs.length > 0 ? updatedTabs[updatedTabs.length - 1] : null;
      }

      set({ openTabs: updatedTabs, activeTab: updatedActiveTab });

      await get().loadVault(currentVault);

      if (updatedActiveTab && activeTab === path) {
        await get().loadActiveNote(updatedActiveTab);
        await get().loadBacklinks(updatedActiveTab);
      }
    } catch (e) {
      const msg = `Falha ao excluir item: ${e}`;
      console.error(msg, e);
      get().setGlobalError(msg);
      throw e;
    }
  },

  openInDefaultApp: async (path: string) => {
    try {
      await invoke('open_in_default_app', { path });
    } catch (err) {
      console.error('Failed to open file in default app:', err);
      get().notify('error', `Falha ao abrir o arquivo no aplicativo padrão: ${err}`);
    }
  },

  openTab: async (path) => {
    const { openTabs, activeTab } = get();
    if (activeTab === path) {
      set((state) => ensureDifferentViews('editor', state.rightView));
      return;
    }

    await get().flushPendingSave();

    const nextTabs = openTabs.includes(path) ? openTabs : [...openTabs, path];
    set((state) => {
      const updates = ensureDifferentViews('editor', state.rightView);
      return { openTabs: nextTabs, activeTab: path, ...updates };
    });
    await get().loadActiveNote(path);
    await get().loadBacklinks(path);
  },

  closeTab: async (path) => {
    const { openTabs, activeTab } = get();
    if (activeTab === path) {
      await get().flushPendingSave();
    }
    const nextTabs = openTabs.filter((t) => t !== path);
    let nextActiveTab = activeTab;
    if (activeTab === path) {
      nextActiveTab = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1] : null;
    }
    const nextCenterView = nextActiveTab ? 'editor' : 'graph';
    set((state) => {
      const updates = ensureDifferentViews(nextCenterView as 'editor' | 'graph', state.rightView);
      return { openTabs: nextTabs, activeTab: nextActiveTab, ...updates };
    });
    if (nextActiveTab) {
      await get().loadActiveNote(nextActiveTab);
      await get().loadBacklinks(nextActiveTab);
    } else if (activeTab === path) {
      set({ activeNoteContent: null, activeNoteRawFrontmatter: null, activeNoteYamlDoc: null, activeContentPath: null, activeNoteBacklinks: [], activeNoteOutgoingLinks: [] });
    }
  },

  setActiveTab: async (path) => {
    const { activeTab } = get();
    if (activeTab === path) {
      set((state) => ensureDifferentViews('editor', state.rightView));
      return;
    }

    await get().flushPendingSave();

    if (path) {
      set((state) => {
        const updates = ensureDifferentViews('editor', state.rightView);
        return { activeTab: path, ...updates };
      });
      await get().loadActiveNote(path);
      await get().loadBacklinks(path);
    } else {
      set((state) => {
        const updates = ensureDifferentViews('graph', state.rightView);
        return {
          activeTab: null,
          activeNoteContent: null,
          activeNoteRawFrontmatter: null,
          activeNoteYamlDoc: null,
          activeContentPath: null,
          activeNoteBacklinks: [],
          activeNoteOutgoingLinks: [],
          ...updates
        };
      });
    }
  },

  loadActiveNote: async (path: string) => {
    await get().flushPendingSave();
    const kind = getFileKind(path);

    // E5 (Spec 29): PDF é binário — nunca passa por read_file (read_to_string é UTF-8-only);
    // o PdfViewer usa o asset protocol direto. Buffer de edição fica vazio de propósito.
    // E4 (Spec 30): canvas idem — o CanvasViewer lê sozinho e é read-only por construção;
    // buffer de edição NUNCA existe pra .canvas (nenhum caminho de write, L1 da spec).
    if (kind === 'pdf' || kind === 'canvas') {
      set({
        activeNoteContent: null,
        activeNoteRawFrontmatter: null,
        activeNoteYamlDoc: null,
        activeNoteBaseSerialized: null,
        activeContentPath: null,
      });
      return;
    }

    try {
      const rawContent = await invoke<string>('read_file', { path });

      // E5 (Spec 29): não-md NUNCA passa pelo parser de frontmatter — o `---` inicial de
      // um .yaml casaria o regex e o split errado seria regravado no disco no primeiro
      // save. Com rawFrontmatter vazio, serializeRawNote é identidade ⇒ save byte-a-byte.
      if (kind === 'text') {
        set({
          activeNoteContent: rawContent,
          activeNoteRawFrontmatter: '',
          activeNoteYamlDoc: null,
          activeNoteBaseSerialized: rawContent,
          activeContentPath: path,
        });
        return;
      }

      const { rawFrontmatter, yamlDoc, content } = parseRawNote(rawContent);
      set({
        activeNoteContent: content,
        activeNoteRawFrontmatter: rawFrontmatter,
        activeNoteYamlDoc: yamlDoc,
        activeNoteBaseSerialized: serializeRawNote(rawFrontmatter, content),
        activeContentPath: path,
      });
    } catch (e) {
      console.error('Failed to load active note content:', e);

      // E5 (Spec 29): pra não-md o fallback de buffer vazio é PROIBIDO — um '' editável
      // salvaria por cima do arquivo (ex.: encoding não-UTF-8). Fecha a aba, avisa e
      // delega pro app padrão.
      if (kind === 'text') {
        get().notify(
          'error',
          `Não foi possível abrir o arquivo como texto (${e}). Abrindo no aplicativo padrão.`,
        );
        await get().closeTab(path);
        void get().openInDefaultApp(path);
        return;
      }

      // Endurecimento do catch (Princípio #1): Preserva o buffer em memória se a nota já estiver
      // carregada, mas define vazio se for o primeiro carregamento da aba para evitar travamento.
      if (get().activeNoteContent === null) {
        set({
          activeNoteContent: '',
          activeNoteRawFrontmatter: '',
          activeNoteYamlDoc: null,
          activeNoteBaseSerialized: '',
        });
      }
    }
  },

  updateActiveNoteContent: async (content: string) => {
    set({ activeNoteContent: content });
    const { activeTab, activeNoteRawFrontmatter } = get();
    if (activeTab) {
      pendingSave = {
        path: activeTab,
        content: serializeRawNote(activeNoteRawFrontmatter, content),
      };
    }
    scheduleSaveHelper();
  },

  updateActiveNoteFrontmatter: async (updateFn: (doc: YAML.Document) => void) => {
    const { activeNoteYamlDoc } = get();
    const doc = activeNoteYamlDoc || new YAML.Document({});

    updateFn(doc);

    const newYamlString = doc.toString().trim();
    const newRawFrontmatter = newYamlString ? `---\n${newYamlString}\n---\n` : '';

    set({
      activeNoteYamlDoc: doc,
      activeNoteRawFrontmatter: newRawFrontmatter,
    });

    const { activeTab, activeNoteContent } = get();
    if (activeTab && activeNoteContent !== null) {
      pendingSave = {
        path: activeTab,
        content: serializeRawNote(newRawFrontmatter, activeNoteContent),
      };
    }

    scheduleSaveHelper();
  },

  flushPendingSave: async () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    if (!pendingSave) return;
    const { path, content } = pendingSave;
    pendingSave = null;
    try {
      await invoke('write_file', { path, content, allowCreate: false });
      if (get().activeTab === path) {
        set({ activeNoteBaseSerialized: content });
      }
      clearSaveError();
    } catch (e) {
      handleSaveFailure(path, content, e);
    }
  },

  showConflictModal: (path: string, diskContent: string | null, localContentSnapshot: string) => {
    set({ conflictModal: { path, diskContent, localContentSnapshot } });
  },

  resolveConflict: async (resolution: 'keep-local' | 'load-disk') => {
    const { conflictModal, activeTab } = get();
    if (!conflictModal) return;

    const { path, diskContent, localContentSnapshot } = conflictModal;

    if (resolution === 'keep-local') {
      const localContent = localContentSnapshot;
      try {
        await invoke('write_file', { path, content: localContent, allowCreate: true });
        if (activeTab === path) {
          set({ activeNoteBaseSerialized: localContent });
        }
      } catch (e) {
        const msg = `Falha ao resolver conflito salvando versão local: ${e}`;
        console.error(msg, e);
        get().setGlobalError(msg);
      }
    } else if (resolution === 'load-disk') {
      if (diskContent === null) {
        await get().closeTab(path);
      } else {
        const { rawFrontmatter, yamlDoc, content } = parseRawNote(diskContent);
        set({
          activeNoteContent: content,
          activeNoteRawFrontmatter: rawFrontmatter,
          activeNoteYamlDoc: yamlDoc,
          activeNoteBaseSerialized: diskContent,
        });
      }
    }

    set({ conflictModal: null });
  },

  setupVaultChangeListener: async () => {
    const { currentVault } = get();
    if (currentVault) {
      try {
        await invoke('start_watching', { vaultPath: currentVault });
        set({ isWatching: true });
      } catch (e) {
        const msg = `Falha ao iniciar monitoramento do vault: ${e}`;
        console.error(msg, e);
        set({ isWatching: false });
        get().setGlobalError(msg);
      }
    }

    const unlisten = await listen<{ path: string; changeType: 'create' | 'modify' | 'delete'; isEcho: boolean }[]>(
      'vault-change',
      async (event) => {
        // BUG-02: um batch válido chegou = a raiz existia durante o processamento → self-heal
        clearVaultRootLost();

        const changes = event.payload;
        const state = get();
        const activeTab = state.activeTab;
        const localContentSnapshot = serializeRawNote(state.activeNoteRawFrontmatter, state.activeNoteContent || '');

        if (state.currentVault) {
          try {
            const tree = await invoke<FileNode>('load_vault_tree', { vaultPath: state.currentVault });
            set({ fileTree: tree });
          } catch (e) {
            const msg = `Falha ao atualizar árvore de arquivos: ${e}`;
            console.error(msg, e);
            get().setGlobalError(msg);
          }
        }
        await get().refreshExistingNotes();

        if (activeTab) {
          const activeTabNorm = activeTab.replace(/\\/g, '/');
          const affected = changes.find((c) => c.path.replace(/\\/g, '/') === activeTabNorm);

          if (affected) {
            if (affected.isEcho) {
              return;
            }

            const currentSerialized = serializeRawNote(state.activeNoteRawFrontmatter, state.activeNoteContent || '');
            const isDirty = currentSerialized !== state.activeNoteBaseSerialized;

            if (affected.changeType === 'delete') {
              // Re-checa fisicamente no disco antes de realizar a ação destrutiva (fechar aba) (Incidente 05)
              let fileExists = false;
              let diskContent: string | null = null;
              try {
                diskContent = await invoke<string>('read_file', { path: activeTab });
                fileExists = true;
              } catch (err) {
                fileExists = false;
              }

              if (fileExists) {
                // O arquivo na verdade existe! Trata como modify/reload silencioso ou conflito
                if (isDirty) {
                  set({ conflictModal: { path: activeTab, diskContent, localContentSnapshot } });
                } else {
                  await get().loadActiveNote(activeTab);
                  const editorEl = document.querySelector('.cm-editor');
                  if (editorEl) {
                    editorEl.classList.remove('animate-blink');
                    void (editorEl as HTMLElement).offsetWidth;
                    editorEl.classList.add('animate-blink');
                  }
                }
              } else {
                // O arquivo foi de fato excluído do disco (deleção real)
                if (isDirty) {
                  set({ conflictModal: { path: activeTab, diskContent: null, localContentSnapshot } });
                } else {
                  await get().closeTab(activeTab);
                }
              }
            } else if (affected.changeType === 'modify' || affected.changeType === 'create') {
              if (isDirty) {
                try {
                  const diskContent = await invoke<string>('read_file', { path: activeTab });
                  set({ conflictModal: { path: activeTab, diskContent, localContentSnapshot } });
                } catch (e) {
                  const msg = `Falha ao ler arquivo modificado do disco: ${e}`;
                  console.error(msg, e);
                  get().setGlobalError(msg);
                }
              } else {
                await get().loadActiveNote(activeTab);
                const editorEl = document.querySelector('.cm-editor');
                if (editorEl) {
                  editorEl.classList.remove('animate-blink');
                  void (editorEl as HTMLElement).offsetWidth;
                  editorEl.classList.add('animate-blink');
                }
              }
            }
          }
        }
      }
    );

    // BUG-02: raiz do vault perdida (renomeada/movida com o app aberto) → notificação persistente
    const unlistenRootLost = await listen<string>('vault-root-lost', (event) => {
      handleVaultRootLost(event.payload);
    });

    return () => {
      unlisten();
      unlistenRootLost();
    };
  },

  refreshExistingNotes: async () => {
    const { currentVault } = get();
    if (!currentVault) return;

    try {
      const notes = await invoke<{ path: string; basename: string }[]>('get_all_notes');

      // Calcula os caminhos relativos e padroniza
      const notesWithRel = notes.map((n) => {
        let relPath = n.path;
        if (relPath.startsWith(currentVault)) {
          relPath = relPath.slice(currentVault.length);
        }
        relPath = relPath.replace(/\\/g, '/');
        if (relPath.startsWith('/')) {
          relPath = relPath.slice(1);
        }
        return { ...n, relPath };
      });

      // Ordena inversamente:
      // 1. Maior comprimento primeiro (len_b - len_a)
      // 2. Ordem alfabética reversa secundária (Z-A)
      // Assim, ao inserir no Map, a nota vencedora (menor comprimento, A-Z) entra por último e sobrescreve
      notesWithRel.sort((a, b) => {
        const lenA = a.relPath.length;
        const lenB = b.relPath.length;
        if (lenA !== lenB) {
          return lenB - lenA;
        }
        if (a.relPath < b.relPath) return 1;
        if (a.relPath > b.relPath) return -1;
        return 0;
      });

      const existingMap = new Map<string, string>();
      const isWindows = get().platform === 'windows';

      // 1. Lowercase keys for fallback/case-insensitive resolution (tie-broken by notesWithRel sort order)
      for (const note of notesWithRel) {
        const baseLower = note.basename.toLowerCase();
        const relLower = note.relPath.toLowerCase();
        const relNoExt = relLower.endsWith('.md') ? relLower.slice(0, -3) : relLower;

        existingMap.set(baseLower, note.path);
        existingMap.set(relLower, note.path);
        existingMap.set(relNoExt, note.path);
      }

      // 2. Exact case keys (take priority on case-sensitive platforms)
      if (!isWindows) {
        for (const note of notesWithRel) {
          const base = note.basename;
          const rel = note.relPath;
          const relNoExt = rel.endsWith('.md') ? rel.slice(0, -3) : rel;

          existingMap.set(base, note.path);
          existingMap.set(rel, note.path);
          existingMap.set(relNoExt, note.path);
        }
      }

      set({ existingNotes: existingMap });
    } catch (e) {
      console.error('Failed to refresh existing notes:', e);
      get().notify('warning', 'Falha ao atualizar a lista de notas.');
    }
  },

  loadBacklinks: async (path: string) => {
    // E5 (Spec 29): backlinks/links de saída só existem pra .md (não-md fica fora do
    // índice) — limpa o painel sem consultar o índice. Só limpa se a aba não-md ainda é a
    // ativa: o fallback de erro do loadActiveNote pode já ter devolvido o foco pra outra
    // aba (não zerar os backlinks dela).
    if (getFileKind(path) !== 'markdown') {
      if (get().activeTab === path) {
        set({ activeNoteBacklinks: [], activeNoteOutgoingLinks: [], isBacklinksLoading: false });
      }
      return;
    }
    set({ isBacklinksLoading: true });
    try {
      // As duas direções da conexão: quem aponta pra cá + o que esta nota referencia
      const [backlinks, outgoingLinks] = await Promise.all([
        invoke<Backlink[]>('get_backlinks', { targetPath: path }),
        invoke<OutgoingLink[]>('get_outgoing_links', { sourcePath: path }),
      ]);
      set({ activeNoteBacklinks: backlinks, activeNoteOutgoingLinks: outgoingLinks, isBacklinksLoading: false });
    } catch (e) {
      console.error('Failed to load backlinks:', e);
      get().notify('warning', 'Falha ao carregar os backlinks.');
      set({ activeNoteBacklinks: [], activeNoteOutgoingLinks: [], isBacklinksLoading: false });
    }
  },

  handleWikiLinkClick: async (targetName: string) => {
    const { existingNotes, currentVault, platform } = get();
    if (!currentVault) return;

    // E2 Fatia B (Spec 28): separa `Nota#Título` — a nota resolve/abre normalmente
    // e o fragmento vira scroll pendente (consumido pelo MarkdownEditor)
    const hashIndex = targetName.indexOf('#');
    const fragment = hashIndex === -1 ? null : targetName.slice(hashIndex + 1).trim();
    const noteName = (hashIndex === -1 ? targetName : targetName.slice(0, hashIndex)).trim();

    // `[[#Título]]`: heading da PRÓPRIA nota — só scroll, sem trocar de aba
    if (noteName === '') {
      if (fragment) {
        set({ pendingScrollToHeading: fragment });
      }
      return;
    }

    // Sincroniza qualquer alteração pendente antes de trocar de aba ou criar item
    await get().flushPendingSave();

    const isWindows = platform === 'windows';
    let targetPath = isWindows ? existingNotes.get(noteName.toLowerCase()) : existingNotes.get(noteName);
    let fellBack = false;

    if (!targetPath && !isWindows) {
      targetPath = existingNotes.get(noteName.toLowerCase());
      if (targetPath) {
        fellBack = true;
      }
    }

    if (targetPath) {
      if (fellBack) {
        try {
          const notes = await invoke<{ path: string; basename: string }[]>('get_all_notes');
          const matches = notes.filter(n => {
            const baseLower = n.basename.toLowerCase();
            const relPath = n.path.replace(/\\/g, '/');
            const vaultNorm = currentVault.replace(/\\/g, '/');
            const rel = relPath.startsWith(vaultNorm) ? relPath.slice(vaultNorm.length).replace(/^\//, '') : relPath;
            const relNoExt = rel.endsWith('.md') ? rel.slice(0, -3) : rel;
            const targetLower = noteName.toLowerCase();
            return baseLower === targetLower || rel.toLowerCase() === targetLower || relNoExt.toLowerCase() === targetLower;
          });
          if (matches.length > 1) {
            console.warn(`Wiki-link resolution collision warning: Multiple files match '${noteName}' case-insensitively.`);
            get().setGlobalError(`Aviso de Ambiguidade: Múltiplos arquivos colidindo insensivelmente para o link [[${noteName}]].`);
          }
        } catch (e) {
          console.error('Failed to check link collisions:', e);
          get().notify('warning', 'Falha ao verificar colisões de wiki-links.');
        }
      }
      await get().openTab(targetPath);
      if (fragment) {
        set({ pendingScrollToHeading: fragment });
      }
    } else {
      const filename = noteName.endsWith('.md') ? noteName : `${noteName}.md`;
      const newPath = await get().createItem(currentVault, filename, false);
      if (newPath) {
        const baseLower = noteName.toLowerCase();
        const absolutePath = newPath;

        // Atualização em memória do map para navegação imediata sem delay do indexador de background
        const updatedNotes = new Map(get().existingNotes);
        updatedNotes.set(baseLower, absolutePath);
        
        const vaultNorm = currentVault.replace(/\\/g, '/');
        const relPath = absolutePath.replace(/\\/g, '/').startsWith(vaultNorm)
          ? absolutePath.replace(/\\/g, '/').slice(vaultNorm.length).replace(/^\//, '')
          : absolutePath;
        const relNoExt = relPath.endsWith('.md') ? relPath.slice(0, -3) : relPath;

        updatedNotes.set(relPath.toLowerCase(), absolutePath);
        updatedNotes.set(relNoExt.toLowerCase(), absolutePath);

        if (!isWindows) {
          const base = noteName;
          updatedNotes.set(base, absolutePath);
          updatedNotes.set(relPath, absolutePath);
          updatedNotes.set(relNoExt, absolutePath);
        }

        set({ existingNotes: updatedNotes });

        await get().openTab(absolutePath);
        if (fragment) {
          set({ pendingScrollToHeading: fragment });
        }
      }
    }
  },
}));

// Listener reativo de eventos de indexação emitidos pelo Rust backend
export async function setupIndexingListener(): Promise<UnlistenFn> {
  const unlisten = await listen<string>('indexing-status', async (event) => {
    const payload = event.payload;
    if (payload === 'started') {
      telemetry.indexStartTime = performance.now();
      useAppStore.setState({ isIndexing: true, indexingProgressText: 'iniciando' });
    } else if (payload === 'finished') {
      if (telemetry.indexStartTime > 0) {
        telemetry.indexTime = performance.now() - telemetry.indexStartTime;
      }
      telemetry.hasIndexed = true;
      useAppStore.setState({ isIndexing: false, indexingProgressText: null });
      await useAppStore.getState().refreshExistingNotes();
      const activeTab = useAppStore.getState().activeTab;
      if (activeTab) {
        await useAppStore.getState().loadBacklinks(activeTab);
      }
      // BUG-01: o GraphView chama loadGraphData() na montagem, ANTES da indexação de fundo
      // terminar, então o grafo vem vazio e fica preso em "Aguardando dados de rede do grafo...".
      // Quando a indexação completa, re-carrega o grafo SE ele ainda estiver vazio (não reprocessa
      // se já houver dados — evita reload à toa em indexações incrementais).
      const gd = useAppStore.getState().graphData;
      if (!gd || gd.nodes.length === 0) {
        await useAppStore.getState().loadGraphData();
      }
      checkAndPrintConsolidatedMetrics();
    } else if (payload.startsWith('progress:')) {
      const progressText = payload.substring('progress:'.length);
      useAppStore.setState({ isIndexing: true, indexingProgressText: progressText });
    } else if (payload.startsWith('error')) {
      if (telemetry.indexStartTime > 0) {
        telemetry.indexTime = performance.now() - telemetry.indexStartTime;
      }
      telemetry.hasIndexed = true;
      console.error('Indexing error:', payload);
      useAppStore.getState().notify('error', 'Falha na indexação do vault. Busca e grafo podem ficar incompletos.');
      useAppStore.setState({ isIndexing: false, indexingProgressText: null });
      checkAndPrintConsolidatedMetrics();
    }
  });
  return unlisten;
}
