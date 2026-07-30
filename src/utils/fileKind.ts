// E5 (Spec 29): roteamento de abertura por extensão. Whitelist FECHADA de propósito —
// extensão desconhecida/binária nunca vira buffer de texto editável (vai pro app padrão).
export type FileKind = 'markdown' | 'text' | 'pdf' | 'external';

// Extensão → id de linguagem pro highlight do PlainTextEditor (null = texto puro).
// O carregamento das linguagens é lazy (src/editor/plainLanguages.ts).
const TEXT_LANGUAGES: Record<string, string | null> = {
  txt: null,
  log: null,
  csv: null,
  ini: null,
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rs: 'rust',
  sql: 'sql',
  sh: 'shell',
  toml: 'toml',
};

export function getExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() || '';
  const dot = name.lastIndexOf('.');
  // dot > 0: dotfiles (".gitignore") não têm "extensão" — caem em external
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function getFileKind(path: string): FileKind {
  const ext = getExtension(path);
  if (ext === 'md') return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (ext in TEXT_LANGUAGES) return 'text';
  return 'external';
}

export function getLanguageId(path: string): string | null {
  return TEXT_LANGUAGES[getExtension(path)] ?? null;
}
