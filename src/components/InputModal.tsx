// Modais do Design System (UI polish 2026-07-16): substituem os prompt()/confirm()
// nativos do webview ("feia que só a porra" — Felipe). DNA visual do ConflictModal:
// overlay blur + glass-card. Enter confirma, Esc cancela, erro inline, autofocus.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

interface InputModalProps {
  title: string;
  description?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel: string;
  icon?: ReactNode;
  /** devolve mensagem de erro ou null se válido */
  validate?: (value: string) => string | null;
  onConfirm: (value: string) => void | Promise<void>;
  onCancel: () => void;
}

export function InputModal({
  title,
  description,
  placeholder,
  initialValue = '',
  confirmLabel,
  icon,
  validate,
  onConfirm,
  onCancel,
}: InputModalProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleConfirm = async () => {
    const validationError = validate ? validate(value) : null;
    if (validationError) {
      setError(validationError);
      inputRef.current?.focus();
      return;
    }
    await onConfirm(value.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  // Portal no body (mesmo remédio do ContextMenu): o backdrop-filter dos painéis de
  // vidro cria containing block e prenderia o `fixed` dentro da coluna da sidebar
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="glass-card max-w-md w-full p-6 rounded-2xl border border-[var(--border-default)] flex flex-col gap-4 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center gap-2.5">
          {icon}
          <h2 className="text-lg font-display font-bold text-[var(--text-primary)]">{title}</h2>
        </div>

        {description && (
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed -mt-2">{description}</p>
        )}

        <div className="flex flex-col gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={handleKeyDown}
            className="w-full px-3 py-2.5 rounded-lg bg-[var(--substrate-base)] border border-[var(--border-default)] focus:border-[var(--accent)] outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] transition-colors"
          />
          {error && (
            <span className="text-[11px] text-[var(--danger)] animate-in fade-in duration-150">
              ⚠️ {error}
            </span>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 mt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs rounded-lg font-medium cursor-pointer transition-all border border-[var(--border-default)] bg-transparent hover:bg-[var(--substrate-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={value.trim() === ''}
            className="px-4 py-2 text-xs rounded-lg font-semibold cursor-pointer transition-all border border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-contrast)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--accent-muted)] disabled:hover:text-[var(--accent)]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmModal({ title, message, confirmLabel, danger = false, onConfirm, onCancel }: ConfirmModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, onConfirm]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="glass-card max-w-md w-full p-6 rounded-2xl border border-[var(--border-default)] flex flex-col gap-4 shadow-2xl animate-in zoom-in-95 duration-200">
        <h2 className="text-lg font-display font-bold text-[var(--text-primary)]">{title}</h2>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{message}</p>
        <div className="flex items-center justify-end gap-3 mt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs rounded-lg font-medium cursor-pointer transition-all border border-[var(--border-default)] bg-transparent hover:bg-[var(--substrate-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-xs rounded-lg font-semibold cursor-pointer transition-all border ${
              danger
                ? 'border-[var(--danger)] bg-[var(--danger-muted)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-[var(--accent-contrast)]'
                : 'border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-contrast)]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
