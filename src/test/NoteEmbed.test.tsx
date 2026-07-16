// E2 Fatia C (Spec 28) — transclusão ![[Nota]]: detecção nota vs imagem, corpo renderizado
// (pipeline do callout), seção por heading, anti-recursão (ciclo + profundidade) e
// navegação pelo header. Só exibição — o documento nunca muda.
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MarkdownEditor from '../components/MarkdownEditor';
import { extractSection, stripFrontmatter, invalidateEmbedCache } from '../editor/noteEmbed';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

const FILES: Record<string, string> = {
  'C:\\Vault\\Alvo.md': '---\ntags: [x]\n---\n# Visão\ncorpo da visão com **negrito**\n## Roadmap\nfase um\n## Outra\nfora da seção',
  'C:\\Vault\\CicloA.md': 'conteúdo de A\n![[CicloB]]',
  'C:\\Vault\\CicloB.md': 'conteúdo de B\n![[CicloA]]',
};

describe('Transclusão ![[Nota]] (E2 Fatia C)', () => {
  beforeEach(() => {
    invalidateEmbedCache();
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'load_vault_tree') {
        return { name: 'Vault', path: 'C:\\Vault', is_dir: true, children: [] };
      }
      if (cmd === 'read_file') {
        const a = args as { path: string };
        return FILES[a.path] ?? '';
      }
      return undefined;
    });

    useAppStore.setState({
      activeTab: 'C:\\Vault\\nota_teste.md',
      activeNoteContent: '',
      activeNoteYamlDoc: null,
      currentVault: 'C:\\Vault',
      openTabs: ['C:\\Vault\\nota_teste.md'],
      existingNotes: new Map([
        ['alvo', 'C:\\Vault\\Alvo.md'],
        ['cicloa', 'C:\\Vault\\CicloA.md'],
        ['ciclob', 'C:\\Vault\\CicloB.md'],
      ]),
      editorSourceMode: false,
    });
  });

  it('![[Alvo]] embeda a nota: header clicável + corpo renderizado SEM frontmatter', async () => {
    const content = `Linha inicial\n![[Alvo]]`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const embed = container.querySelector('.mycellia-embed');
      expect(embed).toBeInTheDocument();
      expect(embed!.querySelector('.mycellia-embed-header')).toHaveTextContent('Alvo');
      const body = embed!.querySelector('.mycellia-embed-body');
      expect(body).toHaveTextContent('corpo da visão');
      expect(body!.querySelector('strong')).toHaveTextContent('negrito');
      // Frontmatter não vaza pro corpo
      expect(body!.textContent).not.toContain('tags:');
    });
  });

  it('![[img.png]] continua sendo imagem (não vira embed de nota)', async () => {
    const content = `Linha inicial\n![[img.png]]`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      // Fluxo de imagem existente: indicador de imagem não encontrada (sem árvore)
      expect(container.querySelector('.mycellia-embed')).toBeNull();
      expect(container.querySelector('.cm-content')!.textContent).not.toContain('mycellia-embed');
    });
  });

  it('![[Alvo#Roadmap]] embeda SÓ a seção (até o próximo heading de nível ≤)', async () => {
    const content = `Linha inicial\n![[Alvo#Roadmap]]`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const body = container.querySelector('.mycellia-embed-body');
      expect(body).toHaveTextContent('fase um');
      expect(body!.textContent).not.toContain('fora da seção');
      expect(body!.textContent).not.toContain('corpo da visão');
      const header = container.querySelector('.mycellia-embed-header');
      expect(header).toHaveTextContent('Alvo › Roadmap');
    });
  });

  it('ciclo A↔B corta: o sub-embed vira link estático com "(ciclo)"', async () => {
    const content = `Linha inicial\n![[CicloA]]`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const outer = container.querySelector('.mycellia-embed');
      expect(outer).toHaveTextContent('conteúdo de A');
      // B embeda dentro de A (profundidade 1 < 2)
      expect(outer!.textContent).toContain('conteúdo de B');
      // A dentro de B seria ciclo → link estático marcado
      const staticLink = container.querySelector('.mycellia-embed-static');
      expect(staticLink).toHaveTextContent('CicloA (ciclo)');
    });
  });

  it('clicar no header navega pra nota (com fragmento quando houver)', async () => {
    const clickSpy = vi.fn(async () => {});
    useAppStore.setState({ handleWikiLinkClick: clickSpy });

    const content = `Linha inicial\n![[Alvo#Roadmap]]`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    let header: Element;
    await waitFor(() => {
      header = container.querySelector('.mycellia-embed-header')!;
      expect(header).not.toBeNull();
    });

    fireEvent.click(header!);
    expect(clickSpy).toHaveBeenCalledWith('Alvo#Roadmap');
  });

  it('cursor na linha do embed mostra a fonte crua', async () => {
    const content = `![[Alvo]]`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(container.querySelector('.mycellia-embed')).toBeNull();
    expect(container.querySelector('.cm-content')).toHaveTextContent('![[Alvo]]');
  });

  it('o documento permanece intacto (nenhum onChange)', async () => {
    const onChangeSpy = vi.fn();
    const content = `Linha inicial\n![[Alvo]]`;
    const { container } = render(<MarkdownEditor content={content} onChange={onChangeSpy} />);

    await waitFor(() => {
      expect(container.querySelector('.mycellia-embed')).toBeInTheDocument();
    });
    expect(onChangeSpy).not.toHaveBeenCalled();
  });
});

describe('helpers puros da transclusão', () => {
  it('stripFrontmatter remove só o bloco YAML inicial', () => {
    expect(stripFrontmatter('---\na: 1\n---\ncorpo')).toBe('corpo');
    expect(stripFrontmatter('sem frontmatter')).toBe('sem frontmatter');
    expect(stripFrontmatter('---\nsem fechamento')).toBe('---\nsem fechamento');
  });

  it('extractSection pega do heading até o próximo de nível ≤ (case-insensitive)', () => {
    const md = '# A\num\n## B\ndois\n### C\ntres\n## D\nquatro';
    expect(extractSection(md, 'b')).toBe('## B\ndois\n### C\ntres');
    expect(extractSection(md, 'A')).toBe(md);
    expect(extractSection(md, 'inexistente')).toBeNull();
  });

  it('extractSection ignora headings dentro de código', () => {
    const md = '## Alvo\ncorpo\n```\n## Falso\n```\nmais\n## Fim\nx';
    expect(extractSection(md, 'Alvo')).toBe('## Alvo\ncorpo\n```\n## Falso\n```\nmais');
  });
});
