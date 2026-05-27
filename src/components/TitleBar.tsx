import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X } from 'lucide-react';

export default function TitleBar() {
  const { platform, currentVault } = useAppStore();
  const [isMaximized, setIsMaximized] = useState(false);

  const isMac = platform === 'darwin' || platform === 'macos';

  useEffect(() => {
    const checkMaximized = async () => {
      try {
        const appWindow = getCurrentWindow();
        const max = await appWindow.isMaximized();
        setIsMaximized(max);
      } catch (err) {
        console.error('Failed to check if window is maximized:', err);
      }
    };

    checkMaximized();

    // Monitor window resize to check if maximized
    window.addEventListener('resize', checkMaximized);
    return () => window.removeEventListener('resize', checkMaximized);
  }, []);

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (err) {
      console.error('Failed to minimize window:', err);
    }
  };

  const handleMaximize = async () => {
    try {
      const appWindow = getCurrentWindow();
      if (await appWindow.isMaximized()) {
        await appWindow.unmaximize();
        setIsMaximized(false);
      } else {
        await appWindow.maximize();
        setIsMaximized(true);
      }
    } catch (err) {
      console.error('Failed to toggle maximize:', err);
    }
  };

  const handleClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.error('Failed to close window:', err);
    }
  };

  const vaultName = currentVault ? currentVault.split('\\').pop() || currentVault.split('/').pop() : '';

  return (
    <div
      className="h-10 w-full flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--substrate-void)]/85 backdrop-blur-md text-[var(--text-secondary)] select-none flex-shrink-0 z-40 relative"
    >
      {/* macOS: Space for traffic lights */}
      {isMac ? (
        <div className="w-[72px] flex-shrink-0" />
      ) : null}

      {/* Title & Vault info - Drag Region */}
      <div
        data-tauri-drag-region
        className={`flex-1 h-full flex items-center gap-2 px-3 text-xs font-medium font-sans truncate cursor-default ${
          isMac ? 'justify-center' : ''
        }`}
      >
        <span data-tauri-drag-region className="font-bold tracking-wider bg-gradient-to-r from-[var(--accent)] to-[var(--tag)] bg-clip-text text-transparent">
          MYCELLIA
        </span>
        {vaultName && (
          <>
            <span data-tauri-drag-region className="text-[var(--text-muted)] font-mono text-[9px]">•</span>
            <span data-tauri-drag-region className="text-[var(--text-muted)] truncate max-w-[150px] font-mono text-[10px]">
              {vaultName}
            </span>
          </>
        )}
      </div>

      {/* Windows/Linux: Custom window controls */}
      {!isMac ? (
        <div className="flex items-center h-full flex-shrink-0 relative z-50">
          <button
            onClick={handleMinimize}
            className="flex items-center justify-center w-11 h-full hover:bg-[var(--substrate-raised)] active:bg-[var(--substrate-raised)]/80 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
            title="Minimizar"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleMaximize}
            className="flex items-center justify-center w-11 h-full hover:bg-[var(--substrate-raised)] active:bg-[var(--substrate-raised)]/80 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
            title={isMaximized ? 'Restaurar' : 'Maximizar'}
          >
            {isMaximized ? <Copy className="w-3 h-3 rotate-180" /> : <Square className="w-3 h-3" />}
          </button>
          <button
            onClick={handleClose}
            className="flex items-center justify-center w-11 h-full hover:bg-[#E81123] active:bg-[#E81123]/80 hover:text-white text-[var(--text-muted)] transition-all cursor-pointer"
            title="Fechar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        /* Empty balance block for centering on Mac */
        <div className="w-[72px] flex-shrink-0" />
      )}
    </div>
  );
}
