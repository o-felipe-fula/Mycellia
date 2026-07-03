// Slice de notificações + erro global + rebuild do índice (F3 — Spec 17): extraído
// intacto do appStore.ts. notify/dismissNotification são consumidos por praticamente
// todos os grupos (save, watcher, grafo, vault) via get()/getState().
import type { StoreApi } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { AppState } from './appStore';
import type { AppNotification, NotificationType, NotifyOptions } from './types';

type Set = StoreApi<AppState>['setState'];
type Get = StoreApi<AppState>['getState'];

export const createNotificationsSlice = (set: Set, get: Get) => ({
  globalError: null as string | null,
  setGlobalError: (error: string | null) => set({ globalError: error }),
  notifications: [] as AppNotification[],
  notify: (type: NotificationType, message: string, opts?: NotifyOptions) => {
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
  dismissNotification: (id: string) =>
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
});
