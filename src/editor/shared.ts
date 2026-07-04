// Pinos compartilhados entre os módulos do editor (F3 — Spec 17): o efeito de troca de
// tema é DISPARADO pelo observer do mermaid e CONSUMIDO pelo live preview; o DecSpec é o
// shape comum de spec de decoração das extensões. Vivem aqui, num módulo folha sem
// dependências internas, para evitar import circular entre mermaid/extensões.
import { StateEffect } from '@codemirror/state';
import type { Decoration } from '@codemirror/view';

export const themeChangeEffect = StateEffect.define<void>();

// BUG-04 (fix): disparado pelo MarkdownEditor quando o fileTree do vault muda; o
// imagePreviewExtension escuta e re-resolve — imagem recém-colada/criada aparece
// sem precisar reabrir a nota.
export const fileTreeChangedEffect = StateEffect.define<void>();

export interface DecSpec {
  from: number;
  to: number;
  dec: Decoration;
}
