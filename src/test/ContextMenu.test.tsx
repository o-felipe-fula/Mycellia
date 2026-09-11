import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ContextMenu from '../components/ContextMenu';

describe('ContextMenu', () => {
  const defaultProps = {
    x: 100,
    y: 100,
    onClose: vi.fn(),
    onCreateFile: vi.fn(),
    onCreateCanvas: vi.fn(),
    onCreateFolder: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  };

  it('deve renderizar todas as acoes do menu de contexto', () => {
    render(<ContextMenu {...defaultProps} />);

    expect(screen.getByText(/Nova Nota \(.md\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Novo Canvas/i)).toBeInTheDocument();
    expect(screen.getByText(/Nova Pasta/i)).toBeInTheDocument();
    expect(screen.getByText(/Renomear/i)).toBeInTheDocument();
    expect(screen.getByText(/Excluir/i)).toBeInTheDocument();
  });

  it('deve disparar os callbacks corretos ao clicar nos botoes', () => {
    render(<ContextMenu {...defaultProps} />);

    // Teste Nova Nota
    fireEvent.click(screen.getByText(/Nova Nota \(.md\)/i));
    expect(defaultProps.onCreateFile).toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();

    // Teste Novo Canvas
    fireEvent.click(screen.getByText(/Novo Canvas/i));
    expect(defaultProps.onCreateCanvas).toHaveBeenCalled();

    // Teste Renomear
    fireEvent.click(screen.getByText(/Renomear/i));
    expect(defaultProps.onRename).toHaveBeenCalled();
  });

  it('deve fechar ao pressionar a tecla Escape', () => {
    render(<ContextMenu {...defaultProps} />);

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
