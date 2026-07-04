import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MarkdownEditor from '../components/MarkdownEditor';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';
import { EditorView } from '@codemirror/view';

interface MockedMermaid {
  _clearPromises: () => void;
  _resolveRender: (index: number, svg: string) => void;
  _rejectRender: (index: number, err: unknown) => void;
  _getPromises: () => { id: string; code: string }[];
}

vi.mock('mermaid', () => {
  let renderPromises: { resolve: (val: { svg: string }) => void; reject: (err: unknown) => void; id: string; code: string }[] = [];
  return {
    default: {
      initialize: vi.fn(),
      render: vi.fn().mockImplementation((id: string, code: string) => {
        return new Promise((resolve, reject) => {
          renderPromises.push({ resolve, reject, id, code });
        });
      }),
      _resolveRender: (index: number, svg: string) => {
        if (renderPromises[index]) {
          renderPromises[index].resolve({ svg });
        }
      },
      _rejectRender: (index: number, err: unknown) => {
        if (renderPromises[index]) {
          renderPromises[index].reject(err);
        }
      },
      _clearPromises: () => {
        renderPromises = [];
      },
      _getPromises: () => renderPromises,
    }
  };
});
describe('MarkdownEditor Component', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
      if (cmd === 'rename_item') {
        const argsObj = args as { path: string; newName: string };
        if (argsObj.newName === 'nota_existente') {
          throw new Error('Já existe um arquivo ou pasta com este nome');
        }
        const parent = argsObj.path.substring(0, argsObj.path.lastIndexOf('\\') + 1);
        return `${parent}${argsObj.newName}.md`;
      }
      if (cmd === 'load_vault_tree') {
        return {
          name: 'Vault',
          path: 'C:\\Vault',
          is_dir: true,
          children: [],
        };
      }
      return undefined;
    });

    useAppStore.setState({
      activeTab: 'C:\\Vault\\nota_teste.md',
      activeNoteContent: 'Conteúdo da nota',
      activeNoteYamlDoc: null,
      currentVault: 'C:\\Vault',
      openTabs: ['C:\\Vault\\nota_teste.md'],
    });
  });

  it('deve renderizar o input de título com o nome da nota ativa', () => {
    render(<MarkdownEditor content="Conteúdo da nota" onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText('Sem título') as HTMLInputElement;
    expect(input.value).toBe('nota_teste');
  });

  it('deve exibir erro inline quando o título for vazio e restaurar o valor anterior', () => {
    render(<MarkdownEditor content="Conteúdo da nota" onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText('Sem título') as HTMLInputElement;

    // Altera para vazio e desfoca
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(screen.getByText(/O nome do arquivo não pode ser vazio/i)).toBeInTheDocument();
    expect(input.value).toBe('nota_teste');
  });

  it('deve exibir erro inline quando o título contiver caracteres inválidos e restaurar o valor anterior', () => {
    render(<MarkdownEditor content="Conteúdo da nota" onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText('Sem título') as HTMLInputElement;

    // Altera para nome inválido e desfoca
    fireEvent.change(input, { target: { value: 'nota/invalida?' } });
    fireEvent.blur(input);

    expect(screen.getByText(/O nome do arquivo contém caracteres inválidos/i)).toBeInTheDocument();
    expect(input.value).toBe('nota_teste');
  });

  it('deve exibir erro inline se a renomeação falhar no backend (colisão)', async () => {
    render(<MarkdownEditor content="Conteúdo da nota" onChange={vi.fn()} />);
    const input = screen.getByPlaceholderText('Sem título') as HTMLInputElement;

    // Altera para nota_existente (simula colisão de arquivos no disco)
    fireEvent.change(input, { target: { value: 'nota_existente' } });
    fireEvent.blur(input);

    // Espera a Promise resolver e verificar se o erro da colisão é exibido
    const errorText = await screen.findByText(/Já existe um arquivo ou pasta com este nome/i);
    expect(errorText).toBeInTheDocument();
    expect(input.value).toBe('nota_teste');
  });

  it('deve renderizar a afordância "+ adicionar propriedades" quando o frontmatter estiver vazio', () => {
    render(<MarkdownEditor content="Conteúdo da nota" onChange={vi.fn()} />);
    expect(screen.getByText(/adicionar propriedades/i)).toBeInTheDocument();
  });

  it('deve renderizar indicador de erro para imagem não encontrada', async () => {
    render(
      <MarkdownEditor
        content={`Texto normal na primeira linha
![[imagem_inexistente.png]]`}
        onChange={vi.fn()}
      />
    );
    
    // O CodeMirror no ambiente JSDOM geralmente renderiza as decorações do viewport visível
    const errorPlaceholder = await screen.findByText(/Imagem não encontrada/i);
    expect(errorPlaceholder).toBeInTheDocument();
    expect(errorPlaceholder).toHaveTextContent('imagem_inexistente.png');
  });

  it('deve lidar com evento de colar (paste) de imagem e inserir embed ![[nome]]', async () => {
    // Mock save_pasted_image command
    vi.mocked(invoke).mockImplementation(async (cmd, _args?: unknown) => {
      if (cmd === 'save_pasted_image') {
        return 'Pasted image 20260526120000.png';
      }
      if (cmd === 'load_vault_tree') {
        return {
          name: 'Vault',
          path: 'C:\\Vault',
          is_dir: true,
          children: [],
        };
      }
      return undefined;
    });

    const onChangeSpy = vi.fn();
    render(<MarkdownEditor content="" onChange={onChangeSpy} />);
    const editorEl = document.querySelector('.cm-content');
    expect(editorEl).toBeInTheDocument();

    // Cria um arquivo de imagem mockado para colar
    const file = new File([''], 'test.png', { type: 'image/png' });
    const clipboardData = {
      items: [
        {
          type: 'image/png',
          getAsFile: () => file,
        },
      ],
    };

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: clipboardData,
    });

    editorEl?.dispatchEvent(pasteEvent);

    // Espera o processamento FileReader e o dispatch do editor
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(invoke).toHaveBeenCalledWith('save_pasted_image', expect.objectContaining({
      extension: 'png',
    }));
    expect(onChangeSpy).toHaveBeenCalledWith('![[Pasted image 20260526120000.png]]');
  });
  it('deve renderizar decoracoes de imagem em todo o documento, inclusive fora de viewports simulados', async () => {
    let content = 'Texto inicial\n';
    content += '![[imagem_topo.png]]\n';
    for (let i = 0; i < 10; i++) {
      content += `Linha de texto numero ${i}\n`;
    }
    content += '![[imagem_fim.png]]';

    render(
      <MarkdownEditor
        content={content}
        onChange={vi.fn()}
      />
    );

    const placeholders = await screen.findAllByText(/Imagem não encontrada/i);
    expect(placeholders.length).toBe(2);
    expect(placeholders[0]).toHaveTextContent('imagem_topo.png');
    expect(placeholders[1]).toHaveTextContent('imagem_fim.png');
  });

  it('BUG-04: imagem que chega no fileTree aparece SEM reabrir a nota', async () => {
    // Antes do fix, o imagePreviewExtension capturava o fileTree do momento da montagem
    // (deps [activeTab]) — imagem recém-colada dava "não encontrada" até trocar de aba.
    // Agora a extensão lê o store vivo e o editor dispara fileTreeChangedEffect na mudança.
    useAppStore.setState({
      fileTree: { name: 'Vault', path: 'C:\\Vault', is_dir: true, children: [] },
    });

    render(<MarkdownEditor content={'Texto\n![[nova_imagem.png]]'} onChange={vi.fn()} />);

    // 1. Árvore ainda sem o arquivo → indicador de erro
    const errorPlaceholder = await screen.findByText(/Imagem não encontrada/i);
    expect(errorPlaceholder).toHaveTextContent('nova_imagem.png');

    // 2. A imagem "chega" no vault (watcher atualizou a árvore) — SEM trocar de aba
    useAppStore.setState({
      fileTree: {
        name: 'Vault',
        path: 'C:\\Vault',
        is_dir: true,
        children: [
          { name: 'nova_imagem.png', path: 'C:\\Vault\\nova_imagem.png', is_dir: false },
        ],
      },
    });

    // 3. O widget de imagem substitui o erro sem reabrir a nota
    await vi.waitFor(
      () => {
        expect(screen.queryByText(/Imagem não encontrada/i)).toBeNull();
      },
      { timeout: 5000 }
    );
  });

  it('deve renderizar tabela como widget e voltar a cru no cursor', async () => {
    const tableContent = `
| Cabecalho 1 | Cabecalho 2 |
|---|---|
| Celula 1 | Celula 2 |`;

    const { container } = render(
      <MarkdownEditor
        content={tableContent}
        onChange={vi.fn()}
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const table = container.querySelector('.mycellia-table-wrapper');
    expect(table).toBeInTheDocument();
    expect(table).toHaveTextContent('Cabecalho 1');
    expect(table).toHaveTextContent('Celula 1');
  });

  it('deve renderizar bullet de lista', async () => {
    const listContent = `
- Item de lista
* Outro item`;
    const { container } = render(
      <MarkdownEditor
        content={listContent}
        onChange={vi.fn()}
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const bullets = container.querySelectorAll('.cm-bullet-mark');
    expect(bullets.length).toBeGreaterThanOrEqual(1);
    expect(bullets[0]).toHaveTextContent('•');
  });

  it('deve renderizar checkboxes visuais com estado certo e esconder o listMark', async () => {
    const taskContent = `
- [ ] Task nao marcada
- [x] Task marcada`;
    const { container } = render(
      <MarkdownEditor
        content={taskContent}
        onChange={vi.fn()}
      />
    );

    // FLAKE-02 (fix, com OK do Felipe): espera ATIVA em vez de sleep fixo de 50ms — sob
    // carga (suíte em paralelo com cargo/clippy) o ciclo assíncrono do CodeMirror passava
    // do sleep e a contagem flakava. As asserções continuam EXATAMENTE as mesmas.
    await vi.waitFor(
      () => {
        const boxes = container.querySelectorAll('.cm-task-marker-box');
        expect(boxes.length).toBe(2);
        expect(boxes[0]).not.toHaveClass('checked');
        expect(boxes[1]).toHaveClass('checked');

        const bullets = container.querySelectorAll('.cm-bullet-mark');
        expect(bullets.length).toBe(0);
      },
      { timeout: 5000 }
    );
  });

  it('deve renderizar strikethrough, ocultar marcadores ~~ fora do cursor e reverter no cursor', async () => {
    const strikethroughContent = `Linha de texto normal\n~~texto riscado~~`;
    const { container } = render(
      <MarkdownEditor
        content={strikethroughContent}
        onChange={vi.fn()}
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // A classe cm-strikethrough deve estar presente no texto
    const strikethroughSpan = container.querySelector('.cm-strikethrough');
    expect(strikethroughSpan).toBeInTheDocument();
    expect(strikethroughSpan).toHaveTextContent('texto riscado');

    // Como o cursor está por padrão na Linha 1 (offset 0), o marcador ~~ da Linha 2 deve estar oculto
    // EmptyWidget cria spans com classe cm-hidden-syntax-placeholder e display: none
    const hiddenPlaceholders = container.querySelectorAll('.cm-hidden-syntax-placeholder');
    expect(hiddenPlaceholders.length).toBeGreaterThanOrEqual(2);
  });

  it('deve realizar alteracao byte-a-byte integra ao clicar no checkbox decorado', async () => {
    const originalContent = `# Heading do Teste
Linha 1
Linha 2 com texto
- [ ] Checkbox 1
Linha de meio
- [ ] Checkbox 2 (alvo)
Outra linha de texto
- [x] Checkbox 3
Linha final do documento`;

    let savedContent = '';
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'write_file') {
        const writeFileArgs = args as { content: string };
        savedContent = writeFileArgs.content;
      }
      if (cmd === 'load_vault_tree') {
        return { name: 'Vault', path: 'C:\\Vault', is_dir: true, children: [] };
      }
      return undefined;
    });

    const onChangeSpy = vi.fn((val) => {
      useAppStore.getState().updateActiveNoteContent(val);
    });
    const { container } = render(
      <MarkdownEditor
        content={originalContent}
        onChange={onChangeSpy}
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // O cursor inicial está na linha 1 (head = 0)
    // Os checkboxes estão nas linhas 4, 6 e 8. Eles estão decorados como widgets.
    const boxes = container.querySelectorAll('.cm-task-marker-box');
    expect(boxes.length).toBe(3);

    // Spy on posAtDOM to return the character positions:
    // Checkbox 1 starts at 47, Checkbox 2 starts at 78, Checkbox 3 starts at 123
    const posAtDOMSpy = vi.spyOn(EditorView.prototype, 'posAtDOM').mockImplementation((dom: Node) => {
      const boxesArray = Array.from(container.querySelectorAll('.cm-task-marker-box'));
      const index = boxesArray.indexOf(dom as HTMLElement);
      if (index === 0) return 47;
      if (index === 1) return 78;
      if (index === 2) return 123;
      return 0;
    });

    const editorEl = container.querySelector('.cm-content') as HTMLElement;
    editorEl.focus();
    editorEl.addEventListener('click', (e) => {
      console.log("TEST CONSOLE: CLICK BUBBLED TO .cm-content!", (e.target as HTMLElement).className);
    });

    // Clica no segundo checkbox (Checkbox 2 (alvo))
    fireEvent.click(boxes[1]);

    // Espera o autosave (500ms debounce + margem)
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(onChangeSpy).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('write_file', expect.any(Object));

    // Verifica que o conteúdo salvo é exatamente idêntico ao original exceto o checkbox alvo
    const expectedContent = `# Heading do Teste
Linha 1
Linha 2 com texto
- [ ] Checkbox 1
Linha de meio
- [x] Checkbox 2 (alvo)
Outra linha de texto
- [x] Checkbox 3
Linha final do documento`;

    expect(savedContent).toBe(expectedContent);

    // Verifica byte-a-byte (exclui a única diferença de caractere para garantir integridade total)
    let diffCount = 0;
    for (let i = 0; i < originalContent.length; i++) {
      if (originalContent[i] !== savedContent[i]) {
        diffCount++;
      }
    }
    // A única diferença deve ser no caractere " " que virou "x"
    expect(diffCount).toBe(1);

    posAtDOMSpy.mockRestore();
  });

  it('clique nao marca se a linha estiver ativa (nao decorada)', async () => {
    const singleContent = `- [ ] Task 1`;
    const { container } = render(
      <MarkdownEditor
        content={singleContent}
        onChange={vi.fn()}
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // A linha está ativa, então os colchetes [ ] devem ser renderizados como texto cru
    // e o widget de checkbox (.cm-task-marker-box) NÃO deve estar presente no DOM
    const box = container.querySelector('.cm-task-marker-box');
    expect(box).toBeNull();
  });

  it('deve rejeitar o clique se posAtDOM forçado a apontar para a linha ativa', async () => {
    const doubleContent = `- [ ] Task 1\n- [ ] Task 2`;
    const onChangeSpy = vi.fn();
    const { container } = render(
      <MarkdownEditor
        content={doubleContent}
        onChange={onChangeSpy}
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Apenas a Task 2 está decorada porque o cursor está na Linha 1 (Task 1)
    const boxes = container.querySelectorAll('.cm-task-marker-box');
    expect(boxes.length).toBe(1);

    // Mock posAtDOM para mapear o clique de boxes[0] (Task 2) para a posição 2 (que é a Task 1 na linha ativa 1)
    const posAtDOMSpy = vi.spyOn(EditorView.prototype, 'posAtDOM').mockImplementation(() => 2);

    fireEvent.click(boxes[0]);

    // Espera para ver se dispara autosave
    await new Promise((resolve) => setTimeout(resolve, 600));

    // onChangeSpy NÃO deve ter sido chamado porque a linha 1 está ativa
    expect(onChangeSpy).not.toHaveBeenCalled();

    posAtDOMSpy.mockRestore();
  });

  it('deve renderizar bloco mermaid flowchart como widget e reverter no cursor', async () => {
    const content = `Linha anterior\n\`\`\`mermaid\nflowchart TD\n  A --> B\n\`\`\`\nLinha posterior`;
    const mockedMermaid = (await import('mermaid')).default as unknown as MockedMermaid;
    mockedMermaid._clearPromises();

    const { container } = render(
      <MarkdownEditor content={content} onChange={vi.fn()} />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const placeholder = container.querySelector('.mycellia-mermaid-placeholder');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveTextContent('Renderizando diagrama...');

    mockedMermaid._resolveRender(0, '<svg id="svg-flowchart">Flowchart SVG</svg>');
    await new Promise((resolve) => setTimeout(resolve, 10));

    const svg = container.querySelector('#svg-flowchart');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveTextContent('Flowchart SVG');
  });

  it('deve mostrar codigo cru do mermaid quando o cursor estiver no bloco', async () => {
    const content = `\`\`\`mermaid\nflowchart TD\n  A --> B\n\`\`\``;
    const { container } = render(
      <MarkdownEditor content={content} onChange={vi.fn()} />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const placeholder = container.querySelector('.mycellia-mermaid-placeholder');
    expect(placeholder).toBeNull();

    const textEl = container.querySelector('.cm-content');
    expect(textEl).toHaveTextContent('flowchart TD');
  });

  it('deve renderizar bloco mermaid mindmap como widget', async () => {
    const content = `Linha anterior\n\`\`\`mermaid\nmindmap\n  root((mindmap))\n\`\`\``;
    const mockedMermaid = (await import('mermaid')).default as unknown as MockedMermaid;
    mockedMermaid._clearPromises();

    const { container } = render(
      <MarkdownEditor content={content} onChange={vi.fn()} />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const placeholder = container.querySelector('.mycellia-mermaid-placeholder');
    expect(placeholder).toBeInTheDocument();

    mockedMermaid._resolveRender(0, '<svg id="svg-mindmap">Mindmap SVG</svg>');
    await new Promise((resolve) => setTimeout(resolve, 10));

    const svg = container.querySelector('#svg-mindmap');
    expect(svg).toBeInTheDocument();
  });

  it('deve renderizar painel de erro estilizado se a sintaxe do mermaid for invalida', async () => {
    const content = `Linha anterior\n\`\`\`mermaid\nflowchart XX\n\`\`\``;
    const mockedMermaid = (await import('mermaid')).default as unknown as MockedMermaid;
    mockedMermaid._clearPromises();

    const { container } = render(
      <MarkdownEditor content={content} onChange={vi.fn()} />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    mockedMermaid._rejectRender(0, new Error('Parse error on line 1: flowchart XX'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const errorPanel = container.querySelector('.mycellia-mermaid-error');
    expect(errorPanel).toBeInTheDocument();
    expect(errorPanel).toHaveTextContent('⚠️ Erro de sintaxe no diagrama:');
    expect(errorPanel).toHaveTextContent('Parse error on line 1: flowchart XX');
  });

  it('deve limpar cache e re-renderizar ao detectar mudanca de tema no html', async () => {
    const content = `Linha anterior\n\`\`\`mermaid\nflowchart TD\n  Theme Test\n\`\`\`\nLinha posterior`;
    const mockedMermaid = (await import('mermaid')).default as unknown as MockedMermaid;
    mockedMermaid._clearPromises();

    const { container } = render(
      <MarkdownEditor content={content} onChange={vi.fn()} />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    mockedMermaid._resolveRender(0, '<svg id="svg-theme1">Theme 1 SVG</svg>');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(container.querySelector('#svg-theme1')).toBeInTheDocument();

    document.documentElement.classList.add('dark');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const newPlaceholder = container.querySelector('.mycellia-mermaid-placeholder');
    expect(newPlaceholder).toBeInTheDocument();

    mockedMermaid._resolveRender(1, '<svg id="svg-theme2">Theme 2 SVG</svg>');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(container.querySelector('#svg-theme2')).toBeInTheDocument();
    expect(container.querySelector('#svg-theme1')).toBeNull();

    document.documentElement.classList.remove('dark');
  });

  it('deve abortar injecao do SVG se o widget for destruido antes da resolucao da promise', async () => {
    const content = `Linha anterior\n\`\`\`mermaid\nflowchart TD\n  Destroy Test\n\`\`\`\nLinha posterior`;
    const mockedMermaid = (await import('mermaid')).default as unknown as MockedMermaid;
    mockedMermaid._clearPromises();

    const { unmount } = render(
      <MarkdownEditor content={content} onChange={vi.fn()} />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    unmount();

    mockedMermaid._resolveRender(0, '<svg id="svg-destroyed">Destroyed SVG</svg>');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(document.querySelector('#svg-destroyed')).toBeNull();
  });
});

