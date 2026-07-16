// Extensões CodeMirror do editor (F3 — Spec 17), extraídas intactas do MarkdownEditor.tsx:
// wiki-links ([[...]] com resolução via existingNotes do store), autocomplete de wiki-link,
// live preview (headings/bold/tabelas/checkboxes/mermaid) e preview de imagens.
// Leitura-apenas do store; a escrita no documento acontece só via dispatch do editor.
import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state';
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { SyntaxNode } from '@lezer/common';
import { useAppStore } from '../store/appStore';
import { themeChangeEffect, fileTreeChangedEffect, type DecSpec } from './shared';
import { EmptyWidget, TableWidget, BulletWidget, TaskMarkerWidget, ImageWidget } from './widgets';
import { getFencedCodeContent, resolveImagePath, isInsideCodeBlock, isRangeInCode, hasChildTaskMarker } from './utils';
import { MermaidWidget } from './mermaid';
import { CalloutWidget, isCalloutSource } from './callouts';
import { collectInlineHtmlSpecs, HtmlBlockWidget, type HtmlTagRange } from './htmlPreview';

export const wikiLinkExtension = () => {
  return StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(decorations, tr) {
      decorations = decorations.map(tr.changes);
      const specs: DecSpec[] = [];
      const selection = tr.state.selection.main;

      const existingNotes = useAppStore.getState().existingNotes;
      const doc = tr.state.doc;

      for (let l = 1; l <= doc.lines; l++) {
        const line = doc.line(l);
        const regex = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;
        let match;
        while ((match = regex.exec(line.text)) !== null) {
          const start = line.from + match.index;
          const end = start + match[0].length;

          if (isRangeInCode(tr.state, start, end)) {
            continue;
          }

          // Prevent matching ![[ as a regular wiki link
          if (match.index > 0 && line.text[match.index - 1] === '!') {
            continue;
          }

          const target = match[1].trim();
          const hasAlias = !!match[2];

          const resolved = existingNotes.has(target.toLowerCase());
          const cursorNear = selection.from >= start && selection.to <= end;

          const linkClass = `cm-wiki-link ${resolved ? 'cm-wiki-link-resolved' : 'cm-wiki-link-unresolved'}`;

          if (cursorNear) {
            specs.push({
              from: start,
              to: end,
              dec: Decoration.mark({
                class: linkClass,
                attributes: { 'data-target': target },
              }),
            });
          } else {
            // Hide the opening [[
            specs.push({
              from: start,
              to: start + 2,
              dec: Decoration.replace({ widget: new EmptyWidget() }),
            });

            if (hasAlias) {
              const pipeIndex = match[0].indexOf('|');
              // Hide target and pipe
              specs.push({
                from: start + 2,
                to: start + 2 + pipeIndex,
                dec: Decoration.replace({ widget: new EmptyWidget() }),
              });
              // Color the alias
              const aliasStart = start + 2 + pipeIndex + 1;
              const aliasEnd = end - 2;
              specs.push({
                from: aliasStart,
                to: aliasEnd,
                dec: Decoration.mark({
                  class: linkClass,
                  attributes: { 'data-target': target },
                }),
              });
            } else {
              // Color the target
              specs.push({
                from: start + 2,
                to: end - 2,
                dec: Decoration.mark({
                  class: linkClass,
                  attributes: { 'data-target': target },
                }),
              });
            }

            // Hide the closing ]]
            specs.push({
              from: end - 2,
              to: end,
              dec: Decoration.replace({ widget: new EmptyWidget() }),
            });
          }
        }
      }

      specs.sort((a, b) => a.from - b.from);
      const builder = new RangeSetBuilder<Decoration>();
      let lastTo = -1;
      for (const spec of specs) {
        if (spec.from >= lastTo) {
          builder.add(spec.from, spec.to, spec.dec);
          lastTo = spec.to;
        }
      }
      return builder.finish();
    },
    provide: (f) => EditorView.decorations.from(f),
  });
};

export function wikiLinkAutocomplete(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/\[\[[^\]]*$/);
  if (!word) return null;

  const prefix = word.text.slice(2).toLowerCase();
  const existingNotes = useAppStore.getState().existingNotes;

  const options = Array.from(existingNotes.keys())
    .filter((key) => !key.includes('/') && key.startsWith(prefix))
    .map((key) => {
      const fullPath = existingNotes.get(key)!;
      const baseWithExt = fullPath.split('\\').pop()?.split('/').pop() || '';
      const name = baseWithExt.endsWith('.md') ? baseWithExt.slice(0, -3) : baseWithExt;
      return {
        label: name,
        type: 'text',
        apply: name + ']]',
      };
    });

  return {
    from: word.from + 2,
    options,
  };
}

