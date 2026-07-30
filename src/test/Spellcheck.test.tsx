// E3 (Spec 32): corretor ortográfico — tokenização pura (máscaras/ignores) +
// integração no editor (viewport → check em lote no Rust mockado → decoração
// .cm-spell-error) + toggle limpa + cache não repete vocabulário já vereditado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';
import {
  checkableWordsInLine,
  frontmatterEnd,
  clearSpellCache,
  clearSessionIgnored,
  spellcheckExtension,
  spellcheckToggled,
} from '../editor/spellcheck';

// Vocabulário "conhecido" do mock do motor Rust (o resto reprova)
const KNOWN = new Set(['palavra', 'texto', 'aqui', 'veja', 'agora', 'corpo', 'dentro', 'fora']);
// Dicionário pessoal simulado (add_personal_word escreve aqui)
const personalMock = new Set<string>();

function mockCheckWords(suggestions: string[] = []) {
  vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
    if (cmd === 'check_words') {
      const { words } = args as { words: string[] };
      return words.map((w) => KNOWN.has(w.toLowerCase()) || personalMock.has(w.toLowerCase()));
    }
    if (cmd === 'suggest_word') return suggestions;
    if (cmd === 'add_personal_word') {
      personalMock.add((args as { word: string }).word.toLowerCase());
      return undefined;
    }
    return undefined; // spellcheck_warmup etc.
  });
}

let view: EditorView | null = null;

function createView(doc: string) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: [GFM] }), ...spellcheckExtension()],
    }),
    parent: document.body,
  });
  return view;
}

