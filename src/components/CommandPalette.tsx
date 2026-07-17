// Command palette (E7 — trilha E): Ctrl/Cmd+P abre uma paleta de ações com busca fuzzy
// e navegação por teclado (setas + Enter, Esc fecha). DNA visual do InputModal/DS: portal
// no body + glass-card. As ações vêm do store; "Nova nota" chega via prop (vive no App).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FilePlus, SunMoon, Code2, MoveHorizontal, Network, Search, Hash, Link2,
  RefreshCw, Database, Command as CommandIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAppStore } from '../store/appStore';

interface Command {
  id: string;
  label: string;
  hint?: string;
  Icon: LucideIcon;
  run: () => void;
}

interface CommandPaletteProps {
  onClose: () => void;
  onNewNote: () => void;
}

// Fuzzy match: subsequência case-insensitive. Rank: substring exato > prefixo de palavra
// > subsequência; desempate pela posição do 1º casamento. Retorna null se não casa.
function fuzzyScore(query: string, text: string): number | null {
  if (query === '') return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  const idx = t.indexOf(q);
  if (idx !== -1) {
    // Substring contígua: melhor score; bônus se começa em fronteira de palavra
    const atWordStart = idx === 0 || /\s/.test(t[idx - 1]);
    return 1000 - idx + (atWordStart ? 500 : 0);
  }

  // Subsequência (caracteres na ordem, não contíguos)
  let ti = 0;
  let firstMatch = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return null;
    if (firstMatch === -1) firstMatch = found;
    ti = found + 1;
  }
  return 100 - firstMatch;
}

export default function CommandPalette({ onClose, onNewNote }: CommandPaletteProps) {
  const store = useAppStore();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const run = (fn: () => void) => () => {
      fn();
      onClose();
    };
    return [
      { id: 'new-note', label: 'Nova nota', hint: 'Ctrl+N', Icon: FilePlus, run: run(onNewNote) },
      { id: 'theme', label: 'Alternar tema (claro/escuro)', Icon: SunMoon, run: run(store.toggleTheme) },
      { id: 'source', label: 'Alternar modo Fonte', hint: 'Ctrl+E', Icon: Code2, run: run(store.toggleEditorSourceMode) },
      { id: 'wide', label: 'Alternar largura da linha (Confortável/Cheia)', Icon: MoveHorizontal, run: run(store.toggleEditorWideMode) },
      { id: 'graph', label: 'Abrir o grafo', hint: 'Ctrl+G', Icon: Network, run: run(() => store.setCenterView('graph')) },
      { id: 'search', label: 'Buscar no vault', hint: 'Ctrl+Shift+F', Icon: Search, run: run(() => store.setLeftPanelMode('search')) },
      { id: 'tags', label: 'Painel de tags', Icon: Hash, run: run(() => store.setRightView('tags')) },
      { id: 'backlinks', label: 'Painel de conexões (backlinks)', Icon: Link2, run: run(() => store.setRightView('backlinks')) },
      { id: 'recalc-graph', label: 'Recalcular layout do grafo', hint: 'Ctrl+Shift+R', Icon: RefreshCw, run: run(store.loadGraphData) },
      { id: 'rebuild-index', label: 'Reconstruir índice de busca', Icon: Database, run: run(store.rebuildIndex) },
    ];
    // store é estável entre renders (zustand); onNewNote/onClose idem via App
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNewNote, onClose]);

  const filtered = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, score: fuzzyScore(query, c.label) }))
      .filter((x): x is { c: Command; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score);
    return scored.map((x) => x.c);
  }, [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Clampa o índice ativo quando a lista filtrada encolhe
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Mantém o item ativo visível ao navegar por teclado
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[activeIndex]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="glass-card w-full max-w-xl rounded-2xl border border-[var(--border-default)] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border-subtle)]">
          <CommandIcon className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Digite um comando…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)]"
          />
        </div>

        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
              Nenhum comando encontrado
            </div>
          ) : (
            filtered.map((cmd, idx) => (
              <button
                key={cmd.id}
                data-idx={idx}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => cmd.run()}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left cursor-pointer transition-colors ${
                  idx === activeIndex ? 'bg-[var(--accent-muted)]' : 'hover:bg-[var(--substrate-raised)]'
                }`}
              >
                <cmd.Icon
                  className={`w-4 h-4 flex-shrink-0 ${idx === activeIndex ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}
                />
                <span className={`flex-1 text-sm ${idx === activeIndex ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                  {cmd.label}
                </span>
                {cmd.hint && (
                  <kbd className="text-[10px] font-mono text-[var(--text-muted)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]">
                    {cmd.hint}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
