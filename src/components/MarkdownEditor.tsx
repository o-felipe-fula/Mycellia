// Shell do editor (F3 — Spec 17): componente React + fiação da EditorView. As extensões,
// widgets, tema e o subsistema mermaid vivem em src/editor/* (extraídos intactos). O
// onChange alimenta o autosave do store (fluxo de save sagrado) — a fiação daqui não muda.
import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, ViewUpdate, keymap } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree, syntaxHighlighting, ensureSyntaxTree } from '@codemirror/language';
import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { useAppStore } from '../store/appStore';
import { mycelliaTheme, mycelliaHighlightStyle } from '../editor/theme';
import { mermaidThemePlugin } from '../editor/mermaid';
import {
  wikiLinkExtension,
  wikiLinkAutocomplete,
  livePreviewExtension,
  imagePreviewExtension,
} from '../editor/extensions';
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
