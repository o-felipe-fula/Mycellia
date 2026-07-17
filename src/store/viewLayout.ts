// Regra de coerência centro/direita (F3 — Spec 17): extraída intacta do appStore.ts.
// Compartilhada entre as ações de abas (core do appStore) e o layoutSlice — vive num
// módulo folha para evitar import circular entre os dois.
export const ensureDifferentViews = (
  center: 'editor' | 'graph',
  right: 'backlinks' | 'graph' | 'editor' | 'tags'
): {
  centerView: 'editor' | 'graph';
  rightView: 'backlinks' | 'graph' | 'editor' | 'tags';
} => {
  let nextRight = right;
  if (center === 'editor' && right === 'editor') {
    nextRight = 'graph';
  } else if (center === 'graph' && right === 'graph') {
    nextRight = 'editor';
  }
  return { centerView: center, rightView: nextRight };
};
