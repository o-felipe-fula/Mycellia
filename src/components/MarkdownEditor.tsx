import { useEffect, useRef, useState } from 'react';
import { EditorState, RangeSetBuilder, StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, ViewUpdate, WidgetType, keymap, ViewPlugin, type PluginValue } from '@codemirror/view';
let mermaidModule: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

async function loadMermaid() {
  if (mermaidModule) return mermaidModule;
  const mod = await import('mermaid');
  mermaidModule = mod.default || mod;
  mermaidModule.initialize({
    startOnLoad: false,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
    securityLevel: 'strict',
  });
  return mermaidModule;
}

const mermaidCache = new Map<string, string>();
let nextMermaidIdCounter = 0;

const themeChangeEffect = StateEffect.define<void>();

class MermaidThemeObserver implements PluginValue {
  private observer: MutationObserver;
  private isDark: boolean;

  constructor(readonly view: EditorView) {
    this.isDark = document.documentElement.classList.contains('dark');

    this.observer = new MutationObserver(() => {
      const currentIsDark = document.documentElement.classList.contains('dark');
      // Correção 3: filtrar mutação de tema para evitar re-chamadas atoa
      if (currentIsDark !== this.isDark) {
        this.isDark = currentIsDark;
        if (mermaidModule) {
          mermaidModule.initialize({
            theme: currentIsDark ? 'dark' : 'default',
            securityLevel: 'strict',
          });
        }
        mermaidCache.clear();
        view.dispatch({
          effects: themeChangeEffect.of(),
        });
      }
    });

    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  update() {}

  destroy() {
    this.observer.disconnect();
  }
}

const mermaidThemePlugin = ViewPlugin.fromClass(MermaidThemeObserver);

function getFencedCodeContent(rawText: string): string {
  const lines = rawText.split('\n');
  if (lines.length === 0) return '';
  if (lines.length === 1) return '';
  const lastLine = lines[lines.length - 1].trim();
  const hasClosingFence = lastLine.startsWith('```') || lastLine.startsWith('~~~');
  if (hasClosingFence) {
    return lines.slice(1, lines.length - 1).join('\n');
  } else {
    return lines.slice(1).join('\n');
  }
}

class MermaidWidget extends WidgetType {
  private destroyed = false;
  readonly isDark: boolean;

  constructor(readonly code: string) {
    super();
    this.isDark = document.documentElement.classList.contains('dark');
  }

  toDOM(_view: EditorView) {
    const container = document.createElement('div');
    container.className = 'mycellia-mermaid-wrapper my-4 flex justify-center select-none';

    // Verify cache
    const cachedSvg = mermaidCache.get(this.code);
    if (cachedSvg) {
      container.innerHTML = cachedSvg;
      return container;
    }

    // Placeholder skeleton
    const placeholder = document.createElement('div');
    placeholder.className = 'mycellia-mermaid-placeholder animate-skeleton-pulse w-full h-[150px] bg-[var(--substrate-raised)] rounded-lg flex items-center justify-center text-[var(--text-muted)] font-sans text-xs';
    placeholder.textContent = 'Renderizando diagrama...';
    container.appendChild(placeholder);

    const id = `mycellia-mermaid-${nextMermaidIdCounter++}`;

    loadMermaid()
      .then((m) => {
        if (this.destroyed) return;
        return m.render(id, this.code);
      })
      .then((renderResult) => {
        if (!renderResult) return;
        const { svg } = renderResult;

        // Correção 2 — limpar nó temporário do mermaid no DOM (se mermaid v10+ não removeu)
        const tempElement = document.getElementById(id) || document.getElementById(`d${id}`);
        if (tempElement && tempElement.parentNode) {
          tempElement.parentNode.removeChild(tempElement);
        }

        // Correção 1 — guarda de widget desmontado (obrigatória)
        if (this.destroyed) {
          return;
        }

        mermaidCache.set(this.code, svg);
        container.innerHTML = svg;
      })
      .catch((err) => {
        // Remover nó temporário no catch também
        const tempElement = document.getElementById(id) || document.getElementById(`d${id}`);
        if (tempElement && tempElement.parentNode) {
          tempElement.parentNode.removeChild(tempElement);
        }

        if (this.destroyed) {
          return;
        }

        console.error('Mermaid render error:', err);
        container.innerHTML = '';
        
        const errorPanel = document.createElement('div');
        errorPanel.className = 'mycellia-mermaid-error w-full p-3 rounded-lg border border-[var(--border-strong)] bg-[var(--substrate-raised)] text-[var(--danger)] text-xs font-mono whitespace-pre-wrap';
        
        let errorMsg = '⚠️ Erro de sintaxe no diagrama:\n';
        if (err instanceof Error) {
          errorMsg += err.message;
        } else if (typeof err === 'string') {
          errorMsg += err;
        } else {
          errorMsg += String(err);
        }
        
        errorPanel.textContent = errorMsg;
        container.appendChild(errorPanel);
      });

    return container;
  }

