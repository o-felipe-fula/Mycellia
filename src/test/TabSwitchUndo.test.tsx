// 🔴 BUG-08 (2026-07-16) — regressão de INTEGRIDADE: Ctrl+Z logo após troca de aba não
// pode ressuscitar o conteúdo da nota anterior no buffer da nota nova. Mecanismo do bug:
// o EditorView nasce com o conteúdo antigo (load da nota nova é async), o replace de
// sincronização entrava no histórico, o undo o desfazia e o autosave gravava a nota
// ANTIGA no arquivo da NOVA (corrupção cross-nota). Fix: Transaction.addToHistory(false).
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MarkdownEditor from '../components/MarkdownEditor';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

describe('BUG-08: undo pós-troca-de-aba (integridade cross-nota)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'load_vault_tree') {
        return { name: 'Vault', path: 'C:\\Vault', is_dir: true, children: [] };
      }
      return undefined;
    });

    useAppStore.setState({
      activeTab: 'C:\\Vault\\nota_nova.md',
      activeNoteContent: 'CONTEUDO DA NOTA ANTERIOR',
      activeNoteYamlDoc: null,
      currentVault: 'C:\\Vault',
      openTabs: ['C:\\Vault\\nota_nova.md'],
      existingNotes: new Map(),
      editorSourceMode: false,
    });
  });

  it('Ctrl+Z não desfaz o replace de sincronização externa (nota anterior NÃO ressuscita)', async () => {
    const onChangeSpy = vi.fn();

    // 1. O view nasce com o conteúdo da nota ANTERIOR (exatamente como na troca de aba
    //    real: o load assíncrono da nota nova ainda não terminou)
    const { container, rerender } = render(
      <MarkdownEditor content={'CONTEUDO DA NOTA ANTERIOR'} onChange={onChangeSpy} />,
    );

    await waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeInTheDocument();
    });

    // 2. O load termina → o content prop muda → o effect de sync substitui o doc
    rerender(<MarkdownEditor content={'conteudo novo'} onChange={onChangeSpy} />);

    await waitFor(() => {
      expect(container.querySelector('.cm-content')!.textContent).toContain('conteudo novo');
    });

    // 3. Usuário aperta Ctrl+Z imediatamente (o gesto que corrompia)
    const cmContent = container.querySelector('.cm-content') as HTMLElement;
    fireEvent.keyDown(cmContent, { key: 'z', ctrlKey: true });

    // 4. O buffer NÃO pode voltar pra nota anterior — e nenhum onChange com o conteúdo
    //    antigo pode ter sido emitido (era isso que virava autosave corrompido)
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(container.querySelector('.cm-content')!.textContent).toContain('conteudo novo');
    expect(container.querySelector('.cm-content')!.textContent).not.toContain('NOTA ANTERIOR');
    expect(onChangeSpy).not.toHaveBeenCalledWith('CONTEUDO DA NOTA ANTERIOR');
  });

  // NOTA: o undo de DIGITAÇÃO do usuário não é testável em jsdom (o CM só aplica
  // mudanças vindas de eventos de input REAIS do DOM). A anotação do fix marca APENAS
  // a transação de sincronização externa — transações de usuário seguem no histórico.
  // Validação do undo de digitação = ao vivo no app (feita via CDP no Review Gate).
});
