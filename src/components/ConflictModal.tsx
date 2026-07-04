// Modal de conflito de modificação (F3 — Spec 17): extraído intacto do App.tsx.
// Apresentacional; a resolução (keep-local/load-disk) vive no store com o snapshot
// congelado (Incidente #2) — aqui só se renderiza e delega.
import { useAppStore } from '../store/appStore';

export default function ConflictModal() {
  const { conflictModal, resolveConflict } = useAppStore();

  if (!conflictModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="glass-card max-w-md w-full p-6 rounded-2xl border border-[var(--border-default)] flex flex-col gap-4 shadow-2xl animate-in zoom-in-95 duration-200">
        <h2 className="text-lg font-display font-bold text-[var(--text-primary)]">
          {conflictModal.diskContent === null ? 'Nota excluída no disco' : 'Conflito de Modificação'}
        </h2>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          {conflictModal.diskContent === null
            ? `A nota "${conflictModal.path.split('\\').pop() || conflictModal.path.split('/').pop()}" foi excluída fora do editor, mas você possui alterações locais não salvas.`
            : `A nota "${conflictModal.path.split('\\').pop() || conflictModal.path.split('/').pop()}" foi modificada externamente no disco e você também possui alterações locais.`}
        </p>
        <div className="flex items-center justify-end gap-3 mt-2">
          <button
            onClick={() => resolveConflict('load-disk')}
            className="px-4 py-2 text-xs rounded-lg font-medium cursor-pointer transition-all border border-[var(--warning)] bg-[var(--warning-muted)] hover:bg-[var(--warning)] text-[var(--warning)] hover:text-[var(--accent-contrast)]"
          >
            {conflictModal.diskContent === null ? 'Descartar e Fechar' : 'Carregar versão do disco'}
          </button>
          <button
            onClick={() => resolveConflict('keep-local')}
            className="px-4 py-2 text-xs rounded-lg font-medium cursor-pointer transition-all border border-[var(--border-default)] bg-[var(--substrate-raised)] hover:bg-[var(--substrate-surface)] text-[var(--text-primary)]"
          >
            {conflictModal.diskContent === null ? 'Salvar e Recriar' : 'Manter minhas alterações'}
          </button>
        </div>
      </div>
    </div>
  );
}
