import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

describe('Frontend Wiki-link Resolution Tie-Breaker (refreshExistingNotes)', () => {
  beforeEach(() => {
    const store = useAppStore.getState();
    store.closeVault();
  });

  it('deve escolher a nota com menor comprimento de caminho relativo em caso de colisão de basename', async () => {
    // Mock de get_all_notes retornando colisão de basename:
    // "pasta_a/sub/Plano.md" (comprimento 20) vs "pasta_b/Plano.md" (comprimento 17)
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'load_config') {
        return {
          current_vault: 'C:\\MyVault',
          recent_vaults: ['C:\\MyVault'],
          theme: 'dark',
          sidebar_width: 260,
        };
      }
      if (cmd === 'load_vault_tree') {
        return {
          name: 'MyVault',
          path: 'C:\\MyVault',
          is_dir: true,
          children: [],
        };
      }
      if (cmd === 'get_all_notes') {
        return [
          { path: 'C:\\MyVault\\pasta_a\\sub\\Plano.md', basename: 'Plano' },
          { path: 'C:\\MyVault\\pasta_b\\Plano.md', basename: 'Plano' },
        ];
      }
      return;
    });

    await useAppStore.getState().initApp();
    // refreshExistingNotes é chamado no fim do loadVault (que é chamado no initApp por ter vault ativo)
    // Mas vamos chamá-lo explicitamente para garantir a execução
    await useAppStore.getState().refreshExistingNotes();

    const existingNotes = useAppStore.getState().existingNotes;

    // Deve resolver para o de menor caminho relativo (pasta_b)
    expect(existingNotes.get('plano')).toBe('C:\\MyVault\\pasta_b\\Plano.md');
  });

  it('deve desempater em ordem alfabética (A-Z primeiro) se os caminhos relativos possuírem o mesmo comprimento', async () => {
    // Mock de get_all_notes com caminhos de mesmo comprimento:
    // "b/Plano.md" (comprimento 10) vs "a/Plano.md" (comprimento 10)
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'load_config') {
        return {
          current_vault: 'C:\\MyVault',
          recent_vaults: ['C:\\MyVault'],
          theme: 'dark',
          sidebar_width: 260,
        };
      }
      if (cmd === 'load_vault_tree') {
        return {
          name: 'MyVault',
          path: 'C:\\MyVault',
          is_dir: true,
          children: [],
        };
      }
      if (cmd === 'get_all_notes') {
        return [
          { path: 'C:\\MyVault\\b\\Plano.md', basename: 'Plano' },
          { path: 'C:\\MyVault\\a\\Plano.md', basename: 'Plano' },
        ];
      }
      return;
    });

    await useAppStore.getState().initApp();
    await useAppStore.getState().refreshExistingNotes();

    const existingNotes = useAppStore.getState().existingNotes;

    // Deve resolver para o alfabeticamente menor (a/Plano.md)
    expect(existingNotes.get('plano')).toBe('C:\\MyVault\\a\\Plano.md');
  });
});
