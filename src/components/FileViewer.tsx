// E5 (Spec 29): roteador do painel de conteúdo — ponto ÚNICO que decide qual editor/viewer
// monta pra aba ativa, por tipo de arquivo (utils/fileKind). Usado nos dois pontos de
// montagem do App (painel central e split direito).
import { lazy, Suspense } from 'react';
import { useAppStore } from '../store/appStore';
import { getFileKind } from '../utils/fileKind';
import MarkdownEditor from './MarkdownEditor';
import PlainTextEditor from './PlainTextEditor';
import PdfViewer from './PdfViewer';

// E4 (Spec 30): superfícies de canvas são lazy — o app não paga o peso sem abrir canvas
const CanvasEditor = lazy(() => import('./CanvasEditor'));
const ExcalidrawEditor = lazy(() => import('./ExcalidrawEditor'));

export default function FileViewer() {
  const { activeTab, activeNoteContent, activeContentPath, updateActiveNoteContent } =
    useAppStore();

  if (!activeTab) return null;
  const kind = getFileKind(activeTab);

  if (kind === 'pdf') {
    return <PdfViewer path={activeTab} />;
  }

  if (kind === 'canvas') {
    // E4.3 (Spec 31): .canvas virou EDITÁVEL — mesmo gate/fiação do Excalidraw (conteúdo
    // real da aba + key por aba ⇒ parse 1x por abertura, save pelo pipeline sagrado)
    if (activeNoteContent === null || activeContentPath !== activeTab) return null;
    return (
      <Suspense fallback={null}>
        <CanvasEditor key={activeTab} content={activeNoteContent} onChange={updateActiveNoteContent} />
      </Suspense>
    );
  }

  if (kind === 'excalidraw') {
    // Mesmo gate do PlainTextEditor (conteúdo REAL da aba carregado) + key por aba:
    // o parse do arquivo acontece uma vez por abertura — o estado canônico vive dentro
    // do Excalidraw, e remontar por aba elimina qualquer janela de sync stale.
    if (activeNoteContent === null || activeContentPath !== activeTab) return null;
    return (
      <Suspense fallback={null}>
        <ExcalidrawEditor key={activeTab} content={activeNoteContent} onChange={updateActiveNoteContent} />
      </Suspense>
    );
  }

  if (kind === 'text') {
    // Só monta com o conteúdo REAL da aba já carregado (activeContentPath): montar com
    // conteúdo stale da aba anterior quebraria a detecção de EOL e reabriria a janela de
    // corrupção do BUG-08 no editor novo.
    if (activeNoteContent === null || activeContentPath !== activeTab) return null;
    return <PlainTextEditor content={activeNoteContent} onChange={updateActiveNoteContent} />;
  }

  if (kind === 'markdown') {
    // Semântica pré-E5 preservada byte a byte (gate por activeNoteContent apenas)
    if (activeNoteContent === null) return null;
    return <MarkdownEditor content={activeNoteContent} onChange={updateActiveNoteContent} />;
  }

  // 'external' nunca vira aba (FileTree manda pro app padrão) — safety net
  return null;
}
