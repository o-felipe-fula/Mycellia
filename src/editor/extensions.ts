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
import { EmptyWidget, TableWidget, BulletWidget, TaskMarkerWidget, ImageWidget, WikiLinkSepWidget } from './widgets';
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

          // E2 Fatia B (Spec 28): `Nota#Título` resolve pela NOTA; o heading não
          // invalida o link. `[[#Título]]` (mesma nota) é sempre resolvido.
          const hashInTarget = target.indexOf('#');
          const noteName = hashInTarget === -1 ? target : target.slice(0, hashInTarget).trim();
          const resolved = noteName === '' ? true : existingNotes.has(noteName.toLowerCase());
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
            } else if (hashInTarget !== -1) {
              // E2 Fatia B: `Nota#Título` exibe `Nota › Título` — o '#' vira o
              // separador visual; nota e heading recebem o mark clicável
              const rawHashIdx = match[1].indexOf('#');
              const hashPos = start + 2 + rawHashIdx;
              if (hashPos > start + 2) {
                specs.push({
                  from: start + 2,
                  to: hashPos,
                  dec: Decoration.mark({
                    class: linkClass,
                    attributes: { 'data-target': target },
                  }),
                });
              }
              specs.push({
                from: hashPos,
                to: hashPos + 1,
                dec: Decoration.replace({ widget: new WikiLinkSepWidget() }),
              });
              if (hashPos + 1 < end - 2) {
                specs.push({
                  from: hashPos + 1,
                  to: end - 2,
                  dec: Decoration.mark({
                    class: `${linkClass} cm-wiki-link-heading`,
                    attributes: { 'data-target': target },
                  }),
                });
              }
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

// E2 Fatia B (Spec 28): headings da nota alvo lidos ON-DEMAND (read_file + regex),
// com cache de última nota — sem mexer no schema do índice
let headingsCache: { path: string; headings: string[] } | null = null;

export function parseHeadings(content: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (match) {
      headings.push(match[1].trim());
    }
  }
  return headings;
}

async function getHeadingsFor(path: string): Promise<string[]> {
  if (headingsCache?.path === path) {
    return headingsCache.headings;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const content = await invoke<string>('read_file', { path });
  const headings = parseHeadings(content);
  headingsCache = { path, headings };
  return headings;
}

// Invalidação simples: o MarkdownEditor chama quando o watcher reporta mudança de árvore
export function invalidateHeadingsCache() {
  headingsCache = null;
}

export async function wikiLinkAutocomplete(context: CompletionContext): Promise<CompletionResult | null> {
  const word = context.matchBefore(/\[\[[^\]]*$/);
  if (!word) return null;

  const inner = word.text.slice(2);
  const hashIdx = inner.indexOf('#');

  // E2 Fatia B: `[[Nota#` → completa com os headings da nota alvo
  if (hashIdx !== -1) {
    const noteName = inner.slice(0, hashIdx).trim();
    const store = useAppStore.getState();

    let headings: string[];
    if (noteName === '') {
      // `[[#` → headings da PRÓPRIA nota (conteúdo já está em memória)
      headings = parseHeadings(store.activeNoteContent ?? '');
    } else {
      const path = store.existingNotes.get(noteName.toLowerCase());
      if (!path) return null;
      try {
        headings = await getHeadingsFor(path);
      } catch (e) {
        console.error('Failed to read headings for autocomplete:', e);
        return null;
      }
    }

    return {
      from: word.from + 2 + hashIdx + 1,
      options: headings.map((h) => ({
        label: h,
        type: 'text',
        apply: `${h}]]`,
      })),
      validFor: /^[^\]#|]*$/,
    };
  }

  const prefix = inner.toLowerCase();
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
    const quoteLines = new Set<number>(); // linhas de citação comum (estilo de quote)
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
          // Citação comum: sem estilo ela fica idêntica a texto normal quando o ">"
          // é escondido (achado do Felipe no Review Gate do E1.5) — marca as linhas
          // pra ganharem borda/cor de quote. O Set deduplica blockquote aninhado.
          {
            const startLine = state.doc.lineAt(node.from).number;
            const endLine = state.doc.lineAt(node.to).number;
            for (let n = startLine; n <= endLine; n++) {
              quoteLines.add(n);
            }
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

    // Estilo de citação comum: decorações de LINHA (from==to no começo da linha).
    // Entram ANTES dos demais specs no array — com `from` igual, o sort estável as
    // mantém na frente e elas sobrevivem ao guard de overlap do builder (o replace
    // do QuoteMark começa na mesma posição).
    const quoteLineSpecs: DecSpec[] = [];
    for (const lineNumber of quoteLines) {
      const line = state.doc.line(lineNumber);
      quoteLineSpecs.push({
        from: line.from,
        to: line.from,
        dec: Decoration.line({ class: 'cm-quote-line' }),
      });
    }

    // Ordena por ordem de início e adiciona síncrono no RangeSetBuilder
    const allSpecs = [...quoteLineSpecs, ...specs];
    allSpecs.sort((a, b) => a.from - b.from);
    const builder = new RangeSetBuilder<Decoration>();
    let lastTo = -1;
    for (const spec of allSpecs) {
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
