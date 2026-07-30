// Tipos de dados do app (F3 — Spec 17): extraídos intactos do appStore.ts. O appStore
// RE-EXPORTA tudo daqui — os 19 consumidores continuam importando de '../store/appStore'.
// O contrato AppState (estado+ações) permanece no appStore, junto do store.

// --- Sistema de notificações (F1.2) -------------------------------------------------
// Toasts transitórios (somem sozinhos) para falhas que hoje eram mudas (só console.error).
// O canal "grave/persistente" (falha ao salvar, etc.) continua na faixa `globalError`.
export type NotificationType = 'error' | 'warning' | 'success' | 'info';

export interface NotificationAction {
  label: string;
  run: () => void;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  message: string;
  /** Persistente fica até o usuário fechar; transitório some após `ttlMs`. */
  persistent: boolean;
  action?: NotificationAction;
}

export interface NotifyOptions {
  persistent?: boolean;
  ttlMs?: number;
  action?: NotificationAction;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

export interface Backlink {
  source_path: string;
  source_title: string;
  context: string;
}

export interface OutgoingLink {
  target_name: string;
  target_path: string | null;
  target_title: string | null;
}

export interface GraphNode {
  id: string;
  label: string;
  exists: boolean;
  degree: number;
  // react-force-graph will inject x,y,z or we can load them:
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
}

// E2 Fatia A (Spec 28): tag agregada vinda do get_all_tags
export interface TagCount {
  tag: string;
  count: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface GraphPosition {
  x2d?: number;
  y2d?: number;
  x3d?: number;
  y3d?: number;
  z3d?: number;
  x?: number;
  y?: number;
  z?: number;
}


export interface AppConfig {
  current_vault: string | null;
  recent_vaults: string[];
  theme: 'light' | 'dark';
  sidebar_width: number;
  editor_wide_mode: boolean;
  right_panel_width: number;
  // E3 (Spec 32): corretor ortográfico (default ligado)
  spellcheck_enabled: boolean;
}
