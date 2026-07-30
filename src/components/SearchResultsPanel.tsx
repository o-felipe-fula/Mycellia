import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { FileText } from 'lucide-react';

interface SafeSnippetProps {
  snippet: string;
}

export const SafeSnippet: React.FC<SafeSnippetProps> = ({ snippet }) => {
  const parts = useMemo(() => {
    if (!snippet) return [];
    // Split by FTS5 match tags <b> and </b>
    return snippet.split(/(<b>.*?<\/b>)/g);
  }, [snippet]);

  return (
    <span className="text-[11px] text-[var(--text-secondary)] leading-snug">
      {parts.map((part, index) => {
        if (part.startsWith('<b>') && part.endsWith('</b>')) {
          const text = part.slice(3, -4);
          return (
            <mark
              key={index}
              className="bg-[var(--accent-muted)] text-[var(--accent-bright)] font-semibold px-0.5 rounded-xs"
            >
              {text}
            </mark>
          );
        }
        return part;
      })}
    </span>
  );
};

interface SearchResultsPanelProps {
  onItemClick?: (path: string) => void;
  inline?: boolean;
}

export const SearchResultsPanel: React.FC<SearchResultsPanelProps> = ({ onItemClick, inline }) => {
  const { t } = useTranslation();
  const {
    searchResults,
    graphSearchQuery,
    isSearching,
    openTab,
  } = useAppStore();

  const handleItemClick = (path: string) => {
    openTab(path);
    if (onItemClick) {
      onItemClick(path);
    }
  };

  if (!graphSearchQuery.trim()) {
    return null;
  }

  return (
    <div 
      className={inline
        ? "w-full h-full flex flex-col focus:outline-none"
        : "w-full flex flex-col rounded-lg border border-[var(--border-strong)] bg-[var(--substrate-overlay)] p-2 shadow-[0_8px_24px_rgba(0,0,0,0.14)] focus:outline-none transition-all duration-300"
      }
      style={inline ? undefined : {
        maxHeight: '320px',
      }}
    >
      {isSearching && searchResults.length === 0 ? (
        /* Search Loading Skeleton with ease-glow */
        <div className="space-y-3 p-2 animate-skeleton-pulse">
          <div className="flex flex-col gap-2 p-2 rounded-md bg-[var(--substrate-raised)]/30 border border-transparent">
            <div className="h-3 w-1/4 bg-[var(--border-default)] rounded" />
            <div className="h-2 w-full bg-[var(--border-default)] rounded" />
          </div>
          <div className="flex flex-col gap-2 p-2 rounded-md bg-[var(--substrate-raised)]/30 border border-transparent">
            <div className="h-3 w-1/3 bg-[var(--border-default)] rounded" />
            <div className="h-2 w-5/6 bg-[var(--border-default)] rounded" />
          </div>
        </div>
      ) : searchResults.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 px-4 text-center font-sans">
          <span className="text-xs text-[var(--text-muted)]">
            {t('search.noResults', { query: graphSearchQuery })}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto custom-scrollbar pr-1">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold border-b border-[var(--border-strong)]/40 mb-1">
            {t('search.results', { total: searchResults.length })}
          </div>
          {searchResults.map((result) => (
            <button
              key={result.path}
              onClick={() => handleItemClick(result.path)}
              className="flex flex-col gap-1 p-2 rounded-md hover:bg-[var(--substrate-raised)] transition-colors text-left group border border-transparent hover:border-[var(--accent-dim)]/20"
            >
              <div className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-[var(--accent-dim)] group-hover:text-[var(--accent)] transition-colors shrink-0" />
                <span className="text-xs font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-bright)] transition-colors truncate">
                  {result.title}
                </span>
              </div>
              <SafeSnippet snippet={result.snippet} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
