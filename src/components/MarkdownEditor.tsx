// Shell do editor (F3 — Spec 17): componente React + fiação da EditorView. As extensões,
// widgets, tema e o subsistema mermaid vivem em src/editor/* (extraídos intactos). O
// onChange alimenta o autosave do store (fluxo de save sagrado) — a fiação daqui não muda.
import { useEffect, useRef, useState } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, ViewUpdate, keymap } from '@codemirror/view';
import { PenLine, Code2 } from 'lucide-react';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree, syntaxHighlighting, ensureSyntaxTree } from '@codemirror/language';
import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { useAppStore } from '../store/appStore';
import { fileTreeChangedEffect } from '../editor/shared';
import { mycelliaTheme, mycelliaHighlightStyle } from '../editor/theme';
import { mermaidThemePlugin } from '../editor/mermaid';
import {
  wikiLinkExtension,
  wikiLinkAutocomplete,
  livePreviewExtension,
  imagePreviewExtension,
} from '../editor/extensions';
import { slashMenuCompletion, calloutTypeCompletion } from '../editor/slashMenu';
import { selectionToolbar } from '../editor/selectionToolbar';
import PropertiesPanel from './PropertiesPanel';

interface MarkdownEditorProps {
  content: string;
  onChange: (value: string) => void;
}

// E1.6 (Spec 27): as decorações de preview vivem num Compartment — o modo Fonte as
// desliga por reconfigure, sem recriar o editor (cursor/scroll preservados).
const buildDecorationExtensions = () => [
  livePreviewExtension(),
  mermaidThemePlugin,
  imagePreviewExtension(),
  wikiLinkExtension(),
];

export default function MarkdownEditor({ content, onChange }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const decorationsCompartment = useRef(new Compartment());
  const { activeTab, fileTree, renameItem, editorSourceMode, toggleEditorSourceMode } = useAppStore();

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
        keymap.of([
          // E1.6 (Spec 27): Ctrl+E alterna Edição ↔ Fonte (padrão Obsidian)
          {
            key: 'Mod-e',
            run: () => {
              useAppStore.getState().toggleEditorSourceMode();
              return true;
            },
          },
          ...standardKeymap,
          ...historyKeymap,
        ]),
        mycelliaTheme,
        syntaxHighlighting(mycelliaHighlightStyle),
        decorationsCompartment.current.of(
          useAppStore.getState().editorSourceMode ? [] : buildDecorationExtensions(),
        ),
        // E1.5 (Spec 26): slash menu + tipos de callout entram na MESMA infra de
        // autocomplete dos wiki-links; toolbar de seleção via Tooltip API.
        // Ficam FORA do compartimento: ajudantes de digitação valem nos dois modos.
        autocompletion({ override: [wikiLinkAutocomplete, slashMenuCompletion, calloutTypeCompletion] }),
        selectionToolbar(),
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

  // BUG-04 (fix): avisa a extensão de imagens quando a árvore do vault muda — imagem
  // recém-colada/criada aparece sem precisar reabrir a nota
  useEffect(() => {
    viewRef.current?.dispatch({ effects: fileTreeChangedEffect.of() });
  }, [fileTree]);

  // E1.6 (Spec 27): alterna Edição ↔ Fonte reconfigurando o compartimento de decorações
  // (sem recriar o editor — cursor/scroll preservados)
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: decorationsCompartment.current.reconfigure(
        editorSourceMode ? [] : buildDecorationExtensions(),
      ),
    });
  }, [editorSourceMode]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Header Fixo */}
      <div className="flex-shrink-0 flex flex-col space-y-4 mb-4 select-none pr-2">
        <div className="relative flex items-center gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError(null);
            }}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 bg-transparent border-b border-transparent focus:border-[var(--border-strong)] outline-none text-[27px] font-display font-semibold text-[var(--text-primary)] py-1 transition-all"
            placeholder="Sem título"
          />
          {/* E1.6 (Spec 27): toggle Edição ↔ Fonte (mostra o modo ATUAL; Ctrl+E também alterna) */}
          <button
            onClick={() => toggleEditorSourceMode()}
            title={
              editorSourceMode
                ? 'Modo Fonte: markdown cru, sem render — clique (ou Ctrl+E) para voltar à Edição'
                : 'Modo Edição: preview ao vivo — clique (ou Ctrl+E) para ver o markdown cru'
            }
            aria-label="Alternar modo de exibição da nota"
            className={`flex-shrink-0 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs border transition-colors cursor-pointer ${
              editorSourceMode
                ? 'text-[var(--accent)] border-[var(--accent-muted)] bg-[var(--accent-muted)]'
                : 'text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)] hover:bg-[var(--substrate-raised)]'
            }`}
          >
            {editorSourceMode ? <Code2 className="w-3.5 h-3.5" /> : <PenLine className="w-3.5 h-3.5" />}
            <span>{editorSourceMode ? 'Fonte' : 'Edição'}</span>
          </button>
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
