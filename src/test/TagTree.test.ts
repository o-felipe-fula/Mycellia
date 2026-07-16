// E2 Fatia A (Spec 28) — árvore de tags aninhadas: lista plana do índice vira hierarquia
import { describe, it, expect } from 'vitest';
import { buildTagTree } from '../utils/tagTree';

describe('buildTagTree', () => {
  it('monta hierarquia aninhada a partir de caminhos planos', () => {
    const tree = buildTagTree([
      { tag: 'projeto', count: 1 },
      { tag: 'projeto/mycellia', count: 2 },
      { tag: 'projeto/kingstar', count: 3 },
      { tag: 'foco', count: 5 },
    ]);

    expect(tree.map((n) => n.name)).toEqual(['foco', 'projeto']);
    const projeto = tree[1];
    expect(projeto.children.map((c) => c.name)).toEqual(['kingstar', 'mycellia']);
    expect(projeto.children[1].fullPath).toBe('projeto/mycellia');
  });

  it('agrega contagens: pai soma as próprias ocorrências + descendentes', () => {
    const tree = buildTagTree([
      { tag: 'a', count: 1 },
      { tag: 'a/b', count: 2 },
      { tag: 'a/b/c', count: 4 },
    ]);

    const a = tree[0];
    expect(a.ownCount).toBe(1);
    expect(a.totalCount).toBe(7); // 1 + 2 + 4
    expect(a.children[0].totalCount).toBe(6); // 2 + 4
  });

  it('cria nós intermediários fantasma quando só a folha existe (a/b/c sem a)', () => {
    const tree = buildTagTree([{ tag: 'x/y/z', count: 3 }]);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('x');
    expect(tree[0].ownCount).toBe(0);
    expect(tree[0].totalCount).toBe(3);
    expect(tree[0].children[0].children[0].fullPath).toBe('x/y/z');
  });

  it('lista vazia → árvore vazia', () => {
    expect(buildTagTree([])).toEqual([]);
  });
});
