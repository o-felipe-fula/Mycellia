import { useMemo, useState, useEffect } from 'react';
import { useAppStore, FileNode } from '../store/appStore';
import { Folder, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';

export default function StatusBar() {
  const { currentVault, fileTree, isIndexing, indexingProgressText, isWatching, activeNoteContent, rebuildIndex } = useAppStore();

  // Contagem de arquivos: memoizado sobre fileTree para evitar varredura a cada render
  const fileCount = useMemo(() => {
    const countFiles = (node: FileNode | null): number => {
      if (!node) return 0;
      if (!node.is_dir) return 1;
      let count = 0;
      if (node.children) {
        for (const child of node.children) {
          count += countFiles(child);
        }
      }
      return count;
    };
    return countFiles(fileTree);
  }, [fileTree]);

  // Contagem de palavras com debounce local de 300ms para evitar lags de digitação em notas grandes
  const [wordCount, setWordCount] = useState(0);

  useEffect(() => {
    if (!activeNoteContent) {
      setWordCount(0);
      return;
    }

    const handler = setTimeout(() => {
      const clean = activeNoteContent.trim();
      const count = clean ? clean.split(/\s+/).filter(Boolean).length : 0;
      setWordCount(count);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [activeNoteContent]);

  // Basename do vault ativo
  const vaultName = useMemo(() => {
    if (!currentVault) return '';
    return currentVault.split('\\').pop()?.split('/').pop() || currentVault;
  }, [currentVault]);

  if (!currentVault) return null;

  return (
    <footer className="h-[26px] bg-[var(--substrate-base)] border-t border-[var(--border-subtle)] text-[var(--text-secondary)] text-xs flex items-center justify-between px-3 select-none flex-shrink-0">
      {/* Lado Esquerdo: Vault e Contagem de Arquivos */}
      <div className="flex items-center gap-1.5 min-w-0">
        <Folder className="w-3.5 h-3.5 text-[var(--accent)] flex-shrink-0" />
        <span className="truncate font-medium text-[var(--text-primary)]" title={currentVault}>
          {vaultName}
        </span>
        <span className="text-[var(--text-muted)]">·</span>
        <span>
          {fileCount} {fileCount === 1 ? 'arquivo' : 'arquivos'}
        </span>
      </div>

      {/* Centro: Indexação Reativa */}
      <div className="flex items-center gap-1.5">
        {isIndexing ? (
          <>
            <Loader2 className="w-3.5 h-3.5 text-[var(--accent)] animate-spin flex-shrink-0" />
            <span className="font-mono text-[var(--text-primary)] animate-pulse">
              Indexando ({indexingProgressText || 'iniciando'})…
            </span>
          </>
        ) : (
          <button
            onClick={() => rebuildIndex()}
            title="Reconstruir índice — re-lê todas as notas (necessário para a busca enxergar o frontmatter de notas já existentes)"
            className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-[var(--substrate-raised)] cursor-pointer transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-shrink-0" />
            <span className="text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">Índice atualizado</span>
            <RefreshCw className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </button>
        )}
      </div>

      {/* Lado Direito: Contexto Ativo (Palavras) e Status do Watcher */}
      <div className="flex items-center gap-1.5">
        {activeNoteContent !== null && (
          <>
            <span>
              {wordCount} {wordCount === 1 ? 'palavra' : 'palavras'}
            </span>
            <span className="text-[var(--text-muted)]">·</span>
          </>
        )}

        <div className="flex items-center gap-1">
          {isWatching ? (
            <>
              <Eye className="w-3.5 h-3.5 text-[var(--accent)] flex-shrink-0" />
              <span className="text-[var(--text-secondary)]">Watch ativo</span>
            </>
          ) : (
            <>
              <EyeOff className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
              <span className="text-[var(--text-muted)]">Watch inativo</span>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
