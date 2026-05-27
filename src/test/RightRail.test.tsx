import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import App from '../App';
import { useAppStore } from '../store/appStore';

describe('Right Rail and Panel toggle', () => {
  beforeEach(() => {
    // Reset store state with active vault and active tab
    useAppStore.setState({
      currentVault: 'C:\\Vaults\\Mycellia',
      isRightPanelOpen: false,
      rightView: 'backlinks',
      centerView: 'editor',
      activeTab: 'Nota A.md',
      openTabs: ['Nota A.md'],
      fileTree: {
        name: 'Mycellia',
        path: 'C:\\Vaults\\Mycellia',
        is_dir: true,
        children: []
      }
    });
  });

  it('deve renderizar o trilho direito quando o painel direito estiver fechado', () => {
    render(<App />);
    expect(screen.getByTestId('right-rail')).toBeInTheDocument();
  });

  it('não deve renderizar o trilho direito quando o painel direito estiver aberto', () => {
    useAppStore.setState({ isRightPanelOpen: true });
    render(<App />);
    expect(screen.queryByTestId('right-rail')).not.toBeInTheDocument();
  });

  it('deve reabrir o painel direito e alterar a vista correta ao clicar em um botao do trilho', () => {
    render(<App />);
    
    // O trilho direito esta visivel
    expect(useAppStore.getState().isRightPanelOpen).toBe(false);

    // Clicar no botao Backlinks
    const backlinksBtn = screen.getByTitle('Backlinks');
    fireEvent.click(backlinksBtn);

    // Deve abrir o painel e definir a visualizacao correta
    expect(useAppStore.getState().isRightPanelOpen).toBe(true);
    expect(useAppStore.getState().rightView).toBe('backlinks');
  });

  it('deve ocultar o botao Nota do trilho direito quando o centro for editor (Modelo de Foco)', () => {
    // Centro: editor
    useAppStore.setState({ centerView: 'editor', activeTab: 'Nota A.md' });
    render(<App />);

    expect(screen.queryByTitle('Nota')).not.toBeInTheDocument();
    expect(screen.getByTitle('Grafo')).toBeInTheDocument();
  });

  it('deve ocultar o botao Grafo do trilho direito quando o centro for graph (Modelo de Foco)', () => {
    // Centro: graph
    useAppStore.setState({ centerView: 'graph', activeTab: 'Nota A.md' });
    render(<App />);

    expect(screen.queryByTitle('Grafo')).not.toBeInTheDocument();
    expect(screen.getByTitle('Nota')).toBeInTheDocument();
  });
});
