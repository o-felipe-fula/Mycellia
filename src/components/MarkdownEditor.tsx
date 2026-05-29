import { useEffect, useRef, useState } from 'react';
import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, ViewUpdate, WidgetType, keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { useAppStore, FileNode } from '../store/appStore';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { SyntaxNode } from '@lezer/common';

class EmptyWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-hidden-syntax-placeholder';
    span.style.display = 'none';
    return span;
  }

  eq() {
    return true;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly exists: boolean,
  ) {
    super();
  }

  toDOM() {
    const div = document.createElement('div');

    if (!this.exists) {
      div.className =
        'mycellia-image-error-container my-3 select-none p-3 rounded-lg border border-[var(--border-default)] bg-[var(--substrate-raised)] text-[var(--danger)] font-sans text-sm flex items-center gap-2';
      const errorMsg = document.createElement('span');
      errorMsg.textContent = `⚠️ Imagem não encontrada: `;
      const filenameSpan = document.createElement('span');
      filenameSpan.className = 'font-mono text-xs';
      filenameSpan.textContent = this.alt;
      errorMsg.appendChild(filenameSpan);
      div.appendChild(errorMsg);
      return div;
    }

    div.className = 'mycellia-image-container my-3 select-none flex flex-col items-start gap-1.5';

    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.loading = 'lazy';
    img.className =
      'max-w-full max-h-[350px] rounded-lg border border-[var(--border-default)] object-contain shadow-lg hover:border-[var(--accent)] transition-all duration-200';

    const caption = document.createElement('span');
    caption.className = 'text-[10px] text-[var(--text-muted)] font-mono pl-1';
    caption.textContent = this.alt || 'Imagem';

    img.onerror = () => {
      img.style.display = 'none';
      caption.textContent = `⚠️ Erro ao carregar imagem: ${this.alt} (${this.src})`;
      caption.className =
        'text-[11px] text-[var(--danger)] font-mono pl-1 bg-[var(--danger-muted)]/5 px-2 py-1 rounded border border-[var(--danger)]/10';
    };

    div.appendChild(img);
    div.appendChild(caption);
    return div;
  }

  eq(other: ImageWidget) {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.exists === this.exists
    );
  }
}

function findFileInTree(node: FileNode, name: string): string | null {
  if (!node.is_dir && node.name.toLowerCase() === name.toLowerCase()) {
    return node.path;
  }
  if (node.is_dir && node.children) {
    for (const child of node.children) {
      const found = findFileInTree(child, name);
      if (found) return found;
    }
  }
  return null;
}

function findFilePathInTree(node: FileNode, targetPath: string): boolean {
  const cleanNodePath = node.path.replace(/\\/g, '/').toLowerCase();
  const cleanTargetPath = targetPath.replace(/\\/g, '/').toLowerCase();
  if (cleanNodePath === cleanTargetPath) {
    return true;
  }
  if (node.is_dir && node.children) {
    for (const child of node.children) {
      if (findFilePathInTree(child, targetPath)) return true;
    }
  }
  return false;
}

function resolveImagePath(
  src: string,
  activeNotePath: string | null,
  vaultPath: string | null,
  fileTree: FileNode | null,
): { url: string; exists: boolean } {
  if (
    src.startsWith('http://') ||
    src.startsWith('https://')
  ) {
    return { url: src, exists: true };
  }

  if (
    /^[a-zA-Z]:\\/.test(src) ||
    src.startsWith('/')
  ) {
    return { url: convertFileSrc(src), exists: true };
  }

  // Extract base name to search in fileTree
  const baseName = src.includes('/') || src.includes('\\')
    ? (src.split(/[/\\]/).pop() || src)
    : src;

  if (fileTree) {
    const foundPath = findFileInTree(fileTree, baseName);
    if (foundPath) {
      return { url: convertFileSrc(foundPath), exists: true };
    }
  }

  if (activeNotePath && vaultPath) {
    const noteDir =
      activeNotePath.substring(0, activeNotePath.lastIndexOf('\\') + 1) ||
      activeNotePath.substring(0, activeNotePath.lastIndexOf('/') + 1);

    const relativePath = noteDir + src;
    if (fileTree && findFilePathInTree(fileTree, relativePath)) {
      return { url: convertFileSrc(relativePath), exists: true };
    }
  }

  return { url: '', exists: false };
}

