import React, { useEffect } from 'react';
import { useAppStore, setupIndexingListener } from './store/appStore';
import { open as openDirectory } from '@tauri-apps/plugin-dialog';
import {
  FolderOpen,
  PlusCircle,
  Sun,
  Moon,
  FileText,
  X,
  LogOut,
  FilePlus,
  Search,
  ArrowLeftRight,
  Link2,
  Activity,
} from 'lucide-react';
import FileTree from './components/FileTree';
import MarkdownEditor from './components/MarkdownEditor';
import BacklinksPanel from './components/BacklinksPanel';
import { GraphView } from './components/GraphView';
import { getCurrentWindow } from '@tauri-apps/api/window';
import TitleBar from './components/TitleBar';
import ActivityRibbon from './components/ActivityRibbon';
import { SearchResultsPanel } from './components/SearchResultsPanel';
import { serializeRawNote } from './utils/markdown';
import StatusBar from './components/StatusBar';

export default function App() {
  const {
    theme,
    toggleTheme,
    initApp,
    currentVault,
    recentVaults,
    loadVault,
    closeVault,
    fileTree,
    sidebarWidth,
    openTabs,
    activeTab,
    setActiveTab,
    closeTab,
    createItem,
    activeNoteContent,
    updateActiveNoteContent,
    conflictModal,
    resolveConflict,
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
    globalError,
    setGlobalError,
    platform,
    setLeftPanelMode,
    setCenterView,
    loadGraphData,
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
        id: 'editor' as const,
        label: 'Nota',
        icon: FileText,
        disabled: !activeTab,
        show: centerView !== 'editor',
      },
    ].filter((tab) => tab.show);
  }, [centerView, activeTab]);

  // Resize handler da barra lateral esquerda (ajustando offset da ribbon de 48px)
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(420, moveEvent.clientX - 48));
      useAppStore.setState({ sidebarWidth: newWidth });
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Resize handler da barra lateral direita
  const handleRightMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startWidth = useAppStore.getState().rightPanelWidth;
    const startX = e.clientX;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(240, Math.min(480, startWidth - deltaX));
      useAppStore.setState({ rightPanelWidth: newWidth });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleCreateNewFile = React.useCallback(async () => {
    if (!currentVault) return;
    const name = prompt('Digite o nome da nova nota (ex: Minha Nota):');
    if (name) {
      const fullName = name.endsWith('.md') ? name : `${name}.md`;
      try {
        await createItem(currentVault, fullName, false);
      } catch (err) {
        alert(`Erro ao criar arquivo: ${err}`);
      }
    }
  }, [currentVault, createItem]);

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
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Se estiver digitando em um input/textarea, não disparar atalhos globais de criação/navegação
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('.cm-editor')
      ) {
        return;
      }

      const isMacPlatform = platform === 'darwin' || platform === 'macos';
      const isMod = isMacPlatform ? e.metaKey : e.ctrlKey;

      // Nova Nota: Mod + N
      if (isMod && e.key.toLowerCase() === 'n' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleCreateNewFile();
      }

      // Busca Global: Mod + Shift + F
      if (isMod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (isLeftPanelOpen && leftPanelMode === 'search') {
          toggleLeftPanel();
        } else {
          setLeftPanelMode('search');
        }
      }

      // Navegador de Arquivos: Mod + Shift + E
      if (isMod && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (isLeftPanelOpen && leftPanelMode === 'files') {
          toggleLeftPanel();
        } else {
          setLeftPanelMode('files');
        }
      }

      // Visualizar/Toggle Grafo: Mod + G
      if (isMod && e.key.toLowerCase() === 'g' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (centerView === 'graph' && activeTab) {
          setCenterView('editor');
        } else {
          setCenterView('graph');
        }
      }

      // Recalcular Grafo: Mod + Shift + R
      if (isMod && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (centerView === 'graph') {
          loadGraphData();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [
    platform,
    currentVault,
    isLeftPanelOpen,
    leftPanelMode,
    centerView,
    activeTab,
    toggleLeftPanel,
    setLeftPanelMode,
    setCenterView,
    loadGraphData,
    handleCreateNewFile,
  ]);

  const handleOpenVault = async () => {
    try {
      const selected = await openDirectory({
        directory: true,
        multiple: false,
        title: 'Selecionar Pasta do Vault',
      });
      if (selected && typeof selected === 'string') {
        await loadVault(selected);
      }
    } catch (err) {
      console.error('Failed to open vault:', err);
      alert('Falha ao abrir o diretório do vault.');
    }
  };

  const handleCreateVault = async () => {
    try {
      const selected = await openDirectory({
        directory: true,
        multiple: false,
        title: 'Escolha o diretório para criar o novo Vault',
      });
      if (selected && typeof selected === 'string') {
        await loadVault(selected);
      }
    } catch (err) {
      console.error('Failed to create vault:', err);
      alert('Falha ao selecionar diretório para criar o vault.');
    }
  };





  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden transition-colors duration-200 select-none bg-[var(--substrate-void)] text-[var(--text-primary)]">
      {/* Title Bar Custom Frameless */}
      <TitleBar />

      {/* Main Workspace / Welcome Screen */}
      <div className="flex-1 flex overflow-hidden relative w-full">

        {!currentVault ? (
          /* Welcome Screen */
          <main className="flex-1 flex flex-col justify-center items-center p-6 relative overflow-hidden">
            {theme === 'dark' && (
              <div className="absolute w-[500px] h-[500px] rounded-full bg-[var(--accent-muted)] filter blur-[100px] -z-10 pointer-events-none opacity-40 translate-y-[-50px]" />
            )}
            <div className="max-w-2xl w-full flex flex-col items-center text-center space-y-8">
              <div className="space-y-3">
                <div className="flex justify-center mb-2">
                  <button
                    onClick={toggleTheme}
                    className="p-2 rounded-lg hover:bg-[var(--substrate-raised)] transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                    aria-label="Alternar tema"
                  >
                    {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                  </button>
                </div>
                <h1 className="text-5xl font-display font-black tracking-tight text-[var(--text-primary)]">
                  Bem-vindo ao{' '}
                  <span className="bg-gradient-to-r from-[var(--accent)] to-[var(--tag)] bg-clip-text text-transparent">
                    Mycellia
                  </span>
                </h1>
                <p className="text-[var(--text-secondary)] text-lg max-w-md mx-auto">
                  Um editor de conhecimento local-first, offline e com conexões em grafo.
                </p>
              </div>

              {/* Action Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full mt-4">
                <button
                  onClick={handleOpenVault}
                  className="glass-card p-6 rounded-xl flex flex-col items-center justify-center text-center gap-4 hover:scale-[1.01] cursor-pointer"
                >
                  <div className="p-4 rounded-full bg-[var(--substrate-surface)] text-[var(--accent-dim)]">
                    <FolderOpen className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-base text-[var(--text-primary)]">
                      Abrir pasta existente
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Abra seu vault do Obsidian ou pasta local com notas Markdown
                    </p>
                  </div>
                </button>

                <button
                  onClick={handleCreateVault}
                  className="glass-card p-6 rounded-xl flex flex-col items-center justify-center text-center gap-4 hover:scale-[1.01] cursor-pointer"
                >
                  <div className="p-4 rounded-full bg-[var(--substrate-surface)] text-[var(--accent)]">
                    <PlusCircle className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-base text-[var(--text-primary)]">
                      Criar novo Vault
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Crie uma nova pasta vazia e comece a tecer sua teia de conhecimento
                    </p>
                  </div>
                </button>
              </div>

              {/* Recent Vaults */}
              <div className="w-full max-w-md pt-6 border-t border-[var(--border-default)]">
                <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
                  Vaults Recentes
                </h4>
                {recentVaults.length === 0 ? (
                  <div className="text-xs text-[var(--text-muted)] italic">
                    Nenhum vault aberto recentemente.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentVaults.map((vault) => (
                      <button
                        key={vault}
                        onClick={() => loadVault(vault)}
                        className="w-full flex items-center justify-between p-2.5 rounded-lg bg-[var(--substrate-raised)] hover:bg-[var(--substrate-surface)] border border-[var(--border-default)] text-left transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileText className="w-4 h-4 text-[var(--tag)] flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                              {vault.split('\\').pop() || vault.split('/').pop()}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] truncate font-mono mt-0.5">
                              {vault}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </main>
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
                      disabled={rightView === 'backlinks'}
                      className={`p-1 rounded transition-all ${
                        rightView === 'backlinks'
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
                    <div className="max-w-3xl w-full mx-auto h-full flex flex-col">
                      {activeNoteContent !== null && (
                        <MarkdownEditor
                          content={activeNoteContent}
                          onChange={updateActiveNoteContent}
                        />
                      )}
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
                      disabled={rightView === 'backlinks'}
                      className={`p-1.5 rounded transition-all ${
                        rightView === 'backlinks'
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
                  ) : rightView === 'graph' ? (
                    <div className="w-full h-full relative overflow-hidden">
                      <GraphView />
                    </div>
                  ) : rightView === 'editor' && activeTab ? (
                    <div className="h-full w-full p-4 overflow-hidden">
                      {activeNoteContent !== null && (
                        <MarkdownEditor
                          content={activeNoteContent}
                          onChange={updateActiveNoteContent}
                        />
                      )}
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

      {/* Conflict Modal */}
      {conflictModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-card max-w-md w-full p-6 rounded-2xl border border-[var(--border-default)] flex flex-col gap-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <h2 className="text-lg font-display font-bold text-[var(--text-primary)]">
              {conflictModal.diskContent === null ? 'Nota excluída no disco' : 'Conflito de Modificação'}
            </h2>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {conflictModal.diskContent === null
                ? `A nota "${conflictModal.path.split('\\').pop() || conflictModal.path.split('/').pop()}" foi excluída fora do editor, mas você possui alterações locais não salvas.`
                : `A nota "${conflictModal.path.split('\\').pop() || conflictModal.path.split('/').pop()}" foi modificada externamente no disco e você também possui alterações locais.`}
            </p>
            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                onClick={() => resolveConflict('load-disk')}
                className="px-4 py-2 text-xs rounded-lg font-medium cursor-pointer transition-all border border-[var(--warning)] bg-[var(--warning-muted)] hover:bg-[var(--warning)] text-[var(--warning)] hover:text-[var(--accent-contrast)]"
              >
                {conflictModal.diskContent === null ? 'Descartar e Fechar' : 'Carregar versão do disco'}
              </button>
              <button
                onClick={() => resolveConflict('keep-local')}
                className="px-4 py-2 text-xs rounded-lg font-medium cursor-pointer transition-all border border-[var(--border-default)] bg-[var(--substrate-raised)] hover:bg-[var(--substrate-surface)] text-[var(--text-primary)]"
              >
                {conflictModal.diskContent === null ? 'Salvar e Recriar' : 'Manter minhas alterações'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Global Error Banner */}
      {globalError && (
        <div className="fixed bottom-10 right-6 z-50 animate-in fade-in slide-in-from-bottom duration-200">
          <div className="glass-card max-w-sm p-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--substrate-overlay)]/95 shadow-2xl flex items-start gap-3">
            <span className="text-xl shrink-0 mt-0.5" role="img" aria-label="Erro">⚠️</span>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-bold text-[var(--danger)] uppercase tracking-wider mb-1 font-sans">
                Erro de Sistema
              </h4>
              <p className="text-xs text-[var(--text-primary)] font-mono break-all leading-relaxed whitespace-pre-wrap">
                {globalError}
              </p>
            </div>
            <button
              onClick={() => setGlobalError(null)}
              className="p-1 rounded hover:bg-[var(--substrate-raised)] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors cursor-pointer shrink-0"
              title="Fechar Notificação"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      {currentVault && <StatusBar />}
    </div>
  );
}
