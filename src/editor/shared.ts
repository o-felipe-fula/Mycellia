// Pinos compartilhados entre os módulos do editor (F3 — Spec 17): o efeito de troca de
// tema é DISPARADO pelo observer do mermaid e CONSUMIDO pelo live preview; o DecSpec é o
// shape comum de spec de decoração das extensões. Vivem aqui, num módulo folha sem
// dependências internas, para evitar import circular entre mermaid/extensões.
import { StateEffect } from '@codemirror/state';
import type { Decoration } from '@codemirror/view';

export const themeChangeEffect = StateEffect.define<void>();

export interface DecSpec {
  from: number;
  to: number;
  dec: Decoration;
}