function isInsideCodeBlock(state: EditorState, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos);
  while (node) {
    if (
      node.name === 'FencedCode' ||
      node.name === 'CodeBlock' ||
      node.name === 'InlineCode' ||
      node.name === 'CodeText'
    ) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function isRangeInCode(state: EditorState, from: number, to: number): boolean {
  let inCode = false;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (
        node.name === 'FencedCode' ||
        node.name === 'CodeBlock' ||
        node.name === 'InlineCode' ||
        node.name === 'CodeText'
      ) {
        inCode = true;
        return false;
      }
      return true;
    },
  });
  return inCode;
}

const wikiLinkExtension = () => {
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

function wikiLinkAutocomplete(context: CompletionContext): CompletionResult | null {
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

interface DecSpec {
  from: number;
  to: number;
  dec: Decoration;
}

const livePreviewExtension = () => {
  return StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(decorations, tr) {
      decorations = decorations.map(tr.changes);

      const specs: DecSpec[] = [];
      const selection = tr.state.selection.main;
      const activeLineNumber = tr.state.doc.lineAt(selection.head).number;

      // 1. Processa Árvore de Sintaxe do Lezer
      syntaxTree(tr.state).iterate({
        enter(node) {
          const nodeName = node.name;
          const nodeLine = tr.state.doc.lineAt(node.from).number;

          if (
            nodeName === 'HeaderMark' ||
            nodeName === 'EmphasisMark' ||
            nodeName === 'LinkMark' ||
            nodeName === 'CodeMark' ||
            nodeName === 'QuoteMark' ||
            nodeName === 'ListMark'
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

            specs.push({
              from: node.from,
              to: node.to,
              dec: Decoration.replace({
                widget: new EmptyWidget(),
              }),
            });
          }
          return true;
        },
      });

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
    },
    provide: (f) => EditorView.decorations.from(f),
  });
};

