// E2 Fatia B (Spec 28) — [[Nota#Título]]: render "Nota › Título", resolução pela NOTA,
// navegação com scroll até o heading, [[#Local]] na própria nota e autocomplete de headings.
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import MarkdownEditor from '../components/MarkdownEditor';
import { wikiLinkAutocomplete, parseHeadings, invalidateHeadingsCache } from '../editor/extensions';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

// Ações reais capturadas ANTES de qualquer teste substituí-las por spy (setState merge
// não restaura sozinho — sem isso o spy de um teste vaza pros seguintes)
const realHandleWikiLinkClick = useAppStore.getState().handleWikiLinkClick;
const realOpenTab = useAppStore.getState().openTab;

describe('[[Nota#Título]] (E2 Fatia B)', () => {
  beforeEach(() => {
    invalidateHeadingsCache();
    useAppStore.setState({ handleWikiLinkClick: realHandleWikiLinkClick, openTab: realOpenTab });
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'load_vault_tree') {
        return { name: 'Vault', path: 'C:\\Vault', is_dir: true, children: [] };
      }
      if (cmd === 'read_file') {
        const a = args as { path: string };
        if (a.path === 'C:\\Vault\\Alvo.md') {
          return '# Visão\ntexto\n## Roadmap\nmais texto\n```\n# não é heading\n```\n### Fase 1';
        }
        return '';
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

  it('renderiza [[Alvo#Roadmap]] como "Alvo › Roadmap" resolvido (heading não invalida)', async () => {
    const content = `Linha inicial\nveja [[Alvo#Roadmap]] aqui`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const sep = container.querySelector('.cm-wiki-link-sep');
      expect(sep).toBeInTheDocument();
      expect(sep).toHaveTextContent('›');
      const heading = container.querySelector('.cm-wiki-link-heading');
      expect(heading).toHaveTextContent('Roadmap');
      expect(heading).toHaveClass('cm-wiki-link-resolved');
      expect(heading).toHaveAttribute('data-target', 'Alvo#Roadmap');
      // O '#' cru não aparece
      expect(container.querySelector('.cm-content')!.textContent).not.toContain('#Roadmap');
    });
  });

  it('nota inexistente com heading fica unresolved (resolução é pela NOTA)', async () => {
    const content = `Linha inicial\n[[Sumida#Seção]]`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const link = container.querySelector('.cm-wiki-link-heading');
      expect(link).toHaveClass('cm-wiki-link-unresolved');
    });
  });

  it('clicar no link navega passando o alvo completo pro store', async () => {
    const clickSpy = vi.fn(async () => {});
    useAppStore.setState({ handleWikiLinkClick: clickSpy });

    const content = `Linha inicial\nveja [[Alvo#Roadmap]]`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    let link: Element;
    await waitFor(() => {
      link = container.querySelector('.cm-wiki-link-heading')!;
      expect(link).not.toBeNull();
    });

    fireEvent.click(link!);
    expect(clickSpy).toHaveBeenCalledWith('Alvo#Roadmap');
  });

  it('scroll pendente: acha o heading, move a seleção e limpa o pendente', async () => {
    const content = `# Topo\ntexto\n## Meio Da Nota\nmais\n### Fim`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeInTheDocument();
    });

    const { act } = await import('@testing-library/react');
    act(() => {
      useAppStore.getState().setPendingScrollToHeading('meio da nota'); // case-insensitive
    });

    await waitFor(() => {
      expect(useAppStore.getState().pendingScrollToHeading).toBeNull();
    });
  });

  it('[[#Local]] (própria nota) só agenda o scroll, sem trocar de aba', async () => {
    const openTabSpy = vi.fn(async () => {});
    useAppStore.setState({ openTab: openTabSpy });

    await useAppStore.getState().handleWikiLinkClick('#Seção Local');

    expect(useAppStore.getState().pendingScrollToHeading).toBe('Seção Local');
    expect(openTabSpy).not.toHaveBeenCalled();
  });

  it('parseHeadings ignora headings dentro de código', () => {
    const headings = parseHeadings('# Um\n```\n# Falso\n```\n## Dois');
    expect(headings).toEqual(['Um', 'Dois']);
  });

  it('autocomplete [[Alvo# lista os headings da nota alvo (lidos on-demand)', async () => {
    const doc = '[[Alvo#';
    const state = EditorState.create({ doc });
    const result = (await wikiLinkAutocomplete(
      new CompletionContext(state, doc.length, false),
    )) as CompletionResult;

    expect(result).not.toBeNull();
    const labels = result.options.map((o) => o.label);
    expect(labels).toEqual(['Visão', 'Roadmap', 'Fase 1']);
    expect(result.options[1].apply).toBe('Roadmap]]');
    expect(result.from).toBe(7); // depois do '#'
  });

  it('autocomplete [[# usa os headings da PRÓPRIA nota em memória', async () => {
    useAppStore.setState({ activeNoteContent: '# Aqui\n## Dentro' });

    const doc = '[[#';
    const state = EditorState.create({ doc });
    const result = (await wikiLinkAutocomplete(
      new CompletionContext(state, doc.length, false),
    )) as CompletionResult;

    expect(result.options.map((o) => o.label)).toEqual(['Aqui', 'Dentro']);
  });
});
