// Shell do workspace (F3 — Spec 17): init effect (onCloseRequested→flushPendingSave,
// Incidente #2 + listeners Rust) e o layout de 3 zonas. Welcome/ConflictModal/ErrorBanner
// e os hooks de resize/atalhos vivem em módulos próprios (extraídos intactos).
import React, { useEffect } from 'react';
import { useAppStore, setupIndexingListener } from './store/appStore';
import {
  FolderOpen,
  FileText,
  X,
  LogOut,
  FilePlus,
  Search,
  ArrowLeftRight,
  Link2,
  Activity,
  Hash,
} from 'lucide-react';
import FileTree from './components/FileTree';
import FileViewer from './components/FileViewer';
import BacklinksPanel from './components/BacklinksPanel';
import TagsPanel from './components/TagsPanel';
import { ToastContainer } from './components/ToastContainer';
import { GraphView } from './components/GraphView';
import { getCurrentWindow } from '@tauri-apps/api/window';
import TitleBar from './components/TitleBar';
import ActivityRibbon from './components/ActivityRibbon';
import { SearchResultsPanel } from './components/SearchResultsPanel';
import { serializeRawNote } from './utils/markdown';
import StatusBar from './components/StatusBar';
import WelcomeScreen from './components/WelcomeScreen';
import ConflictModal from './components/ConflictModal';
import GlobalErrorBanner from './components/GlobalErrorBanner';
import { InputModal } from './components/InputModal';
import CommandPalette from './components/CommandPalette';
import { validateItemName } from './utils/validateItemName';
import { usePanelResize } from './hooks/usePanelResize';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';

