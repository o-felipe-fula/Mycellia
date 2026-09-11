// Slash menu + autocomplete de tipo de callout (E1.5 — Spec 26). A UI digita a sintaxe
// markdown PELO usuário (facilidade Notion sem virar Notion): `/` no começo da linha abre
// o menu de blocos; `> [!` completa o tipo do callout. Toda inserção via snippet/apply do
// autocomplete do CM — mesmo canal byte-a-byte do resto do editor. Nada de save aqui.
import { snippet } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import i18n from '../i18n';

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

// D0 (Spec 33): a lista nasce POR INVOCAÇÃO — labels e placeholders dos snippets
// seguem o idioma vivo (recriar o array a cada `/` custa nada e evita label stale)
const CALLOUT_SLASH_ORDER: Array<[string, number]> = [
  ['tip', 3],
  ['note', 2],
  ['info', 0],
  ['warning', 1],
  ['danger', 0],
  ['success', 0],
  ['question', 0],
  ['example', 0],
  ['quote', 0],
];

function slashItems(): Completion[] {
  const t = (key: string, opts?: Record<string, string>) => i18n.t(key, opts);
  const ph = (key: string) => '${' + t(key) + '}';
  return [
    ...CALLOUT_SLASH_ORDER.map(([key, boost]) =>
      slashItem(
        t('slash.calloutLabel', { name: t(`slash.calloutName.${key}`) }),
        key,
        `> [!${key}] ` + ph('slash.phTitle') + '\n> ' + ph('slash.phContent'),
        boost
      )
    ),
    slashItem(t('slash.h1'), '#', '# ' + ph('slash.phTitle')),
    slashItem(t('slash.h2'), '##', '## ' + ph('slash.phTitle')),
    slashItem(t('slash.h3'), '###', '### ' + ph('slash.phTitle')),
    slashItem(t('slash.list'), '-', '- ' + ph('slash.phItem')),
    slashItem(t('slash.numberedList'), '1.', '1. ' + ph('slash.phItem')),
    slashItem(t('slash.checklist'), '- [ ]', '- [ ] ' + ph('slash.phTask'), 2),
    slashItem(t('slash.table'), 'md', '| ' + ph('slash.phCol1') + ' | ' + t('slash.phCol2') + ' |\n| --- | --- |\n| ${} |  |', 1),
    slashItem(t('slash.codeBlock'), '```', '```' + ph('slash.phLanguage') + '\n${}\n```'),
    slashItem(t('slash.mermaid'), 'mermaid', '```mermaid\nflowchart TD\n  ${A} --> ${B}\n```', 1),
    slashItem(t('slash.quote'), '>', '> ${}'),
    slashItem(t('slash.divider'), '---', '---\n${}'),
  ];
}

export function slashMenuCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  // Só no começo da linha (indentação permitida) — `/` no meio de texto é texto.
  const match = before.match(/^(\s*)\/([\wÀ-ɏ-]*)$/);
  if (!match) return null;

  const slashPos = line.from + match[1].length;
  return {
    from: slashPos + 1,
    options: slashItems(),
    validFor: /^[\wÀ-ɏ-]*$/,
  };
}

// ---------------------------------------------------------------------------
// Autocomplete de tipo de callout (`> [!`)
// ---------------------------------------------------------------------------

// D0 (Spec 33): o nome exibido vem do i18n (slash.calloutName.*) por invocação
const CALLOUT_TYPE_KEYS = [
  'note', 'tip', 'info', 'warning', 'danger', 'success', 'question',
  'example', 'quote', 'abstract', 'todo', 'failure', 'bug',
] as const;

export function calloutTypeCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const match = before.match(/^\s*(?:>\s*)+\[!([a-zA-Z]*)$/);
  if (!match) return null;

  return {
    from: context.pos - match[1].length,
    options: CALLOUT_TYPE_KEYS.map((key) => ({
      label: key,
      detail: i18n.t(`slash.calloutName.${key}`),
      apply: `${key}] `,
    })),
    validFor: /^[a-zA-Z]*$/,
  };
}
