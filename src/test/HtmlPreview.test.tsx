// E1 (Spec 25) — HTML no live preview: tags inline viram decoração (zero innerHTML),
// blocos HTML viram widget sanitizado, comentários somem fora do cursor.
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MarkdownEditor from '../components/MarkdownEditor';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

// FLAKE-guard (padrão FLAKE-02): sob carga da suíte inteira o ciclo assíncrono do
// CodeMirror passa do timeout default de 1s — espera ativa folgada, asserções idênticas.
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

describe('HTML no live preview (E1)', () => {
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
    });
  });

  it('renderiza <u> como sublinhado e esconde as tags fora do cursor', async () => {
    const content = `Linha inicial\ntexto <u>sublinhado</u> aqui`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const underlined = container.querySelector('.cm-html-u');
      expect(underlined).toBeInTheDocument();
      expect(underlined).toHaveTextContent('sublinhado');
    });

    // As tags <u> e </u> foram substituídas por placeholders escondidos
    const visible = container.querySelector('.cm-content')!.textContent ?? '';
    expect(visible).not.toContain('<u>');
    expect(visible).not.toContain('</u>');
  });

  it('renderiza mark, sub e sup com as classes corretas', async () => {
    const content = `Linha inicial\num <mark>marcado</mark> com <sub>baixo</sub> e <sup>alto</sup>`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(container.querySelector('.cm-html-mark')).toHaveTextContent('marcado');
      expect(container.querySelector('.cm-html-sub')).toHaveTextContent('baixo');
      expect(container.querySelector('.cm-html-sup')).toHaveTextContent('alto');
    });
  });

  it('linha ativa fica crua (sem decoração de HTML)', async () => {
    // Cursor default na linha 1 = a própria linha do HTML
    const content = `texto <u>sublinhado</u> aqui`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(container.querySelector('.cm-html-u')).toBeNull();
    expect(container.querySelector('.cm-content')).toHaveTextContent('<u>sublinhado</u>');
  });

  it('tag sem par na mesma linha fica crua', async () => {
    const content = `Linha inicial\ntexto <u>sem fechamento na linha`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(container.querySelector('.cm-html-u')).toBeNull();
    expect(container.querySelector('.cm-content')).toHaveTextContent('<u>sem fechamento');
  });

  it('span com style de cor válido aplica o estilo sanitizado', async () => {
    const content = `Linha inicial\num <span style="color:#ff0000">vermelho</span> no texto`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const styled = container.querySelector('.cm-html-styled') as HTMLElement;
      expect(styled).toBeInTheDocument();
      expect(styled).toHaveTextContent('vermelho');
      // jsdom normaliza cores hex pra rgb() ao aplicar o atributo style
      expect(styled.style.color).toBe('rgb(255, 0, 0)');
    });
  });

  it('span com style malicioso/não suportado fica cru (validador estrito)', async () => {
    const content = `Linha inicial\num <span style="background:url(javascript:alert(1))">x</span> aqui`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(container.querySelector('.cm-html-styled')).toBeNull();
    expect(container.querySelector('.cm-content')).toHaveTextContent('<span');
  });

  it('bloco HTML vira widget sanitizado: conteúdo aparece, script não sobrevive', async () => {
    const content = `Linha inicial\n\n<div align="center">\n<b>bloco central</b>\n<script>window.hacked=true</script>\n</div>`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const block = container.querySelector('.mycellia-html-block');
      expect(block).toBeInTheDocument();
      expect(block).toHaveTextContent('bloco central');
      expect(block!.querySelector('script')).toBeNull();
    });

    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it('cursor dentro do bloco HTML mostra a fonte crua', async () => {
    // Cursor default na linha 1 = primeira linha do bloco
    const content = `<div>\n<b>miolo</b>\n</div>`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(container.querySelector('.mycellia-html-block')).toBeNull();
    expect(container.querySelector('.cm-content')).toHaveTextContent('<div>');
  });

  it('comentário HTML some fora do cursor', async () => {
    const content = `Linha inicial\n<!-- segredo oculto -->`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const visible = container.querySelector('.cm-content')!.textContent ?? '';
    expect(visible).not.toContain('segredo oculto');
  });

  it('<br> vira quebra de linha visual', async () => {
    const content = `Linha inicial\nantes <br> depois`;
    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    await waitFor(() => {
      const lines = container.querySelectorAll('.cm-line');
      const withBr = Array.from(lines).find((l) => l.querySelector('br'));
      expect(withBr).toBeTruthy();
    });
  });

  it('o documento permanece intacto ao decorar HTML (nenhum onChange)', async () => {
    const content = `Linha inicial\ntexto <u>sublinhado</u> e <mark>marcado</mark>`;
    const onChangeSpy = vi.fn();
    const { container } = render(<MarkdownEditor content={content} onChange={onChangeSpy} />);

    await waitFor(() => {
      expect(container.querySelector('.cm-html-u')).toBeInTheDocument();
    });

    expect(onChangeSpy).not.toHaveBeenCalled();
  });
});
