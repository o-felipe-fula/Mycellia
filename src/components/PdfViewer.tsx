// E5 (Spec 29): viewer de PDF read-only — o WebView2 (Chromium) renderiza PDF nativo no
// iframe. O arquivo NUNCA passa por read_file (é binário; read_to_string falharia): o src
// vem do asset protocol, cujo escopo do vault é concedido dinamicamente no load_vault_tree
// (hotfix §27 do Registro).
import { convertFileSrc } from '@tauri-apps/api/core';
import { FileText } from 'lucide-react';

interface PdfViewerProps {
  path: string;
}

export default function PdfViewer({ path }: PdfViewerProps) {
  const filename = path.split(/[\\/]/).pop() || '';

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Header fixo: nome do arquivo + badge (sem rename — viewer é read-only) */}
      <div className="flex-shrink-0 flex items-center gap-2 mb-4 select-none pr-2">
        <FileText className="w-5 h-5 text-[var(--accent-dim)] flex-shrink-0" />
        <span className="flex-1 min-w-0 truncate text-[27px] font-display font-semibold text-[var(--text-primary)] py-1">
          {filename}
        </span>
        <span className="flex-shrink-0 rounded-md px-2 py-1 text-xs font-mono font-semibold uppercase border text-[var(--text-muted)] border-[var(--border-subtle)] bg-[var(--substrate-raised)]/50">
          pdf
        </span>
      </div>

      <div className="flex-1 min-h-0 rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--substrate-base)]">
        <iframe
          src={convertFileSrc(path)}
          title={filename}
          data-testid="pdf-viewer-frame"
          className="w-full h-full border-0"
        />
      </div>
    </div>
  );
}
