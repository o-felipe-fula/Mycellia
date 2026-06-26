import { X, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { useAppStore, type NotificationType } from '../store/appStore';

// Container de toasts transitórios (canto superior direito). O canal "grave/persistente"
// (falha ao salvar) continua na faixa de erro do App.tsx (canto inferior). A remoção
// automática dos transitórios é agendada no store (notify -> setTimeout -> dismissNotification).
const TYPE_STYLE: Record<NotificationType, { token: string; Icon: typeof AlertTriangle }> = {
  error: { token: 'var(--danger)', Icon: AlertTriangle },
  warning: { token: 'var(--warning)', Icon: AlertTriangle },
  success: { token: 'var(--accent)', Icon: CheckCircle },
  info: { token: 'var(--text-secondary)', Icon: Info },
};

export function ToastContainer() {
  const notifications = useAppStore((s) => s.notifications);
  const dismissNotification = useAppStore((s) => s.dismissNotification);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-6 right-6 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {notifications.map((n) => {
        const { token, Icon } = TYPE_STYLE[n.type];
        return (
          <div
            key={n.id}
            className="pointer-events-auto glass-card p-3 rounded-xl bg-[var(--substrate-overlay)] shadow-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top duration-200"
            style={{ border: `1px solid ${token}` }}
            role="status"
          >
            <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: token }} aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--text-primary)] leading-relaxed break-words whitespace-pre-wrap">
                {n.message}
              </p>
              {n.action && (
                <button
                  onClick={() => {
                    n.action?.run();
                    dismissNotification(n.id);
                  }}
                  className="mt-2 text-xs font-semibold underline cursor-pointer hover:opacity-80"
                  style={{ color: token }}
                >
                  {n.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => dismissNotification(n.id)}
              className="p-1 rounded hover:bg-[var(--substrate-raised)] text-[var(--text-muted)] transition-colors cursor-pointer shrink-0"
              title="Fechar"
              aria-label="Fechar notificação"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
