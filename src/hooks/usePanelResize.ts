// Resize dos splitters (extraído do App.tsx no F3).
// BUG-03 (fix): durante o DRAG o update continua via `setState` cru (dezenas de updates
// por segundo — persistir cada um martelaria o disco); no MOUSEUP a largura final é
// persistida 1x via ação `setSidebarWidth` (que salva a config no Rust). A largura do
// painel DIREITO não existe no AppConfig (não é persistida entre sessões) — o mouseup
// usa a ação `setRightPanelWidth` por consistência; persisti-la é feature futura.
import React from 'react';
import { useAppStore } from '../store/appStore';

export function usePanelResize() {
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
      // BUG-03: persiste a largura final na config (uma vez, no fim do drag)
      useAppStore.getState().setSidebarWidth(useAppStore.getState().sidebarWidth);
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
      useAppStore.getState().setRightPanelWidth(useAppStore.getState().rightPanelWidth);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return { handleMouseDown, handleRightMouseDown };
}