export const livePreviewExtension = () => {
  const buildDecorations = (state: EditorState, activeLineNumber: number): DecorationSet => {
    const specs: DecSpec[] = [];
    const htmlTags: HtmlTagRange[] = []; // tags inline coletadas pro pareamento (E1)
    ensureSyntaxTree(state, state.doc.length, 50);

    // 1. Processa Árvore de Sintaxe do Lezer
    syntaxTree(state).iterate({
      enter(node) {
        const nodeName = node.name;
        const nodeLine = state.doc.lineAt(node.from).number;

        if (nodeName === 'FencedCode') {
          let isMermaid = false;
          let child = node.node.firstChild;
          while (child) {
            if (child.name === 'CodeInfo') {
              const lang = state.doc.sliceString(child.from, child.to).trim().toLowerCase();
              if (lang === 'mermaid') {
                isMermaid = true;
              }
              break;
            }
            child = child.nextSibling;
          }

          if (isMermaid) {
            const startLine = state.doc.lineAt(node.from).number;
            const endLine = state.doc.lineAt(node.to).number;
            if (activeLineNumber >= startLine && activeLineNumber <= endLine) {
              return true;
            }
            const rawText = state.doc.sliceString(node.from, node.to);
            const diagramCode = getFencedCodeContent(rawText);
            specs.push({
              from: node.from,
              to: node.to,
              dec: Decoration.replace({
                widget: new MermaidWidget(diagramCode),
              }),
            });
            return true;
          }
        }

        // Callout Obsidian (E1 — Spec 25): `> [!tipo]` vira cartão fora do cursor.
        // Blockquote comum segue o fluxo atual (QuoteMark oculto linha a linha).
        if (nodeName === 'Blockquote') {
          const rawText = state.doc.sliceString(node.from, node.to);
          if (isCalloutSource(rawText)) {
            const startLine = state.doc.lineAt(node.from).number;
            const endLine = state.doc.lineAt(node.to).number;
            if (activeLineNumber >= startLine && activeLineNumber <= endLine) {
              return true;
            }
            specs.push({
              from: node.from,
              to: node.to,
              dec: Decoration.replace({
                widget: new CalloutWidget(rawText),
              }),
            });
            return false;
          }
          return true;
        }

        // HTML no live preview (E1 — Spec 25): bloco vira widget sanitizado; tag inline
        // é coletada pro pareamento pós-iteração; comentários HTML somem fora do cursor.
        if (nodeName === 'HTMLBlock') {
          const startLine = state.doc.lineAt(node.from).number;
          const endLine = state.doc.lineAt(node.to).number;
          if (activeLineNumber >= startLine && activeLineNumber <= endLine) {
            return true;
          }
          const rawText = state.doc.sliceString(node.from, node.to);
          specs.push({
            from: node.from,
            to: node.to,
            dec: Decoration.replace({
              widget: new HtmlBlockWidget(rawText),
            }),
          });
          return false;
        }

        if (nodeName === 'HTMLTag') {
          htmlTags.push({ from: node.from, to: node.to });
          return true;
        }

        if (nodeName === 'Comment' || nodeName === 'CommentBlock') {
          const startLine = state.doc.lineAt(node.from).number;
          const endLine = state.doc.lineAt(node.to).number;
          if (activeLineNumber >= startLine && activeLineNumber <= endLine) {
            return true;
          }
          specs.push({
            from: node.from,
            to: node.to,
            dec: Decoration.replace({ widget: new EmptyWidget() }),
          });
          return false;
        }

        if (nodeName === 'Table') {
          const startLine = state.doc.lineAt(node.from).number;
          const endLine = state.doc.lineAt(node.to).number;
          if (activeLineNumber >= startLine && activeLineNumber <= endLine) {
            return true;
          }
          const rawText = state.doc.sliceString(node.from, node.to);
          specs.push({
            from: node.from,
            to: node.to,
            dec: Decoration.replace({
              widget: new TableWidget(rawText),
            }),
          });
          return true;
        }

        if (nodeName === 'TaskMarker') {
          if (nodeLine === activeLineNumber) {
            return true;
          }
          const rawText = state.doc.sliceString(node.from, node.to);
          const checked = rawText.toLowerCase().includes('x');
          specs.push({
            from: node.from,
            to: node.to,
            dec: Decoration.replace({
              widget: new TaskMarkerWidget(checked),
            }),
          });
          return true;
        }

        if (
          nodeName === 'HeaderMark' ||
          nodeName === 'EmphasisMark' ||
          nodeName === 'LinkMark' ||
          nodeName === 'CodeMark' ||
          nodeName === 'QuoteMark' ||
          nodeName === 'ListMark' ||
          nodeName === 'StrikethroughMark'
        ) {
          if (nodeLine === activeLineNumber) {
            return true;
          }

          // Skip applying EmptyWidget inside Image nodes to prevent overlapping replacement decorations
          let curr: SyntaxNode | null = node.node;
          let insideImage = false;
          while (curr) {
            if (curr.name === 'Image') {
              insideImage = true;
              break;
            }
            curr = curr.parent;
          }
          if (insideImage) {
            return true;
          }

          let toPos = node.to;
          if (nodeName === 'HeaderMark' || nodeName === 'QuoteMark' || nodeName === 'ListMark') {
            const nextChar = state.doc.sliceString(node.to, node.to + 1);
            if (nextChar === ' ') {
              toPos = node.to + 1;
            }
          }

          if (nodeName === 'ListMark') {
            const listMarkText = state.doc.sliceString(node.from, node.to);
            const isBullet = listMarkText === '-' || listMarkText === '*' || listMarkText === '+';
            if (isBullet) {
              let hasTaskMarker = false;
              const parent = node.node.parent;
              if (parent && parent.name === 'ListItem') {
                hasTaskMarker = hasChildTaskMarker(parent);
              }

              specs.push({
                from: node.from,
                to: toPos,
                dec: Decoration.replace({
                  widget: hasTaskMarker ? new EmptyWidget() : new BulletWidget(),
                }),
              });
              return true;
            } else {
              return true;
            }
          }

          specs.push({
            from: node.from,
            to: toPos,
            dec: Decoration.replace({
              widget: new EmptyWidget(),
            }),
          });
        }
        return true;
      },
    });

    // Pareamento das tags HTML inline coletadas (E1 — Spec 25)
    specs.push(...collectInlineHtmlSpecs(state, activeLineNumber, htmlTags));

    // Ordena por ordem de início e adiciona síncrono no RangeSetBuilder
    specs.sort((a, b) => a.from - b.from);
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

  return StateField.define<DecorationSet>({
    create(state) {
      const selection = state.selection.main;
      const activeLineNumber = state.doc.lineAt(selection.head).number;
      return buildDecorations(state, activeLineNumber);
    },
    update(decorations, tr) {
      decorations = decorations.map(tr.changes);
      const themeChanged = tr.effects.some(e => e.is(themeChangeEffect));
      // E1 (Spec 25): o parser do Lezer continua em background depois do mount (o
      // ensureSyntaxTree de 50ms pode devolver árvore PARCIAL em doc grande/carga alta).
      // Quando o parse avança, o CM despacha transação com árvore nova — sem este
      // gatilho, nós que só apareceram no parse completo (Blockquote/HTMLBlock/Table)
      // ficariam sem decoração até a primeira interação do usuário.
      const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
      if (tr.docChanged || treeChanged || !tr.state.selection.eq(tr.startState.selection) || themeChanged) {
        const selection = tr.state.selection.main;
        const activeLineNumber = tr.state.doc.lineAt(selection.head).number;
        return buildDecorations(tr.state, activeLineNumber);
      }
      return decorations;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
};

export const imagePreviewExtension = () => {
  const buildDecorations = (state: EditorState): DecorationSet => {
    // BUG-04 (fix): lê o estado VIVO do store a cada rebuild. Antes capturava
    // fileTree/paths do momento em que o editor montou (deps [activeTab]) e ficava
    // cego a imagens novas (ex.: recém-coladas) até reabrir a nota.
    const { activeTab: activeNotePath, currentVault: vaultPath, fileTree } = useAppStore.getState();
    const specs: DecSpec[] = [];
    const selection = state.selection.main;
    const activeLineNumber = state.doc.lineAt(selection.head).number;
    const doc = state.doc;

    for (let l = 1; l <= doc.lines; l++) {
      if (l === activeLineNumber) {
        continue;
      }
      const line = doc.line(l);

      // Match standard markdown image: ![alt](src)
      const mdImageRegex = /!\[(.*?)\]\((.*?)\)/g;
      let mdMatch;
      while ((mdMatch = mdImageRegex.exec(line.text)) !== null) {
        const start = line.from + mdMatch.index;
        const end = start + mdMatch[0].length;

        if (isInsideCodeBlock(state, start)) {
          continue;
        }

        const alt = mdMatch[1];
        const src = mdMatch[2];
        const { url: resolvedSrc, exists } = resolveImagePath(src, activeNotePath, vaultPath, fileTree);

        specs.push({
          from: start,
          to: end,
          dec: Decoration.replace({
            widget: new ImageWidget(resolvedSrc, alt, exists),
          }),
        });
      }

      // Match wiki-link image: ![[filename|alias]] or ![[filename]]
      const wikiImageRegex = /!\[\[(.*?)(?:\|(.*?))?\]\]/g;
      let wikiMatch;
      while ((wikiMatch = wikiImageRegex.exec(line.text)) !== null) {
        const start = line.from + wikiMatch.index;
        const end = start + wikiMatch[0].length;

        if (isInsideCodeBlock(state, start)) {
          continue;
        }

        const filename = wikiMatch[1];
        const { url: resolvedSrc, exists } = resolveImagePath(filename, activeNotePath, vaultPath, fileTree);

        specs.push({
          from: start,
          to: end,
          dec: Decoration.replace({
            widget: new ImageWidget(resolvedSrc, filename, exists),
          }),
        });
      }
    }

    specs.sort((a, b) => a.from - b.from);
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

  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state);
    },
    update(decorations, tr) {
      decorations = decorations.map(tr.changes);
      // BUG-04: o MarkdownEditor dispara fileTreeChangedEffect quando a árvore muda
      const treeChanged = tr.effects.some(e => e.is(fileTreeChangedEffect));
      if (tr.docChanged || !tr.state.selection.eq(tr.startState.selection) || treeChanged) {
        return buildDecorations(tr.state);
      }
      return decorations;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
};
