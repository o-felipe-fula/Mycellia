import { useAppStore } from '../store/appStore';
import { FileText } from 'lucide-react';

export default function BacklinksPanel() {
  const { activeNoteBacklinks, openTab, isBacklinksLoading } = useAppStore();

  const handleBacklinkClick = async (path: string) => {
    await openTab(path);
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
        ) : activeNoteBacklinks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <FileText className="w-8 h-8 text-[var(--text-muted)] opacity-50 mb-2" />
            <p className="text-xs text-[var(--text-muted)] italic">
              Nenhuma nota aponta para esta ainda.
            </p>
          </div>
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
      </div>
    </div>
  );
}
