// E2 Fatia A (Spec 28) — #tags no editor: chip clicável com charset ESPELHANDO o parser
// Rust (mesmos casos do test_tag_extraction_edge_cases — divergência front↔Rust = bug).
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MarkdownEditor from '../components/MarkdownEditor';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

describe('#tags no editor (E2 Fatia A)', () => {
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
      existingNotes: new Map(),
      editorSourceMode: false,
    });
  });

  it('renderiza #tag como chip com data-tag (aninhada inclusa)', async () => {
    const content = `Linha inicial\num #foco e #projeto/mycellia aqui`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const chips = container.querySelectorAll('.cm-hashtag');
      expect(chips.length).toBe(2);
      expect(chips[0]).toHaveAttribute('data-tag', 'foco');
      expect(chips[1]).toHaveAttribute('data-tag', 'projeto/mycellia');
    });
  });

  it('paridade de charset com o parser Rust: casos que NÃO são tag ficam crus', async () => {
    // #1abc (começa com dígito) · x#y (sem boundary) · # sozinho — nenhum vira chip;
    // #_priv e #tag-com-hifen viram (mesmas regras do extract_tags_from_raw)
    const content = `Linha inicial\n#1abc x#y # solto\n#_priv e #tag-com-hifen`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const tags = [...container.querySelectorAll('.cm-hashtag')].map((c) => c.getAttribute('data-tag'));
      expect(tags).toEqual(['_priv', 'tag-com-hifen']);
    });
  });

  it('#tag dentro de código NÃO vira chip', async () => {
    const content = 'Linha inicial\n```\n#dentro-de-codigo\n```\nfora #fora';
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const tags = [...container.querySelectorAll('.cm-hashtag')].map((c) => c.getAttribute('data-tag'));
      expect(tags).toEqual(['fora']);
    });
  });

  it('clicar no chip dispara a busca `#tag` (painel + grafo)', async () => {
    const setLeftPanelModeSpy = vi.fn();
    const setGraphSearchQuerySpy = vi.fn();
    useAppStore.setState({
      setLeftPanelMode: setLeftPanelModeSpy,
      setGraphSearchQuery: setGraphSearchQuerySpy,
    });

    const content = `Linha inicial\nsobre #projeto/mycellia hoje`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    let chip: Element;
    await waitFor(() => {
      chip = container.querySelector('.cm-hashtag')!;
      expect(chip).not.toBeNull();
    });

    fireEvent.click(chip!);
    expect(setLeftPanelModeSpy).toHaveBeenCalledWith('search');
    expect(setGraphSearchQuerySpy).toHaveBeenCalledWith('#projeto/mycellia');
  });

  it('modo Fonte desliga os chips (compartimento)', async () => {
    const content = `Linha inicial\num #foco aqui`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(container.querySelector('.cm-hashtag')).not.toBeNull();
    });

    const { act } = await import('@testing-library/react');
    act(() => {
      useAppStore.getState().toggleEditorSourceMode();
    });

    await waitFor(() => {
      expect(container.querySelector('.cm-hashtag')).toBeNull();
    });
  });
});
