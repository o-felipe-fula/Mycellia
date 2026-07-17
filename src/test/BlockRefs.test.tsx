// E2 Fatia D (Spec 28) — block refs [[Nota#^id]]: parse de âncoras, autocomplete `#^`,
// scroll até a linha da âncora e transclusão do bloco.
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import MarkdownEditor from '../components/MarkdownEditor';
import { wikiLinkAutocomplete, parseBlockAnchors, invalidateHeadingsCache } from '../editor/extensions';
import { extractBlock, invalidateEmbedCache } from '../editor/noteEmbed';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

const ALVO = '# Doc\nfato importante um ^fato1\ntexto comum\noutro fato ^fato-2\n```\nfalso ^dentro-de-codigo\n```';

describe('Block refs [[Nota#^id]] (E2 Fatia D)', () => {
  beforeEach(() => {
    invalidateHeadingsCache();
    invalidateEmbedCache();
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'load_vault_tree') {
        return { name: 'Vault', path: 'C:\\Vault', is_dir: true, children: [] };
      }
      if (cmd === 'read_file') {
        const a = args as { path: string };
        return a.path === 'C:\\Vault\\Alvo.md' ? ALVO : '';
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
      pendingScrollToHeading: null,
    });
  });

  it('parseBlockAnchors acha as âncoras (ignorando código)', () => {
    expect(parseBlockAnchors(ALVO)).toEqual(['^fato1', '^fato-2']);
  });

  it('extractBlock devolve a linha do bloco SEM a âncora', () => {
    expect(extractBlock(ALVO, 'fato1')).toBe('fato importante um');
    expect(extractBlock(ALVO, 'fato-2')).toBe('outro fato');
    expect(extractBlock(ALVO, 'inexistente')).toBeNull();
  });

  it('autocomplete [[Alvo#^ lista as âncoras de bloco', async () => {
    const doc = '[[Alvo#^';
    const state = EditorState.create({ doc });
    const result = (await wikiLinkAutocomplete(
      new CompletionContext(state, doc.length, false),
    )) as CompletionResult;

    expect(result.options.map((o) => o.label)).toEqual(['^fato1', '^fato-2']);
    expect(result.options[0].apply).toBe('^fato1]]');
  });

  it('scroll pendente com ^id acha a linha da âncora e limpa o pendente', async () => {
    const content = `linha um\nfato alvo do scroll ^meu-bloco\nlinha tres`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeInTheDocument();
    });

    const { act } = await import('@testing-library/react');
    act(() => {
      useAppStore.getState().setPendingScrollToHeading('^meu-bloco');
    });

    await waitFor(() => {
      expect(useAppStore.getState().pendingScrollToHeading).toBeNull();
    });
  });

  it('âncora ` ^id` fica discreta no preview (marcada, sem sumir do doc)', async () => {
    const content = `Linha inicial\nfato com endereço ^meu-id`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const anchor = container.querySelector('.cm-block-anchor');
      expect(anchor).toBeInTheDocument();
      expect(anchor).toHaveTextContent('^meu-id');
    });
  });

  it('![[Alvo#^fato1]] embeda só o bloco (sem a âncora)', async () => {
    const content = `Linha inicial\n![[Alvo#^fato1]]`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const body = container.querySelector('.mycellia-embed-body');
      expect(body).toHaveTextContent('fato importante um');
      expect(body!.textContent).not.toContain('^fato1');
      expect(body!.textContent).not.toContain('texto comum');
    });
  });
});
