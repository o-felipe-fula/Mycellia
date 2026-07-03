// Atalhos de teclado globais (F3 — Spec 17): extraído intacto do App.tsx (A11y &
// Modificadores — DS §11). Lê layout/navegação do store; recebe handleCreateNewFile
// do App (depende de createItem+currentVault de lá). A lista de deps é a original.
import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';

export function useGlobalShortcuts(handleCreateNewFile: () => void) {
  const {
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
  } = useAppStore();

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
}
