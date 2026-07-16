// E1.5 (Spec 26) — Slash menu + autocomplete de tipo de callout: as fontes são testadas
// direto contra EditorState/CompletionContext reais; a inserção do snippet roda num
// EditorView real em jsdom (byte-a-byte no buffer).
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete';
import { slashMenuCompletion, calloutTypeCompletion } from '../editor/slashMenu';

function contextAt(doc: string, pos: number): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, false);
}

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

describe('Slash menu (E1.5)', () => {
  it('dispara com "/" no começo de linha vazia e lista os blocos', () => {
    const result = slashMenuCompletion(contextAt('/', 1)) as CompletionResult;
    expect(result).not.toBeNull();
    const labels = result.options.map((o) => o.label);
    expect(labels).toContain('Callout — Dica');
    expect(labels).toContain('Tabela');
    expect(labels).toContain('Checklist');
    expect(labels).toContain('Diagrama (Mermaid)');
    expect(labels).toContain('Título 1');
  });

  it('dispara com "/" indentada e com prefixo digitado', () => {
    const doc = '  /dica';
    const result = slashMenuCompletion(contextAt(doc, doc.length));
    expect(result).not.toBeNull();
  });

  it('NÃO dispara com "/" no meio de texto', () => {
    const doc = 'metade / caminho';
    expect(slashMenuCompletion(contextAt(doc, 8))).toBeNull();
  });

  it('NÃO dispara em linha com conteúdo antes da barra', () => {
    const doc = 'texto /';
    expect(slashMenuCompletion(contextAt(doc, doc.length))).toBeNull();
  });

  it('aplicar "Título 1" substitui a barra pelo snippet (a "/" não sobra)', () => {
    view = new EditorView({
      state: EditorState.create({ doc: '/', selection: { anchor: 1 } }),
      parent: document.body,
    });

    const result = slashMenuCompletion(new CompletionContext(view.state, 1, false)) as CompletionResult;
    const option = result.options.find((o) => o.label === 'Título 1') as Completion;
    (option.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(
      view, option, result.from, 1,
    );

    expect(view.state.doc.toString()).toBe('# Título');
  });

  it('aplicar "Callout — Dica" insere o esqueleto do callout', () => {
    view = new EditorView({
      state: EditorState.create({ doc: '/', selection: { anchor: 1 } }),
      parent: document.body,
    });

    const result = slashMenuCompletion(new CompletionContext(view.state, 1, false)) as CompletionResult;
    const option = result.options.find((o) => o.label === 'Callout — Dica') as Completion;
    (option.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(
      view, option, result.from, 1,
    );

    expect(view.state.doc.toString()).toBe('> [!tip] Título\n> Conteúdo');
  });
});

describe('Autocomplete de tipo de callout (E1.5)', () => {
  it('dispara com "> [!" e lista os 13 tipos', () => {
    const doc = '> [!';
    const result = calloutTypeCompletion(contextAt(doc, doc.length)) as CompletionResult;
    expect(result).not.toBeNull();
    expect(result.options.length).toBe(13);
    const labels = result.options.map((o) => o.label);
    expect(labels).toContain('tip');
    expect(labels).toContain('warning');
    expect(labels).toContain('quote');
  });

  it('completa fechando o colchete: apply = "tipo] "', () => {
    const doc = '> [!wa';
    const result = calloutTypeCompletion(contextAt(doc, doc.length)) as CompletionResult;
    expect(result.from).toBe(doc.length - 2); // começo do "wa"
    const warning = result.options.find((o) => o.label === 'warning') as Completion;
    expect(warning.apply).toBe('warning] ');
  });

  it('dispara em callout aninhado ("> > [!")', () => {
    const doc = '> > [!';
    expect(calloutTypeCompletion(contextAt(doc, doc.length))).not.toBeNull();
  });

  it('NÃO dispara fora de blockquote', () => {
    const doc = 'texto [!';
    expect(calloutTypeCompletion(contextAt(doc, doc.length))).toBeNull();
  });
});