  destroy() {
    this.destroyed = true;
  }

  eq(other: MermaidWidget) {
    return other.code === this.code && other.isDark === this.isDark;
  }
}
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree, HighlightStyle, syntaxHighlighting, ensureSyntaxTree } from '@codemirror/language';
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

class TableWidget extends WidgetType {
  constructor(readonly rawText: string) {
    super();
  }

  toDOM() {
    const container = document.createElement('div');
    container.className = 'mycellia-table-container overflow-x-auto w-full my-3';

    const table = document.createElement('table');
    table.className = 'mycellia-table-wrapper w-full border-collapse font-sans text-sm select-text';

    const lines = this.rawText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return container;

    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    let isHeader = true;
    for (const line of lines) {
      const cells = line.split('|').map(c => c.trim());
      if (line.startsWith('|')) {
        cells.shift();
      }
      if (line.endsWith('|')) {
        cells.pop();
      }

      const isDelimiter = cells.every(c => /^[:-]+$/.test(c));
      if (isDelimiter) {
        continue;
      }

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-[var(--substrate-raised)] transition-colors';

      for (const cellText of cells) {
        const cell = document.createElement(isHeader ? 'th' : 'td');
        if (isHeader) {
          cell.className = 'border border-[var(--border-subtle)] px-3 py-2 bg-[var(--substrate-raised)] text-[var(--text-primary)] font-semibold text-left';
        } else {
          cell.className = 'border border-[var(--border-subtle)] px-3 py-2 text-[var(--text-secondary)]';
        }
        cell.textContent = cellText;
        tr.appendChild(cell);
      }

      if (isHeader) {
        thead.appendChild(tr);
        isHeader = false;
      } else {
        tbody.appendChild(tr);
      }
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    container.appendChild(table);
    return container;
  }

  eq(other: TableWidget) {
    return other.rawText === this.rawText;
  }
}

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-bullet-mark inline-block text-[var(--accent-dim)] mx-1.5 transform scale-125';
    span.textContent = '•';
    return span;
  }

  eq() {
    return true;
  }
}

class TaskMarkerWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-task-marker-wrapper inline-flex items-center align-middle mr-1.5';

    const checkbox = document.createElement('span');
    checkbox.className = `cm-task-marker-box ${this.checked ? 'checked' : ''}`;
    
    if (this.checked) {
      const check = document.createElement('span');
      check.style.position = 'absolute';
      check.style.left = '4px';
      check.style.top = '1px';
      check.style.width = '4px';
      check.style.height = '8px';
      check.style.border = 'solid var(--substrate-base)';
      check.style.borderWidth = '0 2px 2px 0';
      check.style.transform = 'rotate(45deg)';
      checkbox.appendChild(check);
    }

    checkbox.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      ensureSyntaxTree(view.state, view.state.doc.length, 50);
      const pos = view.posAtDOM(checkbox);
      const tree = syntaxTree(view.state);
      const node = tree.resolveInner(pos, 1);

      if (node && node.name === 'TaskMarker') {
        const activeLineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
        const nodeLine = view.state.doc.lineAt(node.from).number;
        
        // CORREÇÃO OBRIGATÓRIA — clique só vale no estado decorado
        if (nodeLine === activeLineNumber) {
          return;
        }

        const rawText = view.state.doc.sliceString(node.from, node.to);
        const isChecked = rawText.toLowerCase().includes('x');
        const newText = isChecked ? '[ ]' : '[x]';

        view.dispatch({
          changes: {
            from: node.from,
            to: node.to,
            insert: newText,
          },
        });
      }
    });

    span.appendChild(checkbox);
    return span;
  }

  eq(other: TaskMarkerWidget) {
    return other.checked === this.checked;
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
  const isWindows = useAppStore.getState().platform === 'windows';
  const cleanNodePath = node.path.replace(/\\/g, '/');
  const cleanTargetPath = targetPath.replace(/\\/g, '/');
  if (isWindows ? cleanNodePath.toLowerCase() === cleanTargetPath.toLowerCase() : cleanNodePath === cleanTargetPath) {
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

function hasChildTaskMarker(node: SyntaxNode): boolean {
  let found = false;
  const traverse = (n: SyntaxNode) => {
    if (n.name === 'TaskMarker') {
      found = true;
      return;
    }
    let child = n.firstChild;
    while (child && !found) {
      traverse(child);
      child = child.nextSibling;
    }
  };
  traverse(node);
  return found;
}

const livePreviewExtension = () => {
  const buildDecorations = (state: EditorState, activeLineNumber: number): DecorationSet => {
    const specs: DecSpec[] = [];
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
      if (tr.docChanged || !tr.state.selection.eq(tr.startState.selection) || themeChanged) {
        const selection = tr.state.selection.main;
        const activeLineNumber = tr.state.doc.lineAt(selection.head).number;
        return buildDecorations(tr.state, activeLineNumber);
      }
      return decorations;
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
        markdown({
          base: markdownLanguage,
          extensions: [GFM],
        }),
        history(),
        keymap.of([...standardKeymap, ...historyKeymap]),
        mycelliaTheme,
        syntaxHighlighting(mycelliaHighlightStyle),
        livePreviewExtension(),
        mermaidThemePlugin,
        imagePreviewExtension(activeTab, currentVault, fileTree),
        wikiLinkExtension(),
        autocompletion({ override: [wikiLinkAutocomplete] }),
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          click(event, view) {
            console.log("CLICK EVENT TARGET CLASSNAME:", (event.target as HTMLElement).className);
            const target = event.target as HTMLElement;
            const wikiLinkEl = target.closest('.cm-wiki-link');
            if (wikiLinkEl) {
              const targetName = wikiLinkEl.getAttribute('data-target');
              if (targetName) {
                useAppStore.getState().handleWikiLinkClick(targetName);
                return true;
              }
            }

            const taskMarkerBox = target.closest('.cm-task-marker-box');
            if (taskMarkerBox) {
              ensureSyntaxTree(view.state, view.state.doc.length, 50);
              const pos = view.posAtDOM(taskMarkerBox);
              const tree = syntaxTree(view.state);
              const node = tree.resolveInner(pos, 1);
              console.log("CLICK posAtDOM:", pos, "nodeResolved:", node?.name, "nodeText:", node ? view.state.doc.sliceString(node.from, node.to) : "null");
              if (node && node.name === 'TaskMarker') {
                const activeLineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
                const nodeLine = view.state.doc.lineAt(node.from).number;
                // CORREÇÃO OBRIGATÓRIA — clique só vale no estado decorado
                if (nodeLine === activeLineNumber) {
                  return false;
                }

                const rawText = view.state.doc.sliceString(node.from, node.to);
                const isChecked = rawText.toLowerCase().includes('x');
                const newText = isChecked ? '[ ]' : '[x]';

                view.dispatch({
                  changes: {
                    from: node.from,
                    to: node.to,
                    insert: newText,
                  },
                });
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
