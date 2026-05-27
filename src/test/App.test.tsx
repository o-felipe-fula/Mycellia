import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../App';

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
});
