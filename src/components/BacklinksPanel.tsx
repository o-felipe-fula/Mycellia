import { useAppStore } from '../store/appStore';
import { FileText, ArrowDownLeft, ArrowUpRight, FilePlus } from 'lucide-react';

export default function BacklinksPanel() {
  const { activeNoteBacklinks, activeNoteOutgoingLinks, openTab, handleWikiLinkClick, isBacklinksLoading } = useAppStore();

  const handleBacklinkClick = async (path: string) => {
    await openTab(path);
  };

  // Link de saída resolvido abre a nota; não-resolvido cria a partir do nome
  // (mesma semântica do clique no wiki-link dentro do editor)
  const handleOutgoingClick = async (link: { target_name: string; target_path: string | null }) => {
    if (link.target_path) {
      await openTab(link.target_path);
    } else {
      await handleWikiLinkClick(link.target_name);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[var(--substrate-surface)]/30 backdrop-blur-md">

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {isBacklinksLoading ? (
          /* Backlinks Loading Skeleton with ease-glow */
          <div className="space-y-3 p-1 animate-skeleton-pulse">
            <div className="glass-card p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--substrate-raised)]/50 flex flex-col gap-2">
              <div className="h-3 w-1/3 bg-[var(--border-default)] rounded" />
              <div className="h-2 w-full bg-[var(--border-default)] rounded" />
              <div className="h-2 w-5/6 bg-[var(--border-default)] rounded" />
            </div>
            <div className="glass-card p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--substrate-raised)]/50 flex flex-col gap-2">
              <div className="h-3 w-1/4 bg-[var(--border-default)] rounded" />
              <div className="h-2 w-11/12 bg-[var(--border-default)] rounded" />
            </div>
          </div>
        ) : (
          <>
            {/* Seção: referências de ENTRADA (quem aponta para esta nota) */}
            <div className="flex items-center gap-1.5 px-1 pt-0.5">
              <ArrowDownLeft className="w-3 h-3 text-[var(--text-muted)]" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Apontam para cá
              </span>
            </div>

            {activeNoteBacklinks.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] italic px-1 pb-1.5">
                Nenhuma nota aponta para esta ainda.
              </p>
            ) : (
              activeNoteBacklinks.map((backlink) => {
                // Find the target title inside the context to format it
                // We want to highlight [[Something]] or [[Something|Alias]]
                const parts = backlink.context.split(/(\[\[[^\]]+\]\])/g);

                return (
                  <button
                    key={backlink.source_path}
                    onClick={() => handleBacklinkClick(backlink.source_path)}
                    className="w-full text-left glass-card p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--substrate-raised)]/50 hover:bg-[var(--substrate-raised)]/20 transition-all duration-200 cursor-pointer flex flex-col gap-1.5 group hover:scale-[1.01]"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-[var(--text-secondary)] flex-shrink-0" />
                      <span className="text-xs font-bold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors truncate">
                        {backlink.source_title}
                      </span>
                    </div>

                    <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed font-sans line-clamp-3">
                      {parts.map((part, index) => {
                        if (part.startsWith('[[') && part.endsWith(']]')) {
                          // Extract display text if there's a pipe, e.g. [[Target|Alias]]
                          const content = part.slice(2, -2);
                          const pipeIdx = content.indexOf('|');
                          const displayText = pipeIdx !== -1 ? content.slice(pipeIdx + 1) : content;
                          return (
                            <span key={index} className="text-[var(--accent)] font-semibold">
                              {displayText}
                            </span>
                          );
                        }
                        return <span key={index}>{part}</span>;
                      })}
                    </div>
                  </button>
                );
              })
            )}

            {/* Seção: referências de SAÍDA (o que esta nota referencia) */}
            <div className="flex items-center gap-1.5 px-1 pt-2">
              <ArrowUpRight className="w-3 h-3 text-[var(--text-muted)]" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Esta nota aponta para
              </span>
            </div>

            {activeNoteOutgoingLinks.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] italic px-1">
                Esta nota não referencia nenhuma outra.
              </p>
            ) : (
              activeNoteOutgoingLinks.map((link) => {
                const isUnresolved = link.target_path === null;
                return (
                  <button
                    key={link.target_name}
                    onClick={() => handleOutgoingClick(link)}
                    title={isUnresolved ? 'Nota ainda não criada — clique para criar' : undefined}
                    className="w-full text-left glass-card p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--substrate-raised)]/50 hover:bg-[var(--substrate-raised)]/20 transition-all duration-200 cursor-pointer flex items-center gap-1.5 min-w-0 group hover:scale-[1.01]"
                  >
                    {isUnresolved ? (
                      <FilePlus className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-[var(--text-secondary)] flex-shrink-0" />
                    )}
                    <span
                      className={`text-xs font-bold truncate transition-colors group-hover:text-[var(--accent)] ${
                        isUnresolved ? 'text-[var(--text-muted)] italic' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {link.target_title ?? link.target_name}
                    </span>
                    {isUnresolved && (
                      <span className="text-[10px] text-[var(--text-muted)] italic flex-shrink-0 ml-auto">
                        criar
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