export default function App() {
  const {
    initApp,
    currentVault,
    closeVault,
    fileTree,
    sidebarWidth,
    openTabs,
    activeTab,
    setActiveTab,
    closeTab,
    createItem,
    activeNoteContent,
    setupVaultChangeListener,
    // Layout variables
    leftPanelMode,
    isLeftPanelOpen,
    isRightPanelOpen,
    centerView,
    rightView,
    rightPanelWidth,
    setRightView,
    graphSearchQuery,
    setGraphSearchQuery,
    toggleLeftPanel,
    toggleRightPanel,
    activeNoteRawFrontmatter,
    activeNoteBaseSerialized,
    activeNoteBacklinks,
    swapViews,
    platform,
    editorWideMode,
  } = useAppStore();

  const isMac = platform === 'darwin' || platform === 'macos';
  const isDirty = activeNoteContent !== null && serializeRawNote(activeNoteRawFrontmatter, activeNoteContent) !== activeNoteBaseSerialized;

  const rightTabs = React.useMemo(() => {
    return [
      {
        id: 'backlinks' as const,
        label: 'Backlinks',
        icon: Link2,
        disabled: false,
        show: true,
      },
      {
        id: 'graph' as const,
        label: 'Grafo',
        icon: Activity,
        disabled: false,
        show: centerView !== 'graph',
      },
      {
        id: 'tags' as const,
        label: 'Tags',
        icon: Hash,
        disabled: false,
        show: true,
      },
      {
        id: 'editor' as const,
        label: 'Nota',
        icon: FileText,
        disabled: !activeTab,
        show: centerView !== 'editor',
      },
    ].filter((tab) => tab.show);
  }, [centerView, activeTab]);

  const { handleMouseDown, handleRightMouseDown } = usePanelResize();

  // UI polish (2026-07-16): modal do DS no lugar do prompt() nativo
  const [showNewNoteModal, setShowNewNoteModal] = React.useState(false);

  const handleCreateNewFile = React.useCallback(() => {
    if (!currentVault) return;
    setShowNewNoteModal(true);
  }, [currentVault]);

  const confirmCreateNewFile = React.useCallback(
    async (name: string) => {
      if (!currentVault) return;
      const fullName = name.endsWith('.md') ? name : `${name}.md`;
      try {
        await createItem(currentVault, fullName, false);
        setShowNewNoteModal(false);
      } catch (err) {
        setShowNewNoteModal(false);
        useAppStore.getState().notify('error', `Erro ao criar arquivo: ${err}`);
      }
    },
    [currentVault, createItem],
  );

  // Inicializa o app e carrega configurações locais
  useEffect(() => {
    initApp();

    let unlistenClose: (() => void) | null = null;
    let unlistenIndexing: (() => void) | null = null;
    let unlistenWatcher: (() => void) | null = null;

    getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await useAppStore.getState().flushPendingSave();
        if (unlistenClose) {
          unlistenClose();
        }
        await getCurrentWindow().close();
      })
      .then((unsubscribe) => {
        unlistenClose = unsubscribe;
      });

    // Listener de eventos de indexação do backend Rust
    setupIndexingListener().then((unsub) => {
      unlistenIndexing = unsub;
    });

    // Listener de eventos do vault watcher
    setupVaultChangeListener().then((unsub) => {
      unlistenWatcher = unsub;
    });

    return () => {
      if (unlistenClose) {
        unlistenClose();
      }
      if (unlistenIndexing) {
        unlistenIndexing();
      }
      if (unlistenWatcher) {
        unlistenWatcher();
      }
    };
  }, [initApp, setupVaultChangeListener]);

  // Atalhos de Teclado Globais (A11y & Modificadores - DS §11)
  useGlobalShortcuts(handleCreateNewFile);

  // E7: command palette (Ctrl/Cmd+P). Listener próprio (fora do useGlobalShortcuts) porque
  // precisa disparar TAMBÉM com o foco no editor CM — e sobrepor o "print" default.
  const [showPalette, setShowPalette] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMac]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden transition-colors duration-200 select-none bg-[var(--substrate-void)] text-[var(--text-primary)]">
      {/* Title Bar Custom Frameless */}
      <TitleBar />

      {/* Main Workspace / Welcome Screen */}
      <div className="flex-1 flex overflow-hidden relative w-full">

        {!currentVault ? (
          <WelcomeScreen />
        ) : (
          /* 3-Zone Workspace Layout */
          <>
            {/* Activity Ribbon (Barra vertical de extrema esquerda) */}
            <ActivityRibbon />

            {/* Sidebar (Zone 1) - Files or Search */}
            {isLeftPanelOpen && (
              <div
                style={{ width: sidebarWidth }}
                className="flex-shrink-0 h-full border-r border-[var(--border-subtle)] bg-[var(--substrate-void)]/85 backdrop-blur-md flex flex-col overflow-hidden"
              >
                {leftPanelMode === 'files' ? (
                  <>
                    {/* Sidebar Header */}
                    <div className="h-10 border-b border-[var(--border-subtle)] px-3 flex items-center justify-between flex-shrink-0 bg-[var(--substrate-base)]/20">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FolderOpen className="w-3.5 h-3.5 text-[var(--accent-dim)] flex-shrink-0" />
                        <span
                          className="text-xs font-semibold truncate text-[var(--text-primary)] select-all"
                          title={currentVault}
                        >
                          {currentVault.split('\\').pop() || currentVault.split('/').pop()}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleCreateNewFile}
                          className="p-1 rounded hover:bg-[var(--substrate-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                          title={`Nova Nota (${isMac ? '⌘ Cmd' : 'Ctrl'} + N)`}
                        >
                          <FilePlus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={closeVault}
                          className="p-1 rounded hover:bg-[var(--danger-muted)] text-[var(--text-secondary)] hover:text-[var(--danger)] cursor-pointer"
                          title="Fechar Vault"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={toggleLeftPanel}
                          className="p-1 rounded hover:bg-[var(--substrate-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                          title="Recolher Painel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Sidebar Content (FileTree) */}
                    <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                      {!fileTree ? (
                        /* FileTree Loading Skeleton with ease-glow */
                        <div className="space-y-3 p-2 animate-skeleton-pulse">
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-[var(--border-default)] flex-shrink-0" />
                            <div className="h-3 w-2/3 bg-[var(--border-default)] rounded" />
                          </div>
                          <div className="flex items-center gap-2 pl-4">
                            <div className="w-4 h-4 rounded bg-[var(--border-default)] flex-shrink-0" />
                            <div className="h-3 w-1/2 bg-[var(--border-default)] rounded" />
                          </div>
                          <div className="flex items-center gap-2 pl-4">
                            <div className="w-4 h-4 rounded bg-[var(--border-default)] flex-shrink-0" />
                            <div className="h-3 w-5/6 bg-[var(--border-default)] rounded" />
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-[var(--border-default)] flex-shrink-0" />
                            <div className="h-3 w-1/3 bg-[var(--border-default)] rounded" />
                          </div>
                        </div>
                      ) : !fileTree.children || fileTree.children.length === 0 ? (
                        /* Empty State: DS §10 */
                        <div className="h-full flex flex-col items-center justify-center p-4 text-center gap-3">
                          <span className="text-xs text-[var(--text-muted)] font-sans">
                            Seu vault está vazio.
                          </span>
                          <button
                            onClick={handleCreateNewFile}
                            className="px-3 py-1.5 text-xs rounded-md bg-[var(--accent)] text-[var(--substrate-void)] hover:bg-[var(--accent-bright)] font-semibold transition-all cursor-pointer"
                          >
                            + Criar primeira nota
                          </button>
                        </div>
                      ) : (
                        <FileTree node={fileTree} />
                      )}
                    </div>
                  </>
                ) : (
                  /* Global Search Mode */
                  <div className="flex-1 flex flex-col overflow-hidden p-3 gap-3">
                    <div className="flex items-center justify-between flex-shrink-0">
                      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                        Busca Global
                      </span>
                      <button
                        onClick={toggleLeftPanel}
                        className="p-1 rounded hover:bg-[var(--substrate-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-all"
                        title="Recolher Painel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="relative flex items-center shrink-0">
                      <Search className="absolute left-2.5 w-3.5 h-3.5 text-[var(--accent-dim)]" />
                      <input
                        type="text"
                        placeholder="Buscar notas..."
                        value={graphSearchQuery}
                        onChange={(e) => setGraphSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-xs text-[var(--accent-bright)] placeholder-[var(--accent-dim)] bg-[var(--substrate-raised)]/50 border border-[var(--accent-dim)]/20 rounded-md focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/25 transition-all duration-300"
                      />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <SearchResultsPanel inline />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Resize Handle 1 (Left Splitter) */}
            {isLeftPanelOpen && (
              <div
                onMouseDown={handleMouseDown}
                className="w-1.5 hover:w-2 h-full cursor-col-resize hover:bg-[var(--accent)] transition-all flex-shrink-0 z-20 relative group"
              >
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] bg-[var(--border-subtle)] group-hover:bg-[var(--border-strong)] group-active:bg-[var(--accent)] transition-colors" />
              </div>
            )}

            {/* Editor Focus Area (Zone 2 - Center) */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[var(--substrate-void)]">
              {/* Tabs Bar */}
              <div className="h-9 border-b border-[var(--border-subtle)] bg-[var(--substrate-base)] flex items-center justify-between select-none flex-shrink-0">
                {/* Tabs Wrapper */}
                <div className="flex items-center overflow-x-auto no-scrollbar flex-1 h-full">
                  {openTabs.map((tabPath) => {
                    const fileName = tabPath.split('\\').pop()?.split('/').pop() || tabPath;
                    const isActive = activeTab === tabPath && centerView === 'editor';
                    return (
                      <div
                        key={tabPath}
                        onClick={() => setActiveTab(tabPath)}
                        className={`group h-full flex items-center gap-2 px-3 border-r border-[var(--border-subtle)] text-xs cursor-pointer transition-all ${
                          isActive
                            ? 'bg-[var(--substrate-surface)] text-[var(--text-primary)] border-t-2 border-[var(--accent)] font-medium'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--substrate-base)] hover:bg-[var(--substrate-raised)]'
                        }`}
                      >
                        <span className="truncate max-w-[120px]">{fileName}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(tabPath);
                          }}
                          className="relative w-4 h-4 flex items-center justify-center rounded hover:bg-[var(--substrate-raised)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          {isDirty && tabPath === activeTab ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] group-hover:hidden transition-all" />
                              <X className="w-3 h-3 hidden group-hover:block" />
                            </>
                          ) : (
                            <X className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Swap controls in tabs bar */}
                {isRightPanelOpen && (
                  <div className="flex items-center px-2 h-full flex-shrink-0 border-l border-[var(--border-subtle)] bg-[var(--substrate-base)]">
                    <button
                      onClick={() => swapViews()}
                      disabled={rightView === 'backlinks' || rightView === 'tags'}
                      className={`p-1 rounded transition-all ${
                        rightView === 'backlinks' || rightView === 'tags'
                          ? 'opacity-40 cursor-not-allowed text-[var(--text-muted)] bg-transparent'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--substrate-raised)] cursor-pointer'
                      }`}
                      title="Trocar Foco (Grafo / Editor)"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Active Tab Panel / Editor Pane */}
              <div className="flex-1 flex overflow-hidden">
                {centerView === 'editor' && activeTab ? (
                  /* Active Note Panel */
                  <div className="flex-1 p-6 flex flex-col overflow-hidden animate-in fade-in duration-200">
                    {/* E1 (Spec 25): coluna de leitura confortável (teto 900px) OU largura
                        total via toggle no StatusBar — persiste no config */}
                    <div className={`w-full mx-auto h-full flex flex-col ${editorWideMode ? '' : 'max-w-[900px]'}`}>
                      {/* E5 (Spec 29): FileViewer roteia por tipo (md/texto/código/pdf) */}
                      <FileViewer />
                    </div>
                  </div>
                ) : (
                  /* Graph start view */
                  <GraphView />
                )}
              </div>
            </div>

            {/* Resize Handle 2 (Right Splitter) */}
            {isRightPanelOpen && (
              <div
                onMouseDown={handleRightMouseDown}
                className="w-1.5 hover:w-2 h-full cursor-col-resize hover:bg-[var(--accent)] transition-all flex-shrink-0 z-20 relative group"
              >
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] bg-[var(--border-subtle)] group-hover:bg-[var(--border-strong)] group-active:bg-[var(--accent)] transition-colors" />
              </div>
            )}

            {/* Panel (Zone 3 - Right / Rail) */}
            {isRightPanelOpen ? (
              <div
                style={{ width: rightPanelWidth }}
                className="flex-shrink-0 h-full border-l border-[var(--border-subtle)] bg-[var(--substrate-surface)]/85 backdrop-blur-md overflow-hidden flex flex-col"
              >
                {/* Unified Header */}
                <div className="h-10 border-b border-[var(--border-subtle)] px-3 flex items-center justify-between bg-[var(--substrate-surface)]/20 flex-shrink-0 select-none">
                  <div className="flex items-center gap-1 h-full">
                    {rightTabs.map((tab) => (
                      <button
                        key={tab.id}
                        disabled={tab.disabled}
                        onClick={() => setRightView(tab.id)}
                        className={`h-full px-2.5 text-[11px] font-semibold uppercase tracking-wider transition-all flex items-center border-b-2 ${
                          tab.disabled
                            ? 'opacity-40 cursor-not-allowed text-[var(--text-muted)] border-transparent'
                            : rightView === tab.id
                            ? 'border-[var(--accent)] text-[var(--text-primary)] font-bold cursor-pointer'
                            : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--substrate-raised)]/30 cursor-pointer'
                        }`}
                      >
                        <span>{tab.label}</span>
                        {tab.id === 'backlinks' && (
                          <span className={`text-[9px] px-1 py-0.2 rounded-full font-mono font-bold ml-1.5 ${
                            rightView === 'backlinks'
                              ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                              : 'bg-[var(--substrate-raised)] text-[var(--text-muted)]'
                          }`}>
                            {activeNoteBacklinks.length}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Swap Views button */}
                    <button
                      onClick={() => swapViews()}
                      disabled={rightView === 'backlinks' || rightView === 'tags'}
                      className={`p-1.5 rounded transition-all ${
                        rightView === 'backlinks' || rightView === 'tags'
                          ? 'opacity-40 cursor-not-allowed text-[var(--text-muted)] bg-transparent'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--substrate-raised)] cursor-pointer'
                      }`}
                      title="Trocar Foco (Grafo / Editor)"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                    </button>

                    {/* Close (Collapse) Right Panel button */}
                    <button
                      onClick={() => toggleRightPanel()}
                      className="p-1.5 rounded hover:bg-[var(--substrate-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-all"
                      title="Recolher Painel"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-hidden relative">
                  {rightView === 'backlinks' ? (
                    <BacklinksPanel />
                  ) : rightView === 'tags' ? (
                    <TagsPanel />
                  ) : rightView === 'graph' ? (
                    <div className="w-full h-full relative overflow-hidden">
                      <GraphView />
                    </div>
                  ) : rightView === 'editor' && activeTab ? (
                    <div className="h-full w-full p-4 overflow-hidden">
                      {/* E5 (Spec 29): FileViewer roteia por tipo (md/texto/código/pdf) */}
                      <FileViewer />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              /* Right Rail when collapsed (Reopening Affordance) */
              <div
                className="w-10 h-full flex flex-col items-center py-4 border-l border-[var(--border-subtle)] bg-[var(--substrate-surface)]/90 backdrop-blur-md z-30 flex-shrink-0 animate-in slide-in-from-right duration-[var(--duration-base)]"
                data-testid="right-rail"
              >
                <div className="flex flex-col items-center gap-4 w-full">
                  {rightTabs.map((tab) => (
                    <button
                      key={tab.id}
                      disabled={tab.disabled}
                      onClick={() => setRightView(tab.id)}
                      className={`relative p-2 rounded-lg transition-all duration-[var(--duration-fast)] flex items-center justify-center ${
                        tab.disabled
                          ? 'opacity-40 cursor-not-allowed text-[var(--text-muted)] bg-transparent'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--substrate-raised)] cursor-pointer'
                      }`}
                      title={tab.label}
                    >
                      <tab.icon className="w-5 h-5" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ConflictModal />
      <GlobalErrorBanner />
      <ToastContainer />
      {showNewNoteModal && (
        <InputModal
          title="Nova nota"
          placeholder="Nome da nota (ex: Minha Nota)"
          confirmLabel="Criar nota"
          icon={<FilePlus className="w-5 h-5 text-[var(--accent)]" />}
          validate={validateItemName}
          onConfirm={confirmCreateNewFile}
          onCancel={() => setShowNewNoteModal(false)}
        />
      )}
      {showPalette && (
        <CommandPalette
          onClose={() => setShowPalette(false)}
          onNewNote={handleCreateNewFile}
        />
      )}
      {currentVault && <StatusBar />}
    </div>
  );
}
