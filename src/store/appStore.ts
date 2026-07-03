/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import YAML from 'yaml';
import { parseRawNote, serializeRawNote } from '../utils/markdown';

// --- Sistema de notificações (F1.2) -------------------------------------------------
// Toasts transitórios (somem sozinhos) para falhas que hoje eram mudas (só console.error).
// O canal "grave/persistente" (falha ao salvar, etc.) continua na faixa `globalError`.
export type NotificationType = 'error' | 'warning' | 'success' | 'info';

export interface NotificationAction {
  label: string;
  run: () => void;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  message: string;
  /** Persistente fica até o usuário fechar; transitório some após `ttlMs`. */
  persistent: boolean;
  action?: NotificationAction;
}

export interface NotifyOptions {
  persistent?: boolean;
  ttlMs?: number;
  action?: NotificationAction;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

export interface Backlink {
  source_path: string;
  source_title: string;
  context: string;
}

export interface GraphNode {
  id: string;
  label: string;
  exists: boolean;
  degree: number;
  // react-force-graph will inject x,y,z or we can load them:
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface GraphPosition {
  x2d?: number;
  y2d?: number;
  x3d?: number;
  y3d?: number;
  z3d?: number;
  x?: number;
  y?: number;
  z?: number;
}


export interface AppConfig {
  current_vault: string | null;
  recent_vaults: string[];
  theme: 'light' | 'dark';
  sidebar_width: number;
}

interface AppState {
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
  conflictModal: { path: string; diskContent: string | null; localContentSnapshot: string } | null;
  existingNotes: Map<string, string>; // Mapeia lowercase basename/relative path para absolute path
  activeNoteBacklinks: Backlink[];
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
  rightView: 'backlinks' | 'graph' | 'editor';
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
  setRightView: (view: 'backlinks' | 'graph' | 'editor') => void;
  swapViews: () => void;
}

// Salva as configurações de forma atômica no Rust AppData
async function saveConfigHelper(state: {
  currentVault: string | null;
  recentVaults: string[];
  theme: 'light' | 'dark';
  sidebarWidth: number;
}) {
  try {
    const config: AppConfig = {
      current_vault: state.currentVault,
      recent_vaults: state.recentVaults,
      theme: state.theme,
      sidebar_width: state.sidebarWidth,
    };
    await invoke('save_config', { config });
  } catch (e) {
    console.error('Failed to save config:', e);
    useAppStore.getState().notify('warning', 'Falha ao salvar configurações.');
  }
}

// Parser and serializer imported from utils/markdown

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSave: { path: string; content: string } | null = null;
let activeWorker: Worker | null = null;

let rustStartupTime = 0;
let dbLoadTime = 0;
let treeLoadStartTime = 0;
let treeLoadTime = 0;
let indexStartTime = 0;
let indexTime = 0;
let graphTime = 0;
let metricsPrinted = false;

let hasTreeLoaded = false;
let hasIndexed = false;
let hasGraphLoaded = false;

interface BootstrapWindow extends Window {
  __bootstrapStart?: number;
}

const checkAndPrintConsolidatedMetrics = () => {
  if (metricsPrinted) return;
  if (hasTreeLoaded && hasIndexed && hasGraphLoaded) {
    metricsPrinted = true;
    const jsBootstrapStart = (window as BootstrapWindow).__bootstrapStart || 0;
    const totalTime = performance.now();
    
    console.log('=== TELEMETRY: COLD START METRICS ===');
    console.log(`1. Rust Core Startup:       ${rustStartupTime} ms`);
    console.log(`2. Webview JS Bootstrap:    ${jsBootstrapStart.toFixed(2)} ms`);
    console.log(`3. DB/Config Load:          ${dbLoadTime.toFixed(2)} ms`);
    console.log(`4. FileTree Load:           ${treeLoadTime.toFixed(2)} ms`);
    console.log(`5. Search Indexing:         ${indexTime.toFixed(2)} ms`);
    console.log(`6. Graph Layout Settle:     ${graphTime.toFixed(2)} ms`);
    console.log('-------------------------------------');
    console.log(`TOTAL COLD START DURATION:  ${totalTime.toFixed(2)} ms`);
    console.log('=====================================');
  }
};


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

const ensureDifferentViews = (
  center: 'editor' | 'graph',
  right: 'backlinks' | 'graph' | 'editor'
): {
  centerView: 'editor' | 'graph';
  rightView: 'backlinks' | 'graph' | 'editor';
} => {
  let nextRight = right;
  if (center === 'editor' && right === 'editor') {
    nextRight = 'graph';
  } else if (center === 'graph' && right === 'graph') {
    nextRight = 'editor';
  }
  return { centerView: center, rightView: nextRight };
};

export const useAppStore = create<AppState>((set, get) => ({
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
  conflictModal: null,
  existingNotes: new Map<string, string>(),
  activeNoteBacklinks: [],
  isBacklinksLoading: false,

  // Graph Default States
  graphData: null,
  graphViewMode: '3d',
  graphPositions: {},
  graphSearchQuery: '',
  isGraphSimulating: false,
  searchResults: [],
  matchingPaths: new Set<string>(),
  isSearching: false,

  // Layout & Navigation Default States
  leftPanelMode: 'files',
  isLeftPanelOpen: true,
  isRightPanelOpen: false,
  centerView: 'graph',
  rightView: 'backlinks',
  platform: 'windows',
  rightPanelWidth: 300,
  isNoteDirty: false,
  globalError: null,
  setGlobalError: (error) => set({ globalError: error }),
  notifications: [],
  notify: (type, message, opts) => {
    const id = `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const persistent = opts?.persistent ?? false;
    const notification: AppNotification = { id, type, message, persistent, action: opts?.action };
    const logFn = type === 'error' ? console.error : type === 'warning' ? console.warn : console.log;
    logFn(`[notify:${type}] ${message}`);
    set((s) => ({ notifications: [...s.notifications, notification] }));
    if (!persistent) {
      const ttl = opts?.ttlMs ?? 5000;
      setTimeout(() => get().dismissNotification(id), ttl);
    }
    return id;
  },
  dismissNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
  rebuildIndex: async () => {
    const vault = get().currentVault;
    if (!vault) return;
    try {
      // rebuild_index apaga o DB e re-dispara a indexação completa (com o fix do F2), emitindo
      // eventos 'indexing-status' que a StatusBar já reflete ("Indexando…" → "Índice atualizado").
      await invoke('rebuild_index', { vaultPath: vault });
      get().notify('info', 'Reconstruindo o índice… a busca passará a enxergar o frontmatter.');
    } catch (e) {
      get().notify('error', `Falha ao reconstruir o índice: ${e}`);
    }
  },

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
      dbLoadTime = performance.now() - initStart;

      try {
        rustStartupTime = await invoke<number>('get_rust_bootstrap_time');
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
      });
      return { sidebarWidth: width };
    }),

  loadVault: async (path: string) => {
    hasTreeLoaded = false;
    hasIndexed = false;
    hasGraphLoaded = false;
    treeLoadStartTime = performance.now();
    let tree: FileNode;
    try {
      tree = await invoke<FileNode>('load_vault_tree', { vaultPath: path });
    } catch (e) {
      console.error('Failed to load vault tree:', e);
      get().setGlobalError(`Falha ao carregar o vault: ${e}`);
      return;
    }
    treeLoadTime = performance.now() - treeLoadStartTime;
    hasTreeLoaded = true;

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
    };
    saveConfigHelper({
      currentVault: newState.currentVault,
      recentVaults: newState.recentVaults,
      theme: newState.theme,
      sidebarWidth: newState.sidebarWidth,
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
      set({ activeNoteContent: null, activeNoteRawFrontmatter: null, activeNoteYamlDoc: null, activeNoteBacklinks: [] });
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
      set({ activeNoteContent: null, activeNoteRawFrontmatter: null, activeNoteYamlDoc: null, activeNoteBacklinks: [] });
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
          activeNoteBacklinks: [],
          ...updates
        };
      });
    }
  },

  loadActiveNote: async (path: string) => {
    await get().flushPendingSave();
    try {
      const rawContent = await invoke<string>('read_file', { path });
      const { rawFrontmatter, yamlDoc, content } = parseRawNote(rawContent);
      set({
        activeNoteContent: content,
        activeNoteRawFrontmatter: rawFrontmatter,
        activeNoteYamlDoc: yamlDoc,
        activeNoteBaseSerialized: serializeRawNote(rawFrontmatter, content),
      });
    } catch (e) {
      console.error('Failed to load active note content:', e);
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
    set({ isBacklinksLoading: true });
    try {
      const backlinks = await invoke<Backlink[]>('get_backlinks', { targetPath: path });
      set({ activeNoteBacklinks: backlinks, isBacklinksLoading: false });
    } catch (e) {
      console.error('Failed to load backlinks:', e);
      get().notify('warning', 'Falha ao carregar os backlinks.');
      set({ activeNoteBacklinks: [], isBacklinksLoading: false });
    }
  },

  handleWikiLinkClick: async (targetName: string) => {
    const { existingNotes, currentVault, platform } = get();
    if (!currentVault) return;

    // Sincroniza qualquer alteração pendente antes de trocar de aba ou criar item
    await get().flushPendingSave();

    const isWindows = platform === 'windows';
    let targetPath = isWindows ? existingNotes.get(targetName.toLowerCase()) : existingNotes.get(targetName);
    let fellBack = false;

    if (!targetPath && !isWindows) {
      targetPath = existingNotes.get(targetName.toLowerCase());
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
            const targetLower = targetName.toLowerCase();
            return baseLower === targetLower || rel.toLowerCase() === targetLower || relNoExt.toLowerCase() === targetLower;
          });
          if (matches.length > 1) {
            console.warn(`Wiki-link resolution collision warning: Multiple files match '${targetName}' case-insensitively.`);
            get().setGlobalError(`Aviso de Ambiguidade: Múltiplos arquivos colidindo insensivelmente para o link [[${targetName}]].`);
          }
        } catch (e) {
          console.error('Failed to check link collisions:', e);
          get().notify('warning', 'Falha ao verificar colisões de wiki-links.');
        }
      }
      await get().openTab(targetPath);
    } else {
      const filename = targetName.endsWith('.md') ? targetName : `${targetName}.md`;
      const newPath = await get().createItem(currentVault, filename, false);
      if (newPath) {
        const baseLower = targetName.toLowerCase();
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
          const base = targetName;
          updatedNotes.set(base, absolutePath);
          updatedNotes.set(relPath, absolutePath);
          updatedNotes.set(relNoExt, absolutePath);
        }

        set({ existingNotes: updatedNotes });

        await get().openTab(absolutePath);
      }
    }
  },

  loadGraphData: async () => {
    const startTime = performance.now();
    const mode = get().graphViewMode;
    try {
      const data = await invoke<GraphData>('get_graph_data');
      const cached = await invoke<Record<string, GraphPosition>>('load_graph_positions');
      
      const nodes = data.nodes.map(node => {
        const cachePos = cached[node.id];
        if (cachePos) {
          let x: number | undefined;
          let y: number | undefined;
          let z: number | undefined;
          if (mode === '2d') {
            if (cachePos.x2d !== undefined && cachePos.y2d !== undefined) {
              x = cachePos.x2d;
              y = cachePos.y2d;
              z = 0;
            } else if (cachePos.x !== undefined && cachePos.y !== undefined) {
              x = cachePos.x;
              y = cachePos.y;
              z = 0;
            }
          } else {
            if (cachePos.x3d !== undefined && cachePos.y3d !== undefined && cachePos.z3d !== undefined) {
              x = cachePos.x3d;
              y = cachePos.y3d;
              z = cachePos.z3d;
            } else if (cachePos.x !== undefined && cachePos.y !== undefined && cachePos.z !== undefined) {
              x = cachePos.x;
              y = cachePos.y;
              z = cachePos.z;
            }
          }

          if (x !== undefined && y !== undefined) {
            return {
              ...node,
              x,
              y,
              z: z || 0,
              fx: x,
              fy: y,
              fz: z || 0,
            };
          }
        }
        return {
          ...node,
          fx: undefined,
          fy: undefined,
          fz: undefined,
        };
      });

      const hasUncached = nodes.some(n => n.fx === undefined);
      const isCacheEmpty = Object.keys(cached).length === 0;

      set({ graphData: { nodes, links: data.links }, graphPositions: cached });

      if (activeWorker) {
        activeWorker.terminate();
        activeWorker = null;
      }

      if (!hasUncached && !isCacheEmpty) {
        const cacheLoadTime = performance.now() - startTime;
        console.log(`[Telemetry] Graph loaded from cache in ${cacheLoadTime.toFixed(2)} ms`);
        graphTime = cacheLoadTime;
        hasGraphLoaded = true;
        set({ isGraphSimulating: false });
        checkAndPrintConsolidatedMetrics();
      }

      if (hasUncached || isCacheEmpty) {
        set({ isGraphSimulating: true });
        const simStartTime = performance.now();
        let longTasksCount = 0;
        let observer: PerformanceObserver | null = null;
        try {
          if (typeof PerformanceObserver !== 'undefined') {
            observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (entry.duration > 50) {
                  longTasksCount++;
                }
              }
            });
            observer.observe({ entryTypes: ['longtask'] });
          }
        } catch (e) {
          // Ignore if environment does not support PerformanceObserver or longtask entry
        }

        activeWorker = new Worker(new URL('../utils/graphWorker.ts', import.meta.url), { type: 'module' });
        
        activeWorker.postMessage({
          type: 'START_SIMULATION',
          nodes: nodes.map(n => ({
            id: n.id,
            x: n.x,
            y: n.y,
            z: n.z,
            fx: n.fx,
            fy: n.fy,
            fz: n.fz,
          })),
          links: data.links,
          dimensions: mode === '2d' ? 2 : 3,
          iterations: 120,
        });

        activeWorker.onmessage = async (event: MessageEvent) => {
          const { type: msgType, nodes: updatedNodes } = event.data;
          
          if (msgType === 'TICK') {
            const currentData = get().graphData;
            if (!currentData) return;

            const nodeMap = new Map<string, any>(updatedNodes.map((un: any) => [un.id, un]));
            const nextNodes = currentData.nodes.map(n => {
              const un = nodeMap.get(n.id);
              if (un) {
                return {
                  ...n,
                  x: un.x,
                  y: un.y,
                  z: un.z,
                  fx: un.fx,
                  fy: un.fy,
                  fz: un.fz,
                };
              }
              return n;
            });
            set({ graphData: { nodes: nextNodes, links: currentData.links } });
          } else if (msgType === 'END_SIMULATION') {
            const currentData = get().graphData;
            if (!currentData) return;

            const nodeMap = new Map<string, any>(updatedNodes.map((un: any) => [un.id, un]));
            const nextNodes = currentData.nodes.map(n => {
              const un = nodeMap.get(n.id);
              if (un) {
                return {
                  ...n,
                  x: un.x,
                  y: un.y,
                  z: un.z,
                  fx: un.x,
                  fy: un.y,
                  fz: un.z,
                };
              }
              return n;
            });

            const currentPositions = { ...get().graphPositions };
            nextNodes.forEach(n => {
              const existing = currentPositions[n.id] || {};
              if (mode === '2d') {
                currentPositions[n.id] = {
                  ...existing,
                  x2d: n.x,
                  y2d: n.y,
                };
              } else {
                currentPositions[n.id] = {
                  ...existing,
                  x3d: n.x,
                  y3d: n.y,
                  z3d: n.z,
                };
              }
            });

            set({ graphData: { nodes: nextNodes, links: currentData.links }, isGraphSimulating: false });
            await get().saveGraphPositions(currentPositions);
            
            const simDuration = performance.now() - simStartTime;
            graphTime = simDuration;
            hasGraphLoaded = true;
            if (observer) {
              observer.disconnect();
            }
            console.log(`[Telemetry] Worker Simulation settled in ${simDuration.toFixed(2)} ms`);
            console.log(`[Telemetry] Main thread Long Tasks (>50ms) during simulation: ${longTasksCount}`);

            if (activeWorker) {
              activeWorker.terminate();
              activeWorker = null;
            }
            checkAndPrintConsolidatedMetrics();
          }
        };
      }
    } catch (e) {
      console.error('Failed to load graph data:', e);
      get().notify('error', 'Falha ao carregar o grafo.');
      graphTime = 0;
      hasGraphLoaded = true;
      checkAndPrintConsolidatedMetrics();
    }
  },

  toggleGraphViewMode: () => {
    const currentMode = get().graphViewMode;
    const nextMode = currentMode === '2d' ? '3d' : '2d';
    set({ graphViewMode: nextMode });
    get().loadGraphData();
  },

  saveGraphPositions: async (positions: Record<string, GraphPosition>) => {
    try {
      await invoke('save_graph_positions', { positions });
      set({ graphPositions: positions });
    } catch (e) {
      console.error('Failed to save graph positions:', e);
      get().notify('warning', 'Falha ao salvar as posições do grafo.');
    }
  },

  setGraphSearchQuery: (query: string) => {
    set({ graphSearchQuery: query });
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }
    if (!query.trim()) {
      set({
        searchResults: [],
        matchingPaths: new Set(),
        isSearching: false,
      });
      return;
    }
    set({ isSearching: true });
    searchTimeout = setTimeout(async () => {
      searchTimeout = null;
      await get().searchNotesFts(query);
    }, 250);
  },

  searchNotesFts: async (query: string) => {
    if (!query.trim()) {
      set({
        searchResults: [],
        matchingPaths: new Set(),
        isSearching: false,
      });
      return;
    }
    try {
      const [results, paths] = await Promise.all([
        invoke<SearchResult[]>('search_notes', { query }),
        invoke<string[]>('get_matching_paths', { query }),
      ]);
      if (get().graphSearchQuery === query) {
        set({
          searchResults: results,
          matchingPaths: new Set(paths),
          isSearching: false,
        });
      }
    } catch (e) {
      console.error('Failed to search notes:', e);
      get().notify('error', 'Falha na busca.');
      if (get().graphSearchQuery === query) {
        set({
          isSearching: false,
        });
      }
    }
  },

  // Layout & Navigation Actions
  setLeftPanelMode: (mode) => set({ leftPanelMode: mode, isLeftPanelOpen: true }),
  toggleLeftPanel: () => set((state) => ({ isLeftPanelOpen: !state.isLeftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ isRightPanelOpen: !state.isRightPanelOpen })),
  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),
  setCenterView: (view) => set((state) => ensureDifferentViews(view, state.rightView)),
  setRightView: (view) => set((state) => {
    let nextCenter = state.centerView;
    if (view === 'editor' && state.centerView === 'editor') {
      nextCenter = 'graph';
    } else if (view === 'graph' && state.centerView === 'graph') {
      nextCenter = 'editor';
    }
    return {
      rightView: view,
      isRightPanelOpen: true,
      centerView: nextCenter
    };
  }),
  swapViews: () => set((state) => {
    const nextCenter = state.rightView === 'editor' ? 'editor' : 'graph';
    const nextRight = state.centerView === 'editor' ? 'editor' : 'graph';
    return {
      centerView: nextCenter,
      rightView: nextRight as 'backlinks' | 'graph' | 'editor'
    };
  }),
}));

// Listener reativo de eventos de indexação emitidos pelo Rust backend
export async function setupIndexingListener(): Promise<UnlistenFn> {
  const unlisten = await listen<string>('indexing-status', async (event) => {
    const payload = event.payload;
    if (payload === 'started') {
      indexStartTime = performance.now();
      useAppStore.setState({ isIndexing: true, indexingProgressText: 'iniciando' });
    } else if (payload === 'finished') {
      if (indexStartTime > 0) {
        indexTime = performance.now() - indexStartTime;
      }
      hasIndexed = true;
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
      if (indexStartTime > 0) {
        indexTime = performance.now() - indexStartTime;
      }
      hasIndexed = true;
      console.error('Indexing error:', payload);
      useAppStore.getState().notify('error', 'Falha na indexação do vault. Busca e grafo podem ficar incompletos.');
      useAppStore.setState({ isIndexing: false, indexingProgressText: null });
      checkAndPrintConsolidatedMetrics();
    }
  });
  return unlisten;
}
