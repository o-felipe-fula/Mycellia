// E5 (Spec 29): editor de texto puro/código para arquivos não-md — CM6 mínimo (highlight
// lazy por linguagem + tema + histórico), ZERO extensões de markdown. O conteúdo cru passa
// intacto pelo fluxo de save sagrado: com frontmatter vazio, serializeRawNote é identidade,
// então o que está no doc é exatamente o que vai pro disco (regressão byte-a-byte na spec).
import { useEffect, useRef, useState } from 'react';
import { EditorState, Compartment, Transaction, Annotation } from '@codemirror/state';
import { EditorView, ViewUpdate, keymap } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { useAppStore } from '../store/appStore';
import { mycelliaTheme, mycelliaHighlightStyle } from '../editor/theme';
import { getExtension, getLanguageId } from '../utils/fileKind';
import { loadLanguage } from '../editor/plainLanguages';

interface PlainTextEditorProps {
  content: string;
  onChange: (value: string) => void;
}

// Sync externo de conteúdo (troca de aba) é marcado com esta annotation e IGNORADO pelo
// updateListener — sem isso, o replace programático dispararia onChange → pendingSave com
// o conteúdo recém-carregado → write redundante no flush (violaria "abrir sem editar =
// zero write" da Spec 29).
const externalSync = Annotation.define<boolean>();

export default function PlainTextEditor({ content, onChange }: PlainTextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const { activeTab, renameItem } = useAppStore();

  const filename = activeTab ? activeTab.split(/[\\/]/).pop() || '' : '';
  const ext = getExtension(filename);
  const baseName = ext ? filename.slice(0, -(ext.length + 1)) : filename;

  const [title, setTitle] = useState(baseName);
  const [error, setError] = useState<string | null>(null);
  const errorTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setTitle(baseName);
    setError(null);
  }, [baseName, activeTab]);

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
      triggerError('O nome do arquivo não pode ser vazio');
      setTitle(baseName);
      return;
    }

    const invalidChars = new RegExp('[\\\\/:*?"<>|]');
    if (invalidChars.test(trimmed)) {
      triggerError('O nome do arquivo contém caracteres inválidos. Não use: \\ / : * ? " < > |');
      setTitle(baseName);
      return;
    }

    if (trimmed === baseName) return;

    try {
      if (activeTab) {
        // Sem ponto no nome novo, o core Rust preserva a extensão original (fs.rs)
        await renameItem(activeTab, trimmed);
      }
    } catch (err: unknown) {
      const errMsg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
      triggerError(errMsg);
      setTitle(baseName);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setTitle(baseName);
      e.currentTarget.blur();
    }
  };

  // Inicializa o EditorView
  useEffect(() => {
    if (!containerRef.current) return;

    const languageId = activeTab ? getLanguageId(activeTab) : null;

    // EOL (Spec 29): arquivo CRLF seta o lineSeparator pra \r\n — o doc.toString() devolve
    // \r\n e as linhas não editadas ficam byte-idênticas no save. O FileViewer só monta
    // este editor com o conteúdo REAL da aba já carregado (activeContentPath), então a
    // detecção nunca roda sobre conteúdo stale de outra aba.
    const usesCrlf = content.includes('\r\n');

    const startState = EditorState.create({
      doc: content,
      extensions: [
        history(),
        keymap.of([...standardKeymap, ...historyKeymap]),
        mycelliaTheme,
        syntaxHighlighting(mycelliaHighlightStyle),
        langCompartment.current.of([]),
        // Texto corrido quebra linha; código rola na horizontal (padrão de editor de código)
        ...(languageId === null ? [EditorView.lineWrapping] : []),
        ...(usesCrlf ? [EditorState.lineSeparator.of('\r\n')] : []),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (
            update.docChanged &&
            !update.transactions.some((tr) => tr.annotation(externalSync))
          ) {
            // sliceDoc respeita o lineSeparator (doc.toString() SEMPRE junta com \n e
            // converteria CRLF→LF em silêncio no primeiro save)
            onChange(update.state.sliceDoc());
          }
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Highlight lazy: o editor abre imediatamente como texto puro e a linguagem chega via
    // reconfigure quando o chunk resolve (import dinâmico)
    if (languageId) {
      const tabAtLoad = activeTab;
      loadLanguage(languageId).then((langExt) => {
        if (langExt && viewRef.current === view && useAppStore.getState().activeTab === tabAtLoad) {
          view.dispatch({ effects: langCompartment.current.reconfigure(langExt) });
        }
      });
    }

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]); // Reinicializa apenas ao trocar de arquivo (estado limpo por aba)

  // Sync externo (mesma proteção do BUG-08 do MarkdownEditor): replace programático nunca
  // entra no histórico de undo E nunca dispara onChange (annotation externalSync acima)
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.sliceDoc() !== content) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        annotations: [Transaction.addToHistory.of(false), externalSync.of(true)],
      });
    }
  }, [content]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Header fixo: nome do arquivo (renomeável) + badge da extensão */}
      <div className="flex-shrink-0 flex flex-col space-y-4 mb-4 select-none pr-2">
        <div className="relative flex items-center gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError(null);
            }}
            onBlur={() => handleRename(title)}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 bg-transparent border-b border-transparent focus:border-[var(--border-strong)] outline-none text-[27px] font-display font-semibold text-[var(--text-primary)] py-1 transition-all"
            placeholder="Sem título"
          />
          <span
            title={`Arquivo ${ext.toUpperCase()} — editado como ${getLanguageId(activeTab || '') ? 'código' : 'texto puro'}`}
            className="flex-shrink-0 rounded-md px-2 py-1 text-xs font-mono font-semibold uppercase border text-[var(--text-muted)] border-[var(--border-subtle)] bg-[var(--substrate-raised)]/50"
          >
            {ext}
          </span>
          {error && (
            <div className="absolute top-full left-0 mt-1 text-xs text-[var(--danger)] font-sans animate-in fade-in duration-200 z-10 bg-[var(--substrate-raised)] border border-[var(--border-default)] px-2 py-1 rounded shadow-lg">
              ⚠️ {error}
            </div>
          )}
        </div>
      </div>

      {/* Corpo do editor */}
      <div
        ref={containerRef}
        className="flex-grow flex-1 min-h-0 overflow-hidden relative text-sm"
      />
    </div>
  );
}
