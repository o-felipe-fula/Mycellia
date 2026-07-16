// E1.5 (Spec 26) — Toolbar flutuante de seleção: bolha aparece/some com a seleção e as
// ações mutam o buffer byte a byte (toggle aplica E remove). EditorView real em jsdom.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { selectionToolbar, toggleInline, toggleQuote, toCallout } from '../editor/selectionToolbar';

// FLAKE-guard (padrão FLAKE-02): tooltips do CM montam no ciclo de medição (rAF) —
// espera ativa folgada em vez de sleep fixo.
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

let view: EditorView;

function createView(doc: string) {
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [selectionToolbar()] }),
    parent: document.body,
  });
  return view;
}

afterEach(() => {
  view?.destroy();
});

describe('Toolbar de seleção (E1.5)', () => {
  it('não aparece sem seleção e aparece quando algo é selecionado', async () => {
    createView('Linha um\nLinha dois');
    expect(document.querySelector('.mycellia-seltoolbar')).toBeNull();

    view.dispatch({ selection: { anchor: 0, head: 5 } });
    await waitFor(() => {
      expect(document.querySelector('.mycellia-seltoolbar')).not.toBeNull();
    });

    // Colapsou a seleção → bolha some
    view.dispatch({ selection: { anchor: 0 } });
    await waitFor(() => {
      expect(document.querySelector('.mycellia-seltoolbar')).toBeNull();
    });
  });

  it('clicar em Negrito na bolha embrulha a seleção com **', async () => {
    createView('Linha um');
    view.dispatch({ selection: { anchor: 0, head: 5 } });

    let btn: HTMLButtonElement;
    await waitFor(() => {
      btn = document.querySelector('.mycellia-seltoolbar button[title="Negrito"]') as HTMLButtonElement;
      expect(btn).not.toBeNull();
    });

    btn!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe('**Linha** um');
  });

  it('toggleInline aplica e REMOVE (negrito idempotente)', () => {
    createView('palavra aqui');
    view.dispatch({ selection: { anchor: 0, head: 7 } });

    toggleInline(view, '**', '**');
    expect(view.state.doc.toString()).toBe('**palavra** aqui');

    // A seleção ficou no miolo; segundo toggle detecta o par em volta e remove
    toggleInline(view, '**', '**');
    expect(view.state.doc.toString()).toBe('palavra aqui');
  });

  it('destaque e sublinhado usam as tags HTML do E1', () => {
    createView('destacar isto');
    view.dispatch({ selection: { anchor: 0, head: 8 } });

    toggleInline(view, '<mark>', '</mark>');
    expect(view.state.doc.toString()).toBe('<mark>destacar</mark> isto');

    toggleInline(view, '<mark>', '</mark>');
    expect(view.state.doc.toString()).toBe('destacar isto');
  });

  it('toggleQuote prefixa as linhas selecionadas com "> " e remove no segundo toque', () => {
    createView('primeira linha\nsegunda linha');
    view.dispatch({ selection: { anchor: 2, head: 20 } });

    toggleQuote(view);
    expect(view.state.doc.toString()).toBe('> primeira linha\n> segunda linha');

    toggleQuote(view);
    expect(view.state.doc.toString()).toBe('primeira linha\nsegunda linha');
  });

  it('toCallout transforma a seleção em callout com a seleção virando corpo', () => {
    createView('um fato importante\noutra linha');
    view.dispatch({ selection: { anchor: 0, head: 18 } });

    toCallout(view);
    expect(view.state.doc.toString()).toBe('> [!note] \n> um fato importante\noutra linha');
    // Cursor posicionado no título, pronto pra digitar
    expect(view.state.selection.main.head).toBe('> [!note] '.length);
  });

  it('selecionar sem clicar em nada NÃO muda o documento', async () => {
    createView('texto intocado');
    view.dispatch({ selection: { anchor: 0, head: 14 } });

    await waitFor(() => {
      expect(document.querySelector('.mycellia-seltoolbar')).not.toBeNull();
    });

    expect(view.state.doc.toString()).toBe('texto intocado');
  });
});
