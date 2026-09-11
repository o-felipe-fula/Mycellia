// Painel de tags (E2 Fatia A — Spec 28): árvore aninhada com contagem; clicar numa tag
// dispara a busca `#tag` — que reusa TODO o pipeline (resultados no painel esquerdo +
// grafo acendendo os matches). Dados direto do índice via get_all_tags (estado local).
import { useCallback, useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, ChevronRight, Hash, RefreshCw } from 'lucide-react';
import { useAppStore, TagCount } from '../store/appStore';
import { buildTagTree, TagTreeNode } from '../utils/tagTree';

export default function TagsPanel() {
  const { t } = useTranslation();
  const { isIndexing, setLeftPanelMode, setGraphSearchQuery } = useAppStore();
  const [tags, setTags] = useState<TagCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const loadTags = useCallback(async () => {
    try {
      const result = await invoke<TagCount[]>('get_all_tags');
      setTags(result);
    } catch (e) {
      console.error('Failed to load tags:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Carrega ao montar e recarrega quando uma indexação termina (isIndexing true→false)
  useEffect(() => {
    if (!isIndexing) {
      loadTags();
    }
  }, [isIndexing, loadTags]);

  const handleTagClick = (fullPath: string) => {
    setLeftPanelMode('search');
    setGraphSearchQuery(`#${fullPath}`);
  };

  const renderNode = (node: TagTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded[node.fullPath] ?? false;

    return (
      <div key={node.fullPath} className="flex flex-col">
        <div
          className="group flex items-center gap-1 rounded px-1.5 py-1 hover:bg-[var(--substrate-raised)] transition-colors cursor-pointer select-none"
          style={{ paddingLeft: `${6 + depth * 14}px` }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((prev) => ({ ...prev, [node.fullPath]: !isOpen }));
              }}
              aria-label={isOpen ? t('tags.collapse') : t('tags.expand')}
              className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <span className="w-3.5 flex-shrink-0" />
          )}

          <button
            onClick={() => handleTagClick(node.fullPath)}
            title={`Buscar #${node.fullPath}`}
            className="flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer"
          >
            <Hash className="w-3 h-3 flex-shrink-0 text-[var(--tag)]" />
            <span className="truncate text-sm text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
              {node.name}
            </span>
            <span className="ml-auto flex-shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--tag-muted)] text-[var(--tag)]">
              {node.totalCount}
            </span>
          </button>
        </div>

        {hasChildren && isOpen && (
          <div className="flex flex-col">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const tree = buildTagTree(tags);

  return (
    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] p-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>{t('tags.loading')}</span>
        </div>
      ) : tree.length === 0 ? (
        <div className="text-xs text-[var(--text-muted)] p-3 leading-relaxed">
          <Trans
            i18nKey="tags.empty"
            components={{
              tag: <span className="font-mono text-[var(--tag)]" />,
              mono: <span className="font-mono" />,
            }}
          />
        </div>
      ) : (
        tree.map((node) => renderNode(node, 0))
      )}
    </div>
  );
}
