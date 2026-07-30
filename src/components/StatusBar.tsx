import { useMemo, useState, useEffect } from 'react';
import { useAppStore, FileNode } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { Folder, Eye, EyeOff, Loader2, RefreshCw, MoveHorizontal } from 'lucide-react';

export default function StatusBar() {
  const { t } = useTranslation();
  const { currentVault, fileTree, isIndexing, indexingProgressText, isWatching, activeNoteContent, rebuildIndex, editorWideMode, toggleEditorWideMode } = useAppStore();

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
          {fileCount} {fileCount === 1 ? t('statusBar.fileSingular') : t('statusBar.filePlural')}
        </span>
      </div>

      {/* Centro: Indexação Reativa */}
      <div className="flex items-center gap-1.5">
        {isIndexing ? (
          <>
            <Loader2 className="w-3.5 h-3.5 text-[var(--accent)] animate-spin flex-shrink-0" />
            <span className="font-mono text-[var(--text-primary)] animate-pulse">
              {t('statusBar.indexing', { progress: indexingProgressText || t('statusBar.indexingStarting') })}
            </span>
          </>
        ) : (
          <button
            onClick={() => rebuildIndex()}
            title={t('statusBar.rebuildTooltip')}
            className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-[var(--substrate-raised)] cursor-pointer transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-shrink-0" />
            <span className="text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">{t('statusBar.indexUpdated')}</span>
            <RefreshCw className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </button>
        )}
      </div>

      {/* Lado Direito: Contexto Ativo (Palavras) e Status do Watcher */}
      <div className="flex items-center gap-1.5">
        {activeNoteContent !== null && (
          <>
            {/* E1 (Spec 25): toggle da largura da linha do editor (persiste no config) */}
            <button
              onClick={() => toggleEditorWideMode()}
              title={editorWideMode ? t('statusBar.wideTooltipFull') : t('statusBar.wideTooltipComfort')}
              aria-label={t('statusBar.wideAria')}
              className={`group flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[var(--substrate-raised)] cursor-pointer transition-colors ${
                editorWideMode ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <MoveHorizontal className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{editorWideMode ? t('statusBar.wideFull') : t('statusBar.wideComfort')}</span>
            </button>
            <span className="text-[var(--text-muted)]">·</span>
            <span>
              {wordCount} {wordCount === 1 ? t('statusBar.wordSingular') : t('statusBar.wordPlural')}
            </span>
            <span className="text-[var(--text-muted)]">·</span>
          </>
        )}

        <div className="flex items-center gap-1">
          {isWatching ? (
            <>
              <Eye className="w-3.5 h-3.5 text-[var(--accent)] flex-shrink-0" />
              <span className="text-[var(--text-secondary)]">{t('statusBar.watchActive')}</span>
            </>
          ) : (
            <>
              <EyeOff className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
              <span className="text-[var(--text-muted)]">{t('statusBar.watchInactive')}</span>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
