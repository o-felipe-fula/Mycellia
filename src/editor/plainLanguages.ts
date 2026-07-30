// E5 (Spec 29): carregamento LAZY das linguagens do PlainTextEditor — cada pacote de
// linguagem só entra em memória quando um arquivo daquele tipo é aberto (import dinâmico;
// o Vite gera chunks separados). Ids vêm de utils/fileKind.ts (getLanguageId).
import type { Extension } from '@codemirror/state';

export async function loadLanguage(id: string): Promise<Extension | null> {
  switch (id) {
    case 'json':
      return (await import('@codemirror/lang-json')).json();
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml();
    case 'xml':
      return (await import('@codemirror/lang-xml')).xml();
    case 'html':
      return (await import('@codemirror/lang-html')).html();
    case 'css':
      return (await import('@codemirror/lang-css')).css();
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true });
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true });
    case 'python':
      return (await import('@codemirror/lang-python')).python();
    case 'rust':
      return (await import('@codemirror/lang-rust')).rust();
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql();
    case 'toml': {
      const { StreamLanguage } = await import('@codemirror/language');
      const { toml } = await import('@codemirror/legacy-modes/mode/toml');
      return StreamLanguage.define(toml);
    }
    case 'shell': {
      const { StreamLanguage } = await import('@codemirror/language');
      const { shell } = await import('@codemirror/legacy-modes/mode/shell');
      return StreamLanguage.define(shell);
    }
    default:
      return null;
  }
}
