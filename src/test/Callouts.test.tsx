// E1 (Spec 25) — Callouts Obsidian-style: detecção, widget, fold, sanitização,
// wiki-links clicáveis e aninhamento. Tudo só EXIBIÇÃO — o documento nunca muda.
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MarkdownEditor from '../components/MarkdownEditor';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

// FLAKE-guard (padrão FLAKE-02): sob carga da suíte inteira o ciclo assíncrono do
// CodeMirror passa do timeout default de 1s — espera ativa folgada, asserções idênticas.
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

describe('Callouts (E1)', () => {
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
    });
  });

  it('renderiza callout como cartão com tipo, título e corpo fora do cursor', async () => {
    const content = `Linha inicial\n> [!note] Meu Título\n> corpo do callout`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const card = container.querySelector('.mycellia-callout');
      expect(card).toBeInTheDocument();
      expect(card).toHaveAttribute('data-callout', 'note');
      expect(card!.querySelector('.mycellia-callout-title')).toHaveTextContent('Meu Título');
      expect(card!.querySelector('.mycellia-callout-body')).toHaveTextContent('corpo do callout');
    });
  });

  it('resolve alias de tipo (caution → estilo warning) mantendo o tipo digitado', async () => {
    const content = `Linha inicial\n> [!caution] Cuidado\n> corpo`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const card = container.querySelector('.mycellia-callout') as HTMLElement;
      expect(card).toBeInTheDocument();
      expect(card).toHaveAttribute('data-callout', 'caution');
      expect(card.style.getPropertyValue('--callout-rgb')).toBe('236, 117, 0');
    });
  });

  it('usa o tipo capitalizado como título default quando não há título', async () => {
    const content = `Linha inicial\n> [!warning]\n> corpo`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const title = container.querySelector('.mycellia-callout-title');
      expect(title).toHaveTextContent('Warning');
    });
  });

  it('tipo desconhecido cai no estilo note com o tipo como título (comportamento Obsidian)', async () => {
    const content = `Linha inicial\n> [!foo]\n> corpo`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const card = container.querySelector('.mycellia-callout') as HTMLElement;
      expect(card).toBeInTheDocument();
      expect(card).toHaveAttribute('data-callout', 'foo');
      expect(card.style.getPropertyValue('--callout-rgb')).toBe('68, 138, 255');
      expect(card.querySelector('.mycellia-callout-title')).toHaveTextContent('Foo');
    });
  });

  it('fold "-" inicia colapsado e o clique no header alterna', async () => {
    const content = `Linha inicial\n> [!note]- Fechado\n> corpo escondido`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    let card: HTMLElement;
    await waitFor(() => {
      card = container.querySelector('.mycellia-callout') as HTMLElement;
      expect(card).toBeInTheDocument();
      expect(card).toHaveClass('collapsed');
    });

    const header = card!.querySelector('.mycellia-callout-header') as HTMLElement;
    expect(header).toHaveClass('foldable');

    fireEvent.click(header);
    expect(card!).not.toHaveClass('collapsed');

    fireEvent.click(header);
    expect(card!).toHaveClass('collapsed');
  });

  it('mostra fonte crua quando o cursor está dentro do bloco', async () => {
    // Cursor default na linha 1 = primeira linha do callout → sem widget
    const content = `> [!note] Titulo\n> corpo`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(container.querySelector('.mycellia-callout')).toBeNull();
    expect(container.querySelector('.cm-content')).toHaveTextContent('[!note]');
  });

  it('blockquote comum NÃO vira callout, mas ganha estilo de citação (linha marcada)', async () => {
    const content = `Linha inicial\n> citação simples de sempre`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(container.querySelector('.mycellia-callout')).toBeNull();
      expect(container.querySelector('.cm-content')).toHaveTextContent('citação simples');
      // Achado do Felipe (Review Gate E1.5): sem estilo, a citação ficava idêntica a
      // texto normal quando o ">" é escondido — a linha agora carrega a classe de quote
      expect(container.querySelector('.cm-line.cm-quote-line')).toBeInTheDocument();
    });
  });

  it('linhas de callout NÃO recebem o estilo de citação comum (viram widget)', async () => {
    const content = `Linha inicial\n> [!note] Título\n> corpo`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(container.querySelector('.mycellia-callout')).toBeInTheDocument();
      expect(container.querySelector('.cm-line.cm-quote-line')).toBeNull();
    });
  });

  it('sanitiza o corpo: script e handlers de evento não sobrevivem', async () => {
    const content = `Linha inicial\n> [!note] T\n> <script>window.hacked=true</script> texto <img src="x" onerror="window.hacked=true">`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const body = container.querySelector('.mycellia-callout-body');
      expect(body).toBeInTheDocument();
      expect(body!.querySelector('script')).toBeNull();
      const img = body!.querySelector('img');
      if (img) {
        expect(img.getAttribute('onerror')).toBeNull();
      }
      expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
    });
  });

  it('wiki-links no corpo viram spans clicáveis que navegam via store', async () => {
    const clickSpy = vi.fn(async () => {});
    useAppStore.setState({ handleWikiLinkClick: clickSpy });

    const content = `Linha inicial\n> [!note] T\n> veja [[Alvo]] e [[Sumida|apelido]]`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    let links: NodeListOf<Element>;
    await waitFor(() => {
      links = container.querySelectorAll('.mycellia-callout-body .cm-wiki-link');
      expect(links.length).toBe(2);
    });

    expect(links![0]).toHaveClass('cm-wiki-link-resolved');
    expect(links![0]).toHaveAttribute('data-target', 'Alvo');
    expect(links![0]).toHaveTextContent('Alvo');

    expect(links![1]).toHaveClass('cm-wiki-link-unresolved');
    expect(links![1]).toHaveAttribute('data-target', 'Sumida');
    expect(links![1]).toHaveTextContent('apelido');

    fireEvent.click(links![0]);
    expect(clickSpy).toHaveBeenCalledWith('Alvo');
  });

  it('callout aninhado renderiza como cartão dentro do cartão', async () => {
    const content = `Linha inicial\n> [!note] Pai\n> > [!tip] Filho\n> > corpo interno`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const cards = container.querySelectorAll('.mycellia-callout');
      expect(cards.length).toBe(2);
      const inner = cards[0].querySelector('.mycellia-callout') ?? cards[1];
      expect(inner).toHaveAttribute('data-callout', 'tip');
      expect(inner!.querySelector('.mycellia-callout-title')).toHaveTextContent('Filho');
      expect(inner!.querySelector('.mycellia-callout-body')).toHaveTextContent('corpo interno');
    });
  });

  it('o documento permanece byte a byte intacto ao renderizar callouts', async () => {
    const content = `Linha inicial\n> [!note] Meu Título\n> corpo do callout`;
    const onChangeSpy = vi.fn();
    const { container } = render(<MarkdownEditor content={content} onChange={onChangeSpy} />);

    await waitFor(() => {
      expect(container.querySelector('.mycellia-callout')).toBeInTheDocument();
    });

    // Decoração é só exibição: nenhuma mudança de documento pode ter sido disparada
    expect(onChangeSpy).not.toHaveBeenCalled();
  });
});
