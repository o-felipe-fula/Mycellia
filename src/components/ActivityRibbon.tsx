import { useAppStore } from '../store/appStore';
import { Folder, Search, Activity } from 'lucide-react';

export default function ActivityRibbon() {
  const {
    leftPanelMode,
    isLeftPanelOpen,
    centerView,
    activeTab,
    setLeftPanelMode,
    toggleLeftPanel,
    setCenterView,
    platform,
  } = useAppStore();

  const isMac = platform === 'darwin' || platform === 'macos';
  const mod = isMac ? '⌘ Cmd' : 'Ctrl';

  const handleFilesClick = () => {
    if (isLeftPanelOpen && leftPanelMode === 'files') {
      toggleLeftPanel();
    } else {
      setLeftPanelMode('files');
    }
  };

  const handleSearchClick = () => {
    if (isLeftPanelOpen && leftPanelMode === 'search') {
      toggleLeftPanel();
    } else {
      setLeftPanelMode('search');
    }
  };

  const handleGraphClick = () => {
    if (centerView === 'graph' && activeTab) {
      setCenterView('editor');
    } else {
      setCenterView('graph');
    }
  };

  const isFilesActive = isLeftPanelOpen && leftPanelMode === 'files';
  const isSearchActive = isLeftPanelOpen && leftPanelMode === 'search';
  const isGraphActive = centerView === 'graph';

  return (
    <div className="w-12 h-full flex flex-col justify-between items-center py-4 border-r border-[var(--border-subtle)] bg-[var(--substrate-surface)]/90 backdrop-blur-md z-30 flex-shrink-0">
      
      {/* View Toggles */}
      <div className="flex flex-col items-center gap-4 w-full">
        {/* Files Toggle */}
        <button
          onClick={handleFilesClick}
          className={`relative p-2.5 rounded-lg transition-all duration-200 cursor-pointer hover:bg-[var(--substrate-raised)] group ${
            isFilesActive
              ? 'text-[var(--accent)] bg-[var(--accent-muted)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
          title={`Navegador de Arquivos (${mod} + Shift + E)`}
        >
          <Folder className="w-5 h-5" />
          {isFilesActive && (
            <div className="absolute left-0 top-1/4 bottom-1/4 w-0.5 bg-[var(--accent)] rounded-r" />
          )}
        </button>

        {/* Search Toggle */}
        <button
          onClick={handleSearchClick}
          className={`relative p-2.5 rounded-lg transition-all duration-200 cursor-pointer hover:bg-[var(--substrate-raised)] group ${
            isSearchActive
              ? 'text-[var(--accent)] bg-[var(--accent-muted)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
          title={`Busca Global (${mod} + Shift + F)`}
        >
          <Search className="w-5 h-5" />
          {isSearchActive && (
            <div className="absolute left-0 top-1/4 bottom-1/4 w-0.5 bg-[var(--accent)] rounded-r" />
          )}
        </button>

        {/* Graph Toggle */}
        <button
          onClick={handleGraphClick}
          className={`relative p-2.5 rounded-lg transition-all duration-200 cursor-pointer hover:bg-[var(--substrate-raised)] group ${
            isGraphActive
              ? 'text-[var(--accent)] bg-[var(--accent-muted)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}
          title={`Visualizar Grafo (${mod} + G)`}
        >
          <Activity className="w-5 h-5" />
          {isGraphActive && (
            <div className="absolute left-0 top-1/4 bottom-1/4 w-0.5 bg-[var(--accent)] rounded-r" />
          )}
        </button>
      </div>


    </div>
  );
}
