// Slash menu + autocomplete de tipo de callout (E1.5 — Spec 26). A UI digita a sintaxe
// markdown PELO usuário (facilidade Notion sem virar Notion): `/` no começo da linha abre
// o menu de blocos; `> [!` completa o tipo do callout. Toda inserção via snippet/apply do
// autocomplete do CM — mesmo canal byte-a-byte do resto do editor. Nada de save aqui.
import { snippet } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';

// ---------------------------------------------------------------------------
// Slash menu — blocos
// ---------------------------------------------------------------------------

// O `from` do resultado fica DEPOIS da barra (pro filtro casar com o que o usuário digita);
// o apply recua 1 pra engolir a `/` junto.
const slashItem = (label: string, detail: string, template: string, boost = 0): Completion => ({
  label,
  detail,
  boost,
  apply: (view: EditorView, completion: Completion, from: number, to: number) => {
    snippet(template)(view, completion, from - 1, to);
  },
});

const SLASH_ITEMS: Completion[] = [
  slashItem('Callout — Dica', 'tip', '> [!tip] ${Título}\n> ${Conteúdo}', 3),
  slashItem('Callout — Nota', 'note', '> [!note] ${Título}\n> ${Conteúdo}', 2),
  slashItem('Callout — Info', 'info', '> [!info] ${Título}\n> ${Conteúdo}'),
  slashItem('Callout — Atenção', 'warning', '> [!warning] ${Título}\n> ${Conteúdo}', 1),
  slashItem('Callout — Perigo', 'danger', '> [!danger] ${Título}\n> ${Conteúdo}'),
  slashItem('Callout — Sucesso', 'success', '> [!success] ${Título}\n> ${Conteúdo}'),
  slashItem('Callout — Pergunta', 'question', '> [!question] ${Título}\n> ${Conteúdo}'),
  slashItem('Callout — Exemplo', 'example', '> [!example] ${Título}\n> ${Conteúdo}'),
  slashItem('Callout — Citação', 'quote', '> [!quote] ${Título}\n> ${Conteúdo}'),
  slashItem('Título 1', '#', '# ${Título}'),
  slashItem('Título 2', '##', '## ${Título}'),
  slashItem('Título 3', '###', '### ${Título}'),
  slashItem('Lista', '-', '- ${item}'),
  slashItem('Lista numerada', '1.', '1. ${item}'),
  slashItem('Checklist', '- [ ]', '- [ ] ${tarefa}', 2),
  slashItem('Tabela', 'md', '| ${Coluna 1} | Coluna 2 |\n| --- | --- |\n| ${} |  |', 1),
  slashItem('Bloco de código', '```', '```${linguagem}\n${}\n```'),
  slashItem('Diagrama (Mermaid)', 'mermaid', '```mermaid\nflowchart TD\n  ${A} --> ${B}\n```', 1),
  slashItem('Citação', '>', '> ${}'),
  slashItem('Divisor', '---', '---\n${}'),
];

export function slashMenuCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  // Só no começo da linha (indentação permitida) — `/` no meio de texto é texto.
  const match = before.match(/^(\s*)\/([\wÀ-ɏ-]*)$/);
  if (!match) return null;

  const slashPos = line.from + match[1].length;
  return {
    from: slashPos + 1,
    options: SLASH_ITEMS,
    validFor: /^[\wÀ-ɏ-]*$/,
  };
}

// ---------------------------------------------------------------------------
// Autocomplete de tipo de callout (`> [!`)
// ---------------------------------------------------------------------------

const CALLOUT_TYPES: Array<{ key: string; pt: string }> = [
  { key: 'note', pt: 'Nota' },
  { key: 'tip', pt: 'Dica' },
  { key: 'info', pt: 'Info' },
  { key: 'warning', pt: 'Atenção' },
  { key: 'danger', pt: 'Perigo' },
  { key: 'success', pt: 'Sucesso' },
  { key: 'question', pt: 'Pergunta' },
  { key: 'example', pt: 'Exemplo' },
  { key: 'quote', pt: 'Citação' },
  { key: 'abstract', pt: 'Resumo' },
  { key: 'todo', pt: 'A fazer' },
  { key: 'failure', pt: 'Falha' },
  { key: 'bug', pt: 'Bug' },
];

export function calloutTypeCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const match = before.match(/^\s*(?:>\s*)+\[!([a-zA-Z]*)$/);
  if (!match) return null;

  return {
    from: context.pos - match[1].length,
    options: CALLOUT_TYPES.map((t) => ({
      label: t.key,
      detail: t.pt,
      apply: `${t.key}] `,
    })),
    validFor: /^[a-zA-Z]*$/,
  };
}
