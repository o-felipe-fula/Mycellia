// E5 (Spec 29): roteador do painel de conteúdo — ponto ÚNICO que decide qual editor/viewer
// monta pra aba ativa, por tipo de arquivo (utils/fileKind). Usado nos dois pontos de
// montagem do App (painel central e split direito).
import { useAppStore } from '../store/appStore';
import { getFileKind } from '../utils/fileKind';
import MarkdownEditor from './MarkdownEditor';
import PlainTextEditor from './PlainTextEditor';
import PdfViewer from './PdfViewer';

export default function FileViewer() {
  const { activeTab, activeNoteContent, activeContentPath, updateActiveNoteContent } =
    useAppStore();

  if (!activeTab) return null;
  const kind = getFileKind(activeTab);

  if (kind === 'pdf') {
    return <PdfViewer path={activeTab} />;
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
