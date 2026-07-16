// E1.6 (Spec 27) — Modo Fonte: toggle desliga TODAS as decorações (callout, wiki-link,
// placeholders de sintaxe) mostrando o markdown cru, e religa ao voltar. Botão no header
// e Ctrl+E alternam. O documento permanece byte a byte intacto nos dois sentidos.
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MarkdownEditor from '../components/MarkdownEditor';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

// FLAKE-guard (padrão FLAKE-02): espera ativa folgada
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

const CONTENT = `Linha inicial\n> [!tip] Dica\n> corpo com [[Alvo]]\n**negrito** também`;

describe('Modo Fonte (E1.6)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'load_vault_tree') {
        return { name: 'Vault', path: 'C:\\Vault', is_dir: true, children: [] };
      }
      return undefined;
    });

    useAppStore.setState({
      activeTab: 'C:\\Vault\\nota_teste.md',
      activeNoteContent: '',
      activeNoteYamlDoc: null,
      currentVault: 'C:\\Vault',
      openTabs: ['C:\\Vault\\nota_teste.md'],
      existingNotes: new Map([['alvo', 'C:\\Vault\\Alvo.md']]),
      editorSourceMode: false,
    });
  });

  it('modo Fonte desliga decorações (cru total) e voltar religa', async () => {
    const { container } = render(<MarkdownEditor content={CONTENT} onChange={vi.fn()} />);

    // Edição: callout decorado, wiki-link estilizado, marcadores escondidos
    await waitFor(() => {
      expect(container.querySelector('.mycellia-callout')).toBeInTheDocument();
    });

    // → Fonte
    act(() => {
      useAppStore.getState().toggleEditorSourceMode();
    });

    await waitFor(() => {
      expect(container.querySelector('.mycellia-callout')).toBeNull();
      expect(container.querySelector('.cm-wiki-link')).toBeNull();
      expect(container.querySelector('.cm-hidden-syntax-placeholder')).toBeNull();
      const raw = container.querySelector('.cm-content')!.textContent ?? '';
      expect(raw).toContain('> [!tip] Dica');
      expect(raw).toContain('[[Alvo]]');
      expect(raw).toContain('**negrito**');
    });

    // → Edição de novo
    act(() => {
      useAppStore.getState().toggleEditorSourceMode();
    });

    await waitFor(() => {
      expect(container.querySelector('.mycellia-callout')).toBeInTheDocument();
    });
  });

  it('botão do header mostra o modo atual e alterna ao clicar', async () => {
    render(<MarkdownEditor content={CONTENT} onChange={vi.fn()} />);

    const btn = screen.getByRole('button', { name: /alternar modo de exibição/i });
    expect(btn).toHaveTextContent('Edição');

    fireEvent.click(btn);
    expect(useAppStore.getState().editorSourceMode).toBe(true);
    expect(btn).toHaveTextContent('Fonte');

    fireEvent.click(btn);
    expect(useAppStore.getState().editorSourceMode).toBe(false);
    expect(btn).toHaveTextContent('Edição');
  });

  it('Ctrl+E alterna o modo de dentro do editor', async () => {
    const { container } = render(<MarkdownEditor content={CONTENT} onChange={vi.fn()} />);
    const cmContent = container.querySelector('.cm-content') as HTMLElement;

    fireEvent.keyDown(cmContent, { key: 'e', ctrlKey: true });
    expect(useAppStore.getState().editorSourceMode).toBe(true);

    fireEvent.keyDown(cmContent, { key: 'e', ctrlKey: true });
    expect(useAppStore.getState().editorSourceMode).toBe(false);
  });

  it('alternar os modos NÃO muda o documento (nenhum onChange)', async () => {
    const onChangeSpy = vi.fn();
    const { container } = render(<MarkdownEditor content={CONTENT} onChange={onChangeSpy} />);

    await waitFor(() => {
      expect(container.querySelector('.mycellia-callout')).toBeInTheDocument();
    });

    act(() => {
      useAppStore.getState().toggleEditorSourceMode();
    });
    act(() => {
      useAppStore.getState().toggleEditorSourceMode();
    });

    expect(onChangeSpy).not.toHaveBeenCalled();
  });
});
