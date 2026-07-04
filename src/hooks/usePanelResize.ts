// Resize dos splitters (F3 — Spec 17): extraído intacto do App.tsx. Mantém o
// `useAppStore.setState` cru DE PROPÓSITO (code motion puro): trocar pelas ações
// setSidebarWidth/setRightPanelWidth mudaria comportamento (persistência de config)
// — isso é o BUG-03 logado no Bugs_Conhecidos.md, a decidir com o Felipe.
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

  return { handleMouseDown, handleRightMouseDown };
}
