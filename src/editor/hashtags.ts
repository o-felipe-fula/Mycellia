// #tags clicáveis no editor (E2 Fatia A — Spec 28): decoração de chip + data-tag; o
// clique é tratado no MarkdownEditor (mesmo canal dos wiki-links) e vira busca `#tag`.
// ⚠️ O charset ESPELHA o parser Rust (extract_tags_from_raw): boundary = início de
// linha ou whitespace; 1º char [A-Za-z_]; resto [A-Za-z0-9_/-]. Divergência = bug —
// os testes dos dois lados usam os MESMOS casos.
import { RangeSetBuilder, StateField } from '@codemirror/state';
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { isRangeInCode } from './utils';
import type { DecSpec } from './shared';

export const HASHTAG_RE = /(^|\s)#([A-Za-z_][A-Za-z0-9_/-]*)/g;

// E2 Fatia D (polish do Review Gate): âncora de bloco ` ^id` no fim da linha fica
// DISCRETA no preview (é endereço, não conteúdo — padrão Obsidian)
const BLOCK_ANCHOR_RE = /\s(\^[A-Za-z0-9-]+)\s*$/;

const buildDecorations = (state: EditorState): DecorationSet => {
  const specs: DecSpec[] = [];
  const doc = state.doc;

  for (let l = 1; l <= doc.lines; l++) {
    const line = doc.line(l);
    HASHTAG_RE.lastIndex = 0;
    let match;
    while ((match = HASHTAG_RE.exec(line.text)) !== null) {
      const start = line.from + match.index + match[1].length; // no '#'
      const end = start + 1 + match[2].length;

      if (isRangeInCode(state, start, end)) {
        continue;
      }

      specs.push({
        from: start,
        to: end,
        dec: Decoration.mark({
          class: 'cm-hashtag',
          attributes: { 'data-tag': match[2] },
        }),
      });
    }

    const anchorMatch = line.text.match(BLOCK_ANCHOR_RE);
    if (anchorMatch && anchorMatch.index !== undefined) {
      const anchorStart = line.from + anchorMatch.index + 1; // depois do espaço
      const anchorEnd = anchorStart + anchorMatch[1].length;
      if (!isRangeInCode(state, anchorStart, anchorEnd)) {
        specs.push({
          from: anchorStart,
          to: anchorEnd,
          dec: Decoration.mark({ class: 'cm-block-anchor' }),
        });
      }
    }
  }

  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const spec of specs) {
    if (spec.from >= lastTo) {
      builder.add(spec.from, spec.to, spec.dec);
      lastTo = spec.to;
    }
  }
  return builder.finish();
};

export const hashtagExtension = () =>
  StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state);
    },
    // Rebuild a cada transação (mesmo padrão do wikiLinkExtension: passada de regex
    // barata; também se auto-corrige quando o parse de código avança)
    update(_decorations, tr) {
      return buildDecorations(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
