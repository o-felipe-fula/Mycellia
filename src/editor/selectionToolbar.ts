// Toolbar flutuante de seleção (E1.5 — Spec 26): selecionou texto → bolha acima da
// seleção com formatações de um clique. A UI digita a sintaxe pelo usuário; toda mutação
// é `view.dispatch({changes})` no buffer (byte-a-byte, mesmo canal do TaskMarker).
// Nada de save aqui — o autosave existente cuida do resto.
import { EditorView, showTooltip, type Tooltip } from '@codemirror/view';
import i18n from '../i18n';
import { StateField, type EditorState } from '@codemirror/state';

// ---------------------------------------------------------------------------
// Ações de formatação
// ---------------------------------------------------------------------------

// Toggle inline: remove o par se já está aplicado (fora OU dentro da seleção), senão embrulha.
export function toggleInline(view: EditorView, before: string, after: string) {
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  const text = view.state.sliceDoc(from, to);
  const pre = view.state.sliceDoc(Math.max(0, from - before.length), from);
  const post = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + after.length));

  if (pre === before && post === after) {
    // Par imediatamente em volta da seleção → remove
    view.dispatch({
      changes: [
        { from: from - before.length, to: from, insert: '' },
        { from: to, to: to + after.length, insert: '' },
      ],
      selection: { anchor: from - before.length, head: to - before.length },
    });
  } else if (
    text.startsWith(before) &&
    text.endsWith(after) &&
    text.length >= before.length + after.length
  ) {
    // Par dentro da seleção → remove
    const inner = text.slice(before.length, text.length - after.length);
    view.dispatch({
      changes: { from, to, insert: inner },
      selection: { anchor: from, head: from + inner.length },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: before + text + after },
      selection: { anchor: from + before.length, head: from + before.length + text.length },
    });
  }
  view.focus();
}

// Citação: prefixa cada linha da seleção com `> ` (ou remove, se todas já têm).
export function toggleQuote(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const firstLine = view.state.doc.lineAt(from);
  const lastLine = view.state.doc.lineAt(to);

  const lines: { from: number; text: string }[] = [];
  for (let n = firstLine.number; n <= lastLine.number; n++) {
    const line = view.state.doc.line(n);
    lines.push({ from: line.from, text: line.text });
  }

  const allQuoted = lines.every((l) => /^\s*>/.test(l.text));
  const changes = lines.map((l) => {
    if (allQuoted) {
      const match = l.text.match(/^(\s*)>\s?/);
      return { from: l.from + (match ? match[1].length : 0), to: l.from + (match ? match[0].length : 0), insert: '' };
    }
    return { from: l.from, to: l.from, insert: '> ' };
  });

  view.dispatch({ changes });
  view.focus();
}

// Callout: seleção vira corpo de um `> [!note]` novo; cursor fica no título pra digitar.
export function toCallout(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const firstLine = view.state.doc.lineAt(from);
  const lastLine = view.state.doc.lineAt(to);

  const bodyLines: string[] = [];
  for (let n = firstLine.number; n <= lastLine.number; n++) {
    bodyLines.push(`> ${view.state.doc.line(n).text}`);
  }

  const header = '> [!note] ';
  const replacement = `${header}\n${bodyLines.join('\n')}`;
  view.dispatch({
    changes: { from: firstLine.from, to: lastLine.to, insert: replacement },
    selection: { anchor: firstLine.from + header.length },
  });
  view.focus();
}

// ---------------------------------------------------------------------------
// A bolha (Tooltip API do CM6)
// ---------------------------------------------------------------------------

interface ToolbarAction {
  glyph: string;
  title: string;
  className?: string;
  run: (view: EditorView) => void;
}

const ACTIONS: ToolbarAction[] = [
  { glyph: 'B', title: 'toolbar.bold', className: 'is-bold', run: (v) => toggleInline(v, '**', '**') },
  { glyph: 'I', title: 'toolbar.italic', className: 'is-italic', run: (v) => toggleInline(v, '*', '*') },
  { glyph: 'S', title: 'toolbar.strike', className: 'is-strike', run: (v) => toggleInline(v, '~~', '~~') },
  { glyph: 'H', title: 'toolbar.highlight', className: 'is-mark', run: (v) => toggleInline(v, '<mark>', '</mark>') },
  { glyph: 'U', title: 'toolbar.underline', className: 'is-underline', run: (v) => toggleInline(v, '<u>', '</u>') },
  { glyph: '<>', title: 'toolbar.inlineCode', className: 'is-code', run: (v) => toggleInline(v, '`', '`') },
  { glyph: '[[]]', title: 'toolbar.wikiLink', className: 'is-code', run: (v) => toggleInline(v, '[[', ']]') },
  { glyph: '❝', title: 'toolbar.quote', run: toggleQuote },
  { glyph: '◧', title: 'toolbar.toCallout', run: toCallout },
];

function buildToolbarDom(view: EditorView): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'mycellia-seltoolbar';

  for (const action of ACTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.glyph;
    // D0 (Spec 33): title guarda a CHAVE; traduz no build do DOM (toolbar nasce por seleção)
    btn.title = i18n.t(action.title);
    btn.setAttribute('aria-label', i18n.t(action.title));
    if (action.className) btn.classList.add(action.className);
    // mousedown + preventDefault: o clique NÃO pode roubar a seleção do editor
    btn.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      action.run(view);
    });
    dom.appendChild(btn);
  }

  return dom;
}

function getSelectionToolbar(state: EditorState): readonly Tooltip[] {
  const sel = state.selection.main;
  if (sel.empty) return [];
  return [
    {
      pos: Math.min(sel.from, sel.to),
      above: true,
      strictSide: false,
      arrow: false,
      create: (view: EditorView) => ({ dom: buildToolbarDom(view), offset: { x: 0, y: 6 } }),
    },
  ];
}

const selectionToolbarField = StateField.define<readonly Tooltip[]>({
  create: getSelectionToolbar,
  update(tooltips, tr) {
    if (!tr.docChanged && tr.startState.selection.eq(tr.state.selection)) return tooltips;
    return getSelectionToolbar(tr.state);
  },
  provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
});

export const selectionToolbar = () => selectionToolbarField;
