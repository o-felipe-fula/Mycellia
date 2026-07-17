// Árvore de tags aninhadas (E2 Fatia A — Spec 28): converte a lista plana do índice
// (`a`, `a/b`, `a/b/c`) na hierarquia do painel. Pura — testada direto.
import type { TagCount } from '../store/types';

export interface TagTreeNode {
  /** último segmento (ex.: "mycellia" em projeto/mycellia) */
  name: string;
  /** caminho completo da tag (ex.: "projeto/mycellia") — é o que a busca usa */
  fullPath: string;
  /** ocorrências da tag EXATA */
  ownCount: number;
  /** ocorrências da tag + de todas as descendentes (soma de usos, não notas únicas) */
  totalCount: number;
  children: TagTreeNode[];
}

export function buildTagTree(tags: TagCount[]): TagTreeNode[] {
  const root: TagTreeNode = { name: '', fullPath: '', ownCount: 0, totalCount: 0, children: [] };
  const byPath = new Map<string, TagTreeNode>();

  const ensure = (path: string): TagTreeNode => {
    if (path === '') return root;
    const existing = byPath.get(path);
    if (existing) return existing;

    const slash = path.lastIndexOf('/');
    const parent = ensure(slash === -1 ? '' : path.slice(0, slash));
    const node: TagTreeNode = {
      name: slash === -1 ? path : path.slice(slash + 1),
      fullPath: path,
      ownCount: 0,
      totalCount: 0,
      children: [],
    };
    parent.children.push(node);
    byPath.set(path, node);
    return node;
  };

  for (const t of tags) {
    ensure(t.tag).ownCount = t.count;
  }

  const rollUp = (node: TagTreeNode): number => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.totalCount = node.ownCount + node.children.reduce((sum, child) => sum + rollUp(child), 0);
    return node.totalCount;
  };
  rollUp(root);

  return root.children;
}
