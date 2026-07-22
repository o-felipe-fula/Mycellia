// E5 (Spec 29) — PlainTextEditor: editor mínimo de não-md. Garante que (a) o sync externo
// de conteúdo NÃO dispara onChange (zero-write na troca de aba) nem entra no undo (mesma
// classe do BUG-08), e (b) arquivo CRLF emite \r\n no onChange (lineSeparator — linhas não
// editadas ficam byte-idênticas no save).
import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorView } from '@codemirror/view';
import PlainTextEditor from '../components/PlainTextEditor';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

const getView = (container: HTMLElement): EditorView => {
  const dom = container.querySelector('.cm-editor') as HTMLElement;
  const view = EditorView.findFromDOM(dom);
  if (!view) throw new Error('EditorView não encontrado no DOM');
  return view;
};

describe('PlainTextEditor (E5 — Spec 29)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async () => undefined);
    useAppStore.setState({
      activeTab: 'C:\\Vault\\config.json',
      openTabs: ['C:\\Vault\\config.json'],
      currentVault: 'C:\\Vault',
      activeNoteContent: '{"a": 1}',
      activeContentPath: 'C:\\Vault\\config.json',
    });
  });

  it('mostra o nome sem extensão no título e a extensão no badge', async () => {
    const { container } = render(<PlainTextEditor content={'{"a": 1}'} onChange={vi.fn()} />);
    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Sem título') as HTMLInputElement;
    expect(input.value).toBe('config');
    expect(screen.getByText('json')).toBeInTheDocument();
  });

  it('sync externo de conteúdo NÃO dispara onChange (zero-write na troca de aba)', async () => {
    const onChangeSpy = vi.fn();
    const { container, rerender } = render(
      <PlainTextEditor content={'conteudo antigo'} onChange={onChangeSpy} />,
    );
    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeInTheDocument();
    });

    rerender(<PlainTextEditor content={'conteudo novo'} onChange={onChangeSpy} />);
    await waitFor(() => {
      expect(container.querySelector('.cm-content')!.textContent).toContain('conteudo novo');
    });

    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it('Ctrl+Z não desfaz o sync externo (proteção classe BUG-08)', async () => {
    const onChangeSpy = vi.fn();
    const { container, rerender } = render(
      <PlainTextEditor content={'CONTEUDO DA ABA ANTERIOR'} onChange={onChangeSpy} />,
    );
    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeInTheDocument();
    });

    rerender(<PlainTextEditor content={'conteudo novo'} onChange={onChangeSpy} />);
    await waitFor(() => {
      expect(container.querySelector('.cm-content')!.textContent).toContain('conteudo novo');
    });

    const cmContent = container.querySelector('.cm-content') as HTMLElement;
    fireEvent.keyDown(cmContent, { key: 'z', ctrlKey: true });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(container.querySelector('.cm-content')!.textContent).toContain('conteudo novo');
    expect(container.querySelector('.cm-content')!.textContent).not.toContain('ABA ANTERIOR');
    expect(onChangeSpy).not.toHaveBeenCalledWith('CONTEUDO DA ABA ANTERIOR');
  });

  it('arquivo CRLF: edição emite onChange com \\r\\n preservado (lineSeparator)', async () => {
    const onChangeSpy = vi.fn();
    const crlf = 'linha1\r\nlinha2';
    useAppStore.setState({
      activeTab: 'C:\\Vault\\notas.txt',
      activeNoteContent: crlf,
      activeContentPath: 'C:\\Vault\\notas.txt',
    });

    const { container } = render(<PlainTextEditor content={crlf} onChange={onChangeSpy} />);
    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeInTheDocument();
    });

    // Edição "de usuário" (transação sem annotation de sync): prefixa X na primeira linha
    const view = getView(container);
    view.dispatch({ changes: { from: 0, insert: 'X' } });

    await waitFor(() => {
      expect(onChangeSpy).toHaveBeenCalled();
    });
    expect(onChangeSpy).toHaveBeenLastCalledWith('Xlinha1\r\nlinha2');
  });

  it('arquivo LF puro segue emitindo \\n (separador não é forçado)', async () => {
    const onChangeSpy = vi.fn();
    const lf = 'linha1\nlinha2';
    useAppStore.setState({
      activeTab: 'C:\\Vault\\notas.txt',
      activeNoteContent: lf,
      activeContentPath: 'C:\\Vault\\notas.txt',
    });

    const { container } = render(<PlainTextEditor content={lf} onChange={onChangeSpy} />);
    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeInTheDocument();
    });

    const view = getView(container);
    view.dispatch({ changes: { from: 0, insert: 'X' } });

    await waitFor(() => {
      expect(onChangeSpy).toHaveBeenCalled();
    });
    expect(onChangeSpy).toHaveBeenLastCalledWith('Xlinha1\nlinha2');
  });
});
