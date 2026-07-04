// Tema visual do editor (F3 — Spec 17): tokens do Design System aplicados ao CodeMirror.
// Estático e sem dependências de runtime — extraído intacto do MarkdownEditor.tsx.
import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export const mycelliaHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, class: 'cm-heading-1' },
  { tag: tags.heading2, class: 'cm-heading-2' },
  { tag: tags.heading3, class: 'cm-heading-3' },
  { tag: tags.heading4, class: 'cm-heading-4' },
  { tag: tags.heading5, class: 'cm-heading-5' },
  { tag: tags.heading6, class: 'cm-heading-6' },
  { tag: tags.strong, class: 'cm-strong' },
  { tag: tags.emphasis, class: 'cm-em' },
  { tag: tags.strikethrough, class: 'cm-strikethrough' },
  { tag: tags.monospace, class: 'cm-inline-code' },
]);

export const mycelliaTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-sans)',
      lineHeight: '1.6',
      overflowX: 'hidden !important',
    },
    '.cm-inline-code, .cm-fenced-code, .cm-code-block, .cm-math, .cm-special-char': {
      fontFamily: 'var(--font-mono) !important',
    },
    '.cm-content': {
      padding: '10px 0',
      color: 'var(--text-primary)',
      whiteSpace: 'pre-wrap !important',
      wordBreak: 'break-word !important',
    },
    '.cm-line': {
      padding: '0 4px',
      wordBreak: 'break-word !important',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: 'var(--accent)',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      borderRight: 'none',
      color: 'var(--text-muted)',
    },
    '.cm-heading-1': { fontSize: '1.8em', fontWeight: 'bold' },
    '.cm-heading-2': { fontSize: '1.5em', fontWeight: 'bold' },
    '.cm-heading-3': { fontSize: '1.25em', fontWeight: 'bold' },
    '.cm-heading-4': { fontSize: '1.15em', fontWeight: 'bold' },
    '.cm-heading-5': { fontSize: '1.05em', fontWeight: 'bold' },
    '.cm-heading-6': { fontSize: '1em', fontWeight: 'bold' },
    '.cm-strong': { fontWeight: 'bold' },
    '.cm-em': { fontStyle: 'italic' },
    '.cm-strikethrough': { textDecoration: 'line-through', color: 'var(--text-faint)' },
    '.cm-task-marker-box': {
      width: '14px',
      height: '14px',
      border: '1px solid var(--border-strong)',
      borderRadius: '3px',
      display: 'inline-block',
      position: 'relative',
      verticalAlign: 'middle',
      backgroundColor: 'transparent',
      cursor: 'pointer',
      transition: 'all 0.11s cubic-bezier(0.2, 0, 0, 1)',
    },
    '.cm-task-marker-box:hover': {
      borderColor: 'var(--accent)',
      backgroundColor: 'var(--substrate-raised)',
    },
    '.cm-task-marker-box.checked': {
      backgroundColor: 'var(--accent)',
      borderColor: 'var(--accent)',
    },
    '.cm-task-marker-box.checked:hover': {
      backgroundColor: 'var(--accent-bright)',
      borderColor: 'var(--accent-bright)',
    },
  },
  { dark: true },
);
