import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MarkdownEditor from '../components/MarkdownEditor';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';
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
});
