// Slice de layout & navegação (F3 — Spec 17): extraído intacto do appStore.ts.
// A coerência centro/direita usa ensureDifferentViews (compartilhado com as ações
// de abas do core via ./viewLayout). platform e isNoteDirty ficam no core.
import type { StoreApi } from 'zustand';
import type { AppState } from './appStore';
import { ensureDifferentViews } from './viewLayout';

type Set = StoreApi<AppState>['setState'];

export const createLayoutSlice = (set: Set) => ({
  leftPanelMode: 'files' as 'files' | 'search',
  isLeftPanelOpen: true,
  isRightPanelOpen: false,
  centerView: 'graph' as 'editor' | 'graph',
  rightView: 'backlinks' as 'backlinks' | 'graph' | 'editor' | 'tags',
  rightPanelWidth: 300,
  // E1.6 (Spec 27): modo Fonte = corpo da nota 100% cru, sem decorações (sessão, não persiste)
  editorSourceMode: false,

  setLeftPanelMode: (mode: 'files' | 'search') => set({ leftPanelMode: mode, isLeftPanelOpen: true }),
  toggleLeftPanel: () => set((state) => ({ isLeftPanelOpen: !state.isLeftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ isRightPanelOpen: !state.isRightPanelOpen })),
  setRightPanelWidth: (width: number) => set({ rightPanelWidth: width }),
  setCenterView: (view: 'editor' | 'graph') => set((state) => ensureDifferentViews(view, state.rightView)),
  setRightView: (view: 'backlinks' | 'graph' | 'editor' | 'tags') => set((state) => {
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
      rightView: nextRight as 'backlinks' | 'graph' | 'editor' | 'tags'
    };
  }),
  toggleEditorSourceMode: () => set((state) => ({ editorSourceMode: !state.editorSourceMode })),
});
