import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from '../App';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

const mockClose = vi.fn();
const mockOnCloseRequested = vi.fn().mockResolvedValue(vi.fn());

vi.mock('@tauri-apps/api/window', () => {
  return {
    getCurrentWindow: () => ({
      onCloseRequested: mockOnCloseRequested,
      close: mockClose,
      isMaximized: vi.fn().mockResolvedValue(false),
      minimize: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn().mockResolvedValue(undefined),
      unmaximize: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

describe('App', () => {
  it('deve renderizar a tela de boas-vindas quando nenhum vault estiver ativo', async () => {
    render(<App />);

    // Usando findByText que é assíncrono e evita o aviso act(...) do React
    expect(await screen.findByText(/Bem-vindo ao/i)).toBeInTheDocument();

    const elements = screen.getAllByText(/Mycellia/i);
    expect(elements.length).toBeGreaterThan(0);
    expect(elements[0]).toBeInTheDocument();

    expect(screen.getByText(/Abrir pasta existente/i)).toBeInTheDocument();
  });

  it('deve interceptar onCloseRequested e executar flushPendingSave', async () => {
    let capturedHandler: ((event: any) => Promise<void>) | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    mockOnCloseRequested.mockImplementation((handler) => {
      capturedHandler = handler;
      return Promise.resolve(vi.fn());
    });

    render(<App />);

    expect(mockOnCloseRequested).toHaveBeenCalled();
    expect(capturedHandler).not.toBeNull();

    // Configura a nota ativa e conteúdo na store
    useAppStore.setState({
      activeTab: 'C:\\Vault\\nota.md',
    });
    
    // Altera o conteúdo para forçar pendingSave
    useAppStore.getState().updateActiveNoteContent('Novo conteúdo da nota');

    const mockEvent = {
      preventDefault: vi.fn(),
    };

    // Reseta mock do invoke
    vi.mocked(invoke).mockClear();

    await capturedHandler!(mockEvent);

    expect(mockEvent.preventDefault).toHaveBeenCalled();

    // Deve ter invocado write_file com o conteúdo correto
    expect(invoke).toHaveBeenCalledWith('write_file', {
      path: 'C:\\Vault\\nota.md',
      content: 'Novo conteúdo da nota',
      allowCreate: false,
    });

    // Deve ter fechado a janela
    expect(mockClose).toHaveBeenCalled();
  });
});