describe('E3 — corretor ortográfico', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    clearSpellCache();
    clearSessionIgnored();
    personalMock.clear();
    useAppStore.setState({ spellcheckEnabled: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.querySelector('.mycellia-spellmenu')?.remove();
    view?.destroy();
    view = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('tokenizador: mascara código, wiki-link, URL de link md, URL crua, hashtag, dígito e sigla', () => {
    const line = 'texto `codigo` [[Wiki Link|apelido]] veja [aqui](https://foo.com/x) #tag v0.7 NASA https://bar.com fim';
    const words = checkableWordsInLine(line, 0).map((s) => s.word);
    expect(words).toEqual(['texto', 'veja', 'aqui', 'fim']);
  });

  it('tokenizador: offsets absolutos corretos (inclusive com acento multi-byte)', () => {
    const line = 'olá coraçao';
    const spans = checkableWordsInLine(line, 100);
    expect(spans).toEqual([
      { word: 'olá', from: 100, to: 103 },
      { word: 'coraçao', from: 104, to: 111 },
    ]);
  });

  it('frontmatterEnd: detecta o range do YAML no topo (e 0 sem frontmatter)', () => {
    const withFm = EditorState.create({ doc: '---\ntitle: x\n---\ncorpo' });
    expect(frontmatterEnd(withFm)).toBe('---\ntitle: x\n---'.length);
    const without = EditorState.create({ doc: 'corpo normal\n---\n' });
    expect(frontmatterEnd(without)).toBe(0);
  });

  it('integração: palavra desconhecida ganha .cm-spell-error; conhecidas não', async () => {
    mockCheckWords();
    const v = createView('palavra errrada aqui');

    await vi.advanceTimersByTimeAsync(400);

    const marks = v.dom.querySelectorAll('.cm-spell-error');
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('errrada');
  });

  it('integração: erro dentro de fence de código NÃO é marcado (isRangeInCode)', async () => {
    mockCheckWords();
    const v = createView('```\nerrrada dentro\n```\nerrrada fora');

    await vi.advanceTimersByTimeAsync(400);

    const marks = v.dom.querySelectorAll('.cm-spell-error');
    expect(marks.length).toBe(1); // só a de fora do fence
  });

  it('toggle: desligar limpa as decorações; religar volta a marcar', async () => {
    mockCheckWords();
    const v = createView('palavra errrada');
    await vi.advanceTimersByTimeAsync(400);
    expect(v.dom.querySelectorAll('.cm-spell-error').length).toBe(1);

    useAppStore.setState({ spellcheckEnabled: false });
    v.dispatch({ effects: spellcheckToggled.of() });
    await vi.advanceTimersByTimeAsync(400);
    expect(v.dom.querySelectorAll('.cm-spell-error').length).toBe(0);

    useAppStore.setState({ spellcheckEnabled: true });
    v.dispatch({ effects: spellcheckToggled.of() });
    await vi.advanceTimersByTimeAsync(400);
    expect(v.dom.querySelectorAll('.cm-spell-error').length).toBe(1);
  });

  it('cache: vocabulário já vereditado não volta pro Rust (lote só com palavra nova)', async () => {
    mockCheckWords();
    const v = createView('palavra errrada');
    await vi.advanceTimersByTimeAsync(400);

    const callsBefore = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === 'check_words').length;
    expect(callsBefore).toBe(1);

    // digita mais uma palavra CONHECIDA nova no fim
    v.dispatch({ changes: { from: v.state.doc.length, insert: ' texto' } });
    await vi.advanceTimersByTimeAsync(400);

    const checkCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'check_words');
    expect(checkCalls.length).toBe(2);
    // o segundo lote NÃO repete 'palavra'/'errrada' — só o vocabulário novo
    expect((checkCalls[1][1] as { words: string[] }).words).toEqual(['texto']);
  });

  it('menu de contexto: sugestão substitui a palavra no doc (pipeline normal de edição)', async () => {
    mockCheckWords(['errada', 'errado']);
    const v = createView('palavra errrada aqui');
    await vi.advanceTimersByTimeAsync(400);

    fireEvent.contextMenu(v.dom.querySelector('.cm-spell-error')!, { clientX: 10, clientY: 10 });
    const menu = document.querySelector('.mycellia-spellmenu');
    expect(menu).toBeTruthy();
    // sugestões chegam async
    await vi.advanceTimersByTimeAsync(10);
    const sugs = document.querySelectorAll('.mycellia-spellmenu-suggestion');
    expect([...sugs].map((b) => b.textContent)).toEqual(['errada', 'errado']);

    fireEvent.mouseDown(sugs[0]);
    expect(v.state.doc.toString()).toBe('palavra errada aqui');
    expect(document.querySelector('.mycellia-spellmenu')).toBeNull(); // menu fechou
  });

  it('menu: "Adicionar ao dicionário" persiste no Rust e a marcação some', async () => {
    mockCheckWords();
    const v = createView('palavra errrada');
    await vi.advanceTimersByTimeAsync(400);

    fireEvent.contextMenu(v.dom.querySelector('.cm-spell-error')!, { clientX: 10, clientY: 10 });
    fireEvent.mouseDown(document.querySelector('.mycellia-spellmenu-add')!);
    await vi.advanceTimersByTimeAsync(400); // add async + re-check com cache limpo

    const addCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'add_personal_word');
    expect((addCall![1] as { word: string }).word).toBe('errrada');
    expect(v.dom.querySelectorAll('.cm-spell-error').length).toBe(0);
  });

  it('menu: "Ignorar nesta sessão" limpa a marcação sem tocar o Rust', async () => {
    mockCheckWords();
    const v = createView('palavra errrada');
    await vi.advanceTimersByTimeAsync(400);

    fireEvent.contextMenu(v.dom.querySelector('.cm-spell-error')!, { clientX: 10, clientY: 10 });
    fireEvent.mouseDown(document.querySelector('.mycellia-spellmenu-ignore')!);
    await vi.advanceTimersByTimeAsync(400);

    expect(v.dom.querySelectorAll('.cm-spell-error').length).toBe(0);
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === 'add_personal_word')).toBe(false);
  });

  it('menu: Esc fecha sem agir', async () => {
    mockCheckWords();
    const v = createView('palavra errrada');
    await vi.advanceTimersByTimeAsync(400);

    fireEvent.contextMenu(v.dom.querySelector('.cm-spell-error')!, { clientX: 10, clientY: 10 });
    expect(document.querySelector('.mycellia-spellmenu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.mycellia-spellmenu')).toBeNull();
    expect(v.state.doc.toString()).toBe('palavra errrada'); // nada mudou
  });

  it('persistência: toggleSpellcheck grava spellcheck_enabled no config', () => {
    vi.mocked(invoke).mockResolvedValue(undefined as never);
    useAppStore.setState({ spellcheckEnabled: true });
    useAppStore.getState().toggleSpellcheck();

    expect(useAppStore.getState().spellcheckEnabled).toBe(false);
    const saveCall = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === 'save_config');
    expect(saveCall).toBeTruthy();
    expect((saveCall![1] as { config: { spellcheck_enabled: boolean } }).config.spellcheck_enabled).toBe(false);
  });
});