const imagePreviewExtension = (
  activeNotePath: string | null,
  vaultPath: string | null,
  fileTree: FileNode | null,
) => {
  const buildDecorations = (state: EditorState): DecorationSet => {
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
      if (tr.docChanged || !tr.state.selection.eq(tr.startState.selection)) {
        return buildDecorations(tr.state);
      }
      return decorations;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
};

const mycelliaHighlightStyle = HighlightStyle.define([
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

const mycelliaTheme = EditorView.theme(
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
    '.cm-strikethrough': { textDecoration: 'line-through' },
  },
  { dark: true },
);

import PropertiesPanel from './PropertiesPanel';

interface MarkdownEditorProps {
  content: string;
  onChange: (value: string) => void;
}

export default function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { activeTab, currentVault, fileTree, renameItem } = useAppStore();

  const filename = activeTab ? activeTab.split('\\').pop()?.split('/').pop()?.replace('.md', '') || '' : '';
  const [title, setTitle] = useState(filename);
  const [error, setError] = useState<string | null>(null);
  const errorTimeoutRef = useRef<number | null>(null);

  // Sync title with activeTab name
  useEffect(() => {
    setTitle(filename);
    setError(null);
  }, [filename, activeTab]);

  // Clean timeout on unmount
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        window.clearTimeout(errorTimeoutRef.current);
      }
    };
  }, []);

  const triggerError = (msg: string) => {
    setError(msg);
    if (errorTimeoutRef.current) {
      window.clearTimeout(errorTimeoutRef.current);
    }
    errorTimeoutRef.current = window.setTimeout(() => {
      setError(null);
    }, 4000);
  };

  const handleRename = async (newValue: string) => {
    const trimmed = newValue.trim();
    if (!trimmed) {
      triggerError("O nome do arquivo não pode ser vazio");
      setTitle(filename);
      return;
    }

    const invalidChars = new RegExp('[\\\\/:*?"<>|]');
    if (invalidChars.test(trimmed)) {
      triggerError("O nome do arquivo contém caracteres inválidos. Não use: \\ / : * ? \" < > |");
      setTitle(filename);
      return;
    }

    if (trimmed === filename) return;

    try {
      if (activeTab) {
        await renameItem(activeTab, trimmed);
      }
    } catch (err: unknown) {
      const errMsg = typeof err === 'string' ? err : (err instanceof Error ? err.message : String(err));
      triggerError(errMsg);
      setTitle(filename);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setTitle(filename);
      e.currentTarget.blur();
    }
  };

  const handleBlur = () => {
    handleRename(title);
  };

  // Inicializa o EditorView
  useEffect(() => {
    if (!containerRef.current) return;

    const startState = EditorState.create({
      doc: content,
      extensions: [
        markdown(),
        history(),
        keymap.of([...standardKeymap, ...historyKeymap]),
        mycelliaTheme,
        syntaxHighlighting(mycelliaHighlightStyle),
        livePreviewExtension(),
        imagePreviewExtension(activeTab, currentVault, fileTree),
        wikiLinkExtension(),
        autocompletion({ override: [wikiLinkAutocomplete] }),
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          click(event) {
            const target = event.target as HTMLElement;
            const wikiLinkEl = target.closest('.cm-wiki-link');
            if (wikiLinkEl) {
              const targetName = wikiLinkEl.getAttribute('data-target');
              if (targetName) {
                useAppStore.getState().handleWikiLinkClick(targetName);
                return true;
              }
            }
            return false;
          },
          paste(event, view) {
            const items = event.clipboardData?.items;
            if (!items) return false;

            let imageItem = null;
            for (let i = 0; i < items.length; i++) {
              if (items[i].type.startsWith('image/')) {
                imageItem = items[i];
                break;
              }
            }

            if (imageItem) {
              event.preventDefault();
              const file = imageItem.getAsFile();
              if (!file) return false;

              const extension = file.name.split('.').pop() || 'png';

              const reader = new FileReader();
              reader.onload = async (e) => {
                const base64Data = e.target?.result as string;
                if (!base64Data) return;

                const commaIndex = base64Data.indexOf(',');
                const pureBase64 = commaIndex !== -1 ? base64Data.slice(commaIndex + 1) : base64Data;

                try {
                  const { invoke } = await import('@tauri-apps/api/core');
                  const filename = await invoke<string>('save_pasted_image', {
                    base64Data: pureBase64,
                    extension,
                  });

                  const insertText = `![[${filename}]]`;
                  const mainSel = view.state.selection.main;
                  view.dispatch({
                    changes: {
                      from: mainSel.from,
                      to: mainSel.to,
                      insert: insertText,
                    },
                    selection: { anchor: mainSel.from + insertText.length },
                  });
                } catch (error) {
                  console.error('Failed to save pasted image:', error);
                  const setGlobalError = useAppStore.getState().setGlobalError;
                  if (setGlobalError) {
                    setGlobalError(`Erro ao colar imagem: ${error}`);
                  }
                }
              };
              reader.readAsDataURL(file);
              return true;
            }
            return false;
          },
        }),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]); // Reinicializa apenas quando mudamos de nota para recriar o estado limpo

  // Atualiza o documento se o conteúdo mudar externamente (por exemplo, ao alternar de aba)
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== content) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
    }
  }, [content]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Header Fixo */}
      <div className="flex-shrink-0 flex flex-col space-y-4 mb-4 select-none pr-2">
        <div className="relative">
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError(null);
            }}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent border-b border-transparent focus:border-[var(--border-strong)] outline-none text-[27px] font-display font-semibold text-[var(--text-primary)] py-1 transition-all"
            placeholder="Sem título"
          />
          {error && (
            <div className="absolute top-full left-0 mt-1 text-xs text-[var(--danger)] font-sans animate-in fade-in duration-200 z-10 bg-[var(--substrate-raised)] border border-[var(--border-default)] px-2 py-1 rounded shadow-lg">
              ⚠️ {error}
            </div>
          )}
        </div>

        <PropertiesPanel />
      </div>

      {/* Editor Body Area */}
      <div
        ref={containerRef}
        className="flex-grow flex-1 min-h-0 overflow-hidden relative text-sm"
      />
    </div>
  );
}
