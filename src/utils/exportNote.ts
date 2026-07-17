// Exportação de nota (E6 — trilha E): render do markdown pra HTML standalone (marked +
// DOMPurify + CSS embutido, print-friendly), salvar como .html (dialog + export_text_file)
// e imprimir/PDF (iframe isolado → print do SO, de onde dá pra "Salvar como PDF").
// v1: wiki-links viram texto simples, mermaid/callout saem como código/citação (documentado).
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const md = new Marked({ gfm: true, breaks: true, async: false });

const PURIFY = {
  ALLOWED_TAGS: [
    'a', 'p', 'br', 'hr', 'em', 'strong', 'del', 's', 'u', 'mark', 'sub', 'sup',
    'kbd', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'input',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'span', 'div', 'small', 'ins',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'type', 'checked', 'disabled', 'start', 'colspan', 'rowspan', 'align'],
  ALLOW_DATA_ATTR: false,
};

// CSS embutido: tipografia legível, tema claro (bom pra papel/PDF), coluna centrada
const EXPORT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; line-height: 1.65;
    color: #1a1a1a; max-width: 760px; margin: 40px auto; padding: 0 24px; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.5em; font-weight: 700; }
  h1 { font-size: 2em; border-bottom: 1px solid #e2e2e2; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.2em; }
  p { margin: 0.7em 0; }
  a { color: #098056; }
  code { font-family: 'SF Mono', 'JetBrains Mono', monospace; font-size: 0.9em;
    background: #f3f4f3; border: 1px solid #e5e7e5; border-radius: 4px; padding: 1px 5px; }
  pre { background: #f6f8f6; border: 1px solid #e5e7e5; border-radius: 8px; padding: 14px 16px; overflow-x: auto; }
  pre code { background: none; border: none; padding: 0; }
  blockquote { border-left: 3px solid #5dc4a1; margin: 0.8em 0; padding: 0.2em 1em; color: #555; background: #f7faf8; }
  table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f3f4f3; }
  img { max-width: 100%; border-radius: 6px; }
  hr { border: none; border-top: 1px solid #e2e2e2; margin: 1.5em 0; }
  ul, ol { padding-left: 1.6em; }
  @media print { body { margin: 0; max-width: none; } a { color: #1a1a1a; text-decoration: none; } }
`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// v1: [[Nota|alias]] / [[Nota#H]] viram texto legível (alias, ou nome sem o path/#)
function flattenWikiLinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_m, target: string, alias?: string) => {
    if (alias) return alias.trim();
    const t = target.trim();
    const hash = t.indexOf('#');
    return hash === -1 ? t : t.slice(0, hash).trim() || t.slice(hash + 1).trim();
  });
}

export function renderNoteToHtml(markdown: string, title: string): string {
  const body = md.parse(flattenWikiLinks(markdown)) as string;
  const clean = DOMPurify.sanitize(body, PURIFY);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${clean}
</body>
</html>`;
}

// Salva o HTML num caminho escolhido pelo usuário (dialog + comando Rust de escrita atômica)
export async function exportNoteAsHtml(markdown: string, title: string): Promise<'saved' | 'cancelled'> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');

  const path = await save({
    defaultPath: `${title}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!path) return 'cancelled';

  const html = renderNoteToHtml(markdown, title);
  await invoke('export_text_file', { path, content: html });
  return 'saved';
}

// Imprime via iframe isolado — o diálogo do SO permite "Salvar como PDF"
export function printNote(markdown: string, title: string): void {
  const html = renderNoteToHtml(markdown, title);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');

  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
    // Remove após o diálogo (o print é síncrono; folga extra pra webviews lentas)
    window.setTimeout(() => iframe.remove(), 1000);
  };

  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}
