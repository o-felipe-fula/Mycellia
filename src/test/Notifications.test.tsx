import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToastContainer } from '../components/ToastContainer';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

// F1.2 — Sistema de notificações (toasts). Cobre o código NOVO: notify/dismiss, auto-dismiss
// dos transitórios, persistência dos graves, render do container, religação de um handler
// antes mudo, e o retry de save preservando o texto.
describe('F1 — Sistema de notificações (toasts)', () => {
  beforeEach(() => {
    useAppStore.setState({
      notifications: [],
      globalError: null,
      activeTab: null,
      activeNoteContent: null,
      activeNoteRawFrontmatter: null,
      activeNoteBaseSerialized: null,
      activeNoteBacklinks: [],
      isBacklinksLoading: false,
      graphSearchQuery: '',
    });
    vi.clearAllMocks();
  });

  it('1. transitório aparece e some sozinho após o ttl', () => {
    vi.useFakeTimers();
    try {
      act(() => {
        useAppStore.getState().notify('error', 'Falha na busca.');
      });
      expect(useAppStore.getState().notifications).toHaveLength(1);
      expect(useAppStore.getState().notifications[0].message).toBe('Falha na busca.');

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(useAppStore.getState().notifications).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('2. persistente NÃO some sozinho; só sai via dismissNotification', () => {
    vi.useFakeTimers();
    try {
      let id = '';
      act(() => {
        id = useAppStore.getState().notify('error', 'Falha grave', { persistent: true });
      });
      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(useAppStore.getState().notifications).toHaveLength(1);

      act(() => {
        useAppStore.getState().dismissNotification(id);
      });
      expect(useAppStore.getState().notifications).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('3. ToastContainer renderiza a mensagem e o botão fechar remove', () => {
    act(() => {
      useAppStore.getState().notify('warning', 'Falha ao carregar os backlinks.', { persistent: true });
    });

    render(<ToastContainer />);
    expect(screen.getByText('Falha ao carregar os backlinks.')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Fechar notificação'));
    expect(useAppStore.getState().notifications).toHaveLength(0);
  });

  it('4. loadBacklinks (antes mudo) agora notifica em erro', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('db error'));

    await useAppStore.getState().loadBacklinks('C:\\Vaults\\Mycellia\\Nota.md');

    const notes = useAppStore.getState().notifications;
    expect(notes.some((n) => n.message === 'Falha ao carregar os backlinks.')).toBe(true);
    // Comportamento existente preservado: estado limpo.
    expect(useAppStore.getState().isBacklinksLoading).toBe(false);
  });

  it('5. falha ao salvar → toast persistente com "Tentar de novo" e o texto é preservado', async () => {
    useAppStore.setState({
      activeTab: 'C:\\Vaults\\Mycellia\\Nota.md',
      activeNoteRawFrontmatter: '',
      activeNoteBaseSerialized: 'antigo',
    });

    // Cria o pendingSave (edição) e força a escrita a falhar.
    await useAppStore.getState().updateActiveNoteContent('texto novo do usuário');
    vi.mocked(invoke).mockRejectedValue(new Error('disco cheio'));

    await useAppStore.getState().flushPendingSave();

    const saveNotif = useAppStore.getState().notifications.find((n) => n.persistent && n.action);
    expect(saveNotif).toBeTruthy();
    expect(saveNotif?.action?.label).toBe('Tentar de novo');
    // O TEXTO DO USUÁRIO NUNCA SE PERDE.
    expect(useAppStore.getState().activeNoteContent).toBe('texto novo do usuário');
  });

  it('6. "Tentar de novo" salva a nota que FALHOU, mesmo após editar outra', async () => {
    // Save da nota A falha → toast de A.
    useAppStore.setState({ activeTab: 'C:\\Vaults\\Mycellia\\A.md', activeNoteRawFrontmatter: '' });
    await useAppStore.getState().updateActiveNoteContent('conteudo A');
    vi.mocked(invoke).mockRejectedValueOnce(new Error('falha A'));
    await useAppStore.getState().flushPendingSave();

    const notif = useAppStore.getState().notifications.find((n) => n.persistent && n.action);
    expect(notif).toBeTruthy();

    // Usuário troca p/ B e edita B (sobrescreve o pendingSave global).
    useAppStore.setState({ activeTab: 'C:\\Vaults\\Mycellia\\B.md', activeNoteRawFrontmatter: '' });
    await useAppStore.getState().updateActiveNoteContent('conteudo B');

    // Clica "Tentar de novo" no toast da A → deve salvar A (a que falhou), não B.
    vi.mocked(invoke).mockResolvedValue(undefined as never);
    notif?.action?.run();
    await new Promise((r) => setTimeout(r, 0));

    const writeCalls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === 'write_file');
    const lastWrite = writeCalls[writeCalls.length - 1];
    expect(lastWrite?.[1]).toMatchObject({ path: 'C:\\Vaults\\Mycellia\\A.md' });
    expect((lastWrite?.[1] as { content: string }).content).toContain('conteudo A');
  });
});
