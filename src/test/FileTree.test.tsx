import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FileTree from '../components/FileTree';
import { FileNode } from '../store/appStore';

const mockTree: FileNode = {
  name: 'VaultTest',
  path: 'C:\\VaultTest',
  is_dir: true,
  children: [
    {
      name: 'Pasta A',
      path: 'C:\\VaultTest\\Pasta A',
      is_dir: true,
      children: [
        {
          name: 'Nota 1.md',
          path: 'C:\\VaultTest\\Pasta A\\Nota 1.md',
          is_dir: false,
        },
      ],
    },
    {
      name: 'Nota Avulsa.md',
      path: 'C:\\VaultTest\\Nota Avulsa.md',
      is_dir: false,
    },
  ],
};

describe('FileTree', () => {
  it('deve renderizar a raiz do vault e os arquivos de primeiro nivel', () => {
    render(<FileTree node={mockTree} />);
    expect(screen.getByText('VaultTest')).toBeInTheDocument();
    expect(screen.getByText('Pasta A')).toBeInTheDocument();
    expect(screen.getByText('Nota Avulsa.md')).toBeInTheDocument();
  });

  it('deve alternar a expansao das pastas ao clicar', () => {
    render(<FileTree node={mockTree} />);

    // Inicialmente, "Nota 1.md" nao deve estar visivel porque Pasta A nao esta expandida por padrao
    expect(screen.queryByText('Nota 1.md')).not.toBeInTheDocument();

    // Clica na Pasta A para expandir
    fireEvent.click(screen.getByText('Pasta A'));

    // Agora "Nota 1.md" deve estar visivel
    expect(screen.getByText('Nota 1.md')).toBeInTheDocument();

    // Clica na Pasta A novamente para recolher
    fireEvent.click(screen.getByText('Pasta A'));
    expect(screen.queryByText('Nota 1.md')).not.toBeInTheDocument();
  });

  it('deve simular dragStart e drop de uma nota para uma pasta', async () => {
    const { useAppStore } = await import('../store/appStore');
    const moveItemSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ moveItem: moveItemSpy });

    render(<FileTree node={mockTree} />);

    const notaAvulsa = screen.getByText('Nota Avulsa.md').closest('[draggable="true"]');
    const pastaA = screen.getByText('Pasta A').closest('[draggable="true"]');

    expect(notaAvulsa).not.toBeNull();
    expect(pastaA).not.toBeNull();

    // Simula Drag Start
    const dragStartEvent = {
      dataTransfer: {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue('C:\\VaultTest\\Nota Avulsa.md'),
      },
      stopPropagation: vi.fn(),
    };
    fireEvent.dragStart(notaAvulsa!, dragStartEvent);
    expect(dragStartEvent.dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'C:\\VaultTest\\Nota Avulsa.md');

    // Simula Drag Over
    fireEvent.dragOver(pastaA!);

    // Simula Drop
    const dropEvent = {
      dataTransfer: {
        getData: vi.fn().mockReturnValue('C:\\VaultTest\\Nota Avulsa.md'),
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    fireEvent.drop(pastaA!, dropEvent);

    expect(moveItemSpy).toHaveBeenCalledWith('C:\\VaultTest\\Nota Avulsa.md', 'C:\\VaultTest\\Pasta A');
  });

  it('deve chamar preventDefault no dragOver de alvo valido e nao chamar no invalido', () => {
    render(<FileTree node={mockTree} />);

    const notaAvulsa = screen.getByText('Nota Avulsa.md').closest('[draggable="true"]');
    const pastaA = screen.getByText('Pasta A').closest('[draggable="true"]');

    expect(notaAvulsa).not.toBeNull();
    expect(pastaA).not.toBeNull();

    // 1. Simula dragStart na Nota Avulsa para definir o estado draggedPath
    const dragStartEvent = {
      dataTransfer: {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue('C:\\VaultTest\\Nota Avulsa.md'),
      },
      stopPropagation: vi.fn(),
    };
    fireEvent.dragStart(notaAvulsa!, dragStartEvent);

    // 2. Simula dragOver sobre alvo VALIDO (Pasta A) e afirma preventDefault chamado
    const dragOverValidEvent = new Event('dragover', { bubbles: true, cancelable: true });
    vi.spyOn(dragOverValidEvent, 'preventDefault');
    const dataTransferValid = { dropEffect: 'none' };
    Object.defineProperty(dragOverValidEvent, 'dataTransfer', { value: dataTransferValid });

    fireEvent(pastaA!, dragOverValidEvent);
    expect(dragOverValidEvent.preventDefault).toHaveBeenCalled();
    expect(dataTransferValid.dropEffect).toBe('move');

    // 3. Simula dragOver sobre alvo INVALIDO (a propria Nota Avulsa) e afirma preventDefault NAO chamado
    const dragOverInvalidEvent = new Event('dragover', { bubbles: true, cancelable: true });
    vi.spyOn(dragOverInvalidEvent, 'preventDefault');
    const dataTransferInvalid = { dropEffect: 'none' };
    Object.defineProperty(dragOverInvalidEvent, 'dataTransfer', { value: dataTransferInvalid });

    fireEvent(notaAvulsa!, dragOverInvalidEvent);
    expect(dragOverInvalidEvent.preventDefault).not.toHaveBeenCalled();
    expect(dataTransferInvalid.dropEffect).toBe('none');
  });
});
