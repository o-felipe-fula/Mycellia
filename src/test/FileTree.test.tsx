import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
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
});
