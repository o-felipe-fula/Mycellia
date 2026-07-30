// E4 Fatia 2 (Spec 30): editor Excalidraw embutido pra .excalidraw — desenho completo,
// 100% local (bundle + fontes empacotados pelo Vite via import.meta.url; zero CDN).
// O save reusa o pipeline sagrado INTEIRO: serializeAsJSON → updateActiveNoteContent →
// pendingSave → flushPendingSave → write_file atômico (rawFrontmatter='' ⇒ identidade).
// Dirty SÓ com mudança de CENA via getSceneVersion (risco #1 da spec): pan/zoom/seleção
// NUNCA geram write — "abrir sem editar = zero write". O componente monta com key por aba
// (FileViewer), então o parse do arquivo acontece UMA vez por abertura: o estado canônico
// vive dentro do Excalidraw enquanto a aba está ativa.
import { useMemo, useRef } from 'react';
import { Excalidraw, serializeAsJSON, getSceneVersion } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { Shapes } from 'lucide-react';
import { useAppStore } from '../store/appStore';

type ExcalidrawOnChange = Parameters<
  NonNullable<React.ComponentProps<typeof Excalidraw>['onChange']>
>;

interface ExcalidrawEditorProps {
  content: string;
  onChange: (value: string) => void;
}

interface ParsedScene {
  elements: readonly object[];
  files: Record<string, unknown> | undefined;
}

// `create_item` cria o arquivo VAZIO — string vazia é canvas NOVO (cena em branco),
// não JSON corrompido. Corrompido de verdade → null (fallback read-only, sem crash).
function parseExcalidraw(content: string): ParsedScene | null {
  const trimmed = content.trim();
  if (trimmed === '') return { elements: [], files: undefined };
  try {
    const parsed = JSON.parse(trimmed) as { elements?: unknown; files?: Record<string, unknown> };
    return {
      elements: Array.isArray(parsed.elements) ? (parsed.elements as object[]) : [],
      files: parsed.files ?? undefined,
    };
  } catch {
    return null;
  }
}

export default function ExcalidrawEditor({ content, onChange }: ExcalidrawEditorProps) {
  const { activeTab, theme } = useAppStore();
  const filename = activeTab ? activeTab.split(/[\\/]/).pop() || '' : '';

  // Parse UMA vez por montagem (key={activeTab} no FileViewer garante remount por aba);
  // re-parsear a cada prop change criaria loop save→prop→remount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scene = useMemo(() => parseExcalidraw(content), []);

  const sceneVersionRef = useRef<number>(
    scene ? getSceneVersion(scene.elements as Parameters<typeof getSceneVersion>[0]) : 0
  );
  const notifiedRef = useRef(false);

  if (scene === null) {
    // Fail-soft de JSON corrompido (Spec 30 §2): conteúdo cru read-only + toast único
    if (!notifiedRef.current) {
      notifiedRef.current = true;
      useAppStore
        .getState()
        .notify('warning', 'Canvas com JSON inválido — exibindo o conteúdo cru (somente leitura).');
    }
    return (
      <div className="flex flex-col h-full w-full overflow-hidden">
        <Header filename={filename} badge="excalidraw · json inválido" />
        <div className="flex-shrink-0 text-xs text-[var(--text-muted)] mb-2 select-none">
          Visualização somente leitura. Para corrigir, edite o arquivo fora do app (ou renomeie para .json).
        </div>
        <pre
          data-testid="excalidraw-fallback"
          className="flex-1 min-h-0 overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--substrate-base)] p-4 text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap"
        >
          {content}
        </pre>
      </div>
    );
  }

  const handleChange = (...[elements, appState, files]: ExcalidrawOnChange) => {
    // Excalidraw dispara onChange até em pan/zoom/seleção — getSceneVersion só muda
    // quando ELEMENTOS mudam. Igual ⇒ ignora (zero write sem edição real).
    const version = getSceneVersion(elements);
    if (version === sceneVersionRef.current) return;
    sceneVersionRef.current = version;
    onChange(serializeAsJSON(elements, appState, files, 'local'));
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <Header filename={filename} badge="excalidraw" />
      <div
        data-testid="excalidraw-host"
        className="flex-1 min-h-0 rounded-lg overflow-hidden border border-[var(--border-subtle)]"
      >
        <Excalidraw
          initialData={{
            elements: scene.elements as never,
            files: scene.files as never,
            appState: { viewBackgroundColor: 'transparent' },
            scrollToContent: true,
          }}
          onChange={handleChange}
          theme={theme === 'light' ? 'light' : 'dark'}
          langCode="pt-BR"
        />
      </div>
    </div>
  );
}

function Header({ filename, badge }: { filename: string; badge: string }) {
  return (
    <div className="flex-shrink-0 flex items-center gap-2 mb-4 select-none pr-2">
      <Shapes className="w-5 h-5 text-[var(--accent-dim)] flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate text-[27px] font-display font-semibold text-[var(--text-primary)] py-1">
        {filename}
      </span>
      <span className="flex-shrink-0 rounded-md px-2 py-1 text-xs font-mono font-semibold uppercase border text-[var(--text-muted)] border-[var(--border-subtle)] bg-[var(--substrate-raised)]/50">
        {badge}
      </span>
    </div>
  );
}
