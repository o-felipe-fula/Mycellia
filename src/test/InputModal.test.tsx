// UI polish (2026-07-16) — modais do DS no lugar de prompt()/confirm() nativos:
// comportamento do InputModal/ConfirmModal + fluxo real de criar nota pela árvore.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InputModal, ConfirmModal } from '../components/InputModal';
import { validateItemName } from '../utils/validateItemName';
import FileTree from '../components/FileTree';
import { useAppStore, FileNode } from '../store/appStore';

describe('InputModal', () => {
  it('valida nome inválido inline e NÃO confirma', () => {
    const onConfirm = vi.fn();
    render(
      <InputModal
        title="Nova nota"
        confirmLabel="Criar nota"
        validate={validateItemName}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'nome/invalido?' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/caracteres inválidos/i)).toBeInTheDocument();
  });

  it('Enter confirma com valor válido (trimado)', () => {
    const onConfirm = vi.fn();
    render(
      <InputModal
        title="Nova nota"
        confirmLabel="Criar nota"
        validate={validateItemName}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  Minha Nota  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onConfirm).toHaveBeenCalledWith('Minha Nota');
  });

  it('Esc cancela', () => {
    const onCancel = vi.fn();
    render(
      <InputModal title="Nova nota" confirmLabel="Criar" onConfirm={vi.fn()} onCancel={onCancel} />,
    );

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('botão de confirmar fica desabilitado com valor vazio', () => {
    render(
      <InputModal title="Nova nota" confirmLabel="Criar nota" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Criar nota' })).toBeDisabled();
  });
});

describe('ConfirmModal', () => {
  it('renderiza mensagem e confirma no clique', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        title="Mover para a lixeira"
        message='"Nota X" será movido para a lixeira.'
        confirmLabel="Mover para a lixeira"
        danger
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/será movido para a lixeira/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mover para a lixeira' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('FileTree + modais (fluxo real, sem prompt nativo)', () => {
  const mockTree: FileNode = {
    name: 'Vault',
    path: 'C:\\Vault',
    is_dir: true,
    children: [
      { name: 'Nota A.md', path: 'C:\\Vault\\Nota A.md', is_dir: false },
      { name: 'Pasta', path: 'C:\\Vault\\Pasta', is_dir: true, children: [] },
    ],
  };

  beforeEach(() => {
    useAppStore.setState({ activeTab: null, platform: 'windows' });
  });

  it('menu de contexto → "Nova Nota" abre o modal do DS e cria com .md no pai certo', async () => {
    const createSpy = vi.fn(async () => 'C:\\Vault\\Pasta\\Nova.md');
    useAppStore.setState({ createItem: createSpy });

    render(<FileTree node={mockTree} />);

    // Botão direito na pasta → menu → Nova Nota
    fireEvent.contextMenu(screen.getByText('Pasta'));
    fireEvent.click(screen.getByText('Nova Nota (.md)'));

    // Modal do DS no lugar do prompt nativo
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'Nova' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await vi.waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith('C:\\Vault\\Pasta', 'Nova.md', false);
    });
    // Modal fecha após confirmar (re-render no tick seguinte ao await)
    await vi.waitFor(() => {
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  });

  it('excluir passa pelo ConfirmModal (nada de confirm() nativo)', async () => {
    const deleteSpy = vi.fn(async () => {});
    useAppStore.setState({ deleteItem: deleteSpy });

    render(<FileTree node={mockTree} />);

    fireEvent.contextMenu(screen.getByText('Nota A.md'));
    fireEvent.click(screen.getByText('Excluir'));

    expect(screen.getByText(/será movido para a lixeira/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mover para a lixeira' }));

    await vi.waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('C:\\Vault\\Nota A.md');
    });
  });
});
