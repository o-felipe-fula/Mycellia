import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { Folder, Search, Activity, Settings } from 'lucide-react';

export default function ActivityRibbon() {
  // D0 (Spec 33): tooltips via i18n (área-prova da extração) + engrenagem no rodapé
  const { t } = useTranslation();
  const {
    leftPanelMode,
    isLeftPanelOpen,
    centerView,
    activeTab,
    setLeftPanelMode,
    toggleLeftPanel,
    setCenterView,
    setSettingsOpen,
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
          title={t('ribbon.files', { mod })}
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
          title={t('ribbon.search', { mod })}
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
          title={t('ribbon.graph', { mod })}
        >
          <Activity className="w-5 h-5" />
          {isGraphActive && (
            <div className="absolute left-0 top-1/4 bottom-1/4 w-0.5 bg-[var(--accent)] rounded-r" />
          )}
        </button>
      </div>

      {/* D0 (Spec 33): Configurações — o slot de baixo do justify-between era dela */}
      <button
        data-testid="ribbon-settings"
        onClick={() => setSettingsOpen(true)}
        className="p-2.5 rounded-lg transition-all duration-200 cursor-pointer hover:bg-[var(--substrate-raised)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        title={t('ribbon.settings')}
      >
        <Settings className="w-5 h-5" />
      </button>
    </div>
  );
}
