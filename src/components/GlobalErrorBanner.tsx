// Banner de erro global (F3 — Spec 17): extraído intacto do App.tsx. Canal "grave"
// pré-F1.2 (`globalError` no store); os transitórios vivem no ToastContainer.
import { useAppStore } from '../store/appStore';
import { X } from 'lucide-react';

export default function GlobalErrorBanner() {
  const { globalError, setGlobalError } = useAppStore();

  if (!globalError) return null;

  return (
    <div className="fixed bottom-10 right-6 z-50 animate-in fade-in slide-in-from-bottom duration-200">
      <div className="glass-card max-w-sm p-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--substrate-overlay)]/95 shadow-2xl flex items-start gap-3">
        <span className="text-xl shrink-0 mt-0.5" role="img" aria-label="Erro">⚠️</span>
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-bold text-[var(--danger)] uppercase tracking-wider mb-1 font-sans">
            Erro de Sistema
          </h4>
          <p className="text-xs text-[var(--text-primary)] font-mono break-all leading-relaxed whitespace-pre-wrap">
            {globalError}
          </p>
        </div>
        <button
          onClick={() => setGlobalError(null)}
          className="p-1 rounded hover:bg-[var(--substrate-raised)] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors cursor-pointer shrink-0"
          title="Fechar Notificação"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
