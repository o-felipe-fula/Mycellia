// D0 (Spec 33): i18n + mini-modal de Configurações — resolução do 'auto' pelo locale,
// troca AO VIVO de idioma, persistência no config, modal pelos 2 caminhos (engrenagem
// do ribbon; palette coberto pelo mesmo setSettingsOpen) e Esc fecha.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';
import i18n, { resolveLanguage, applyLanguage } from '../i18n';
import SettingsModal from '../components/SettingsModal';
import ActivityRibbon from '../components/ActivityRibbon';

function setNavigatorLanguage(lang: string) {
  Object.defineProperty(window.navigator, 'language', { value: lang, configurable: true });
}

describe('D0 — i18n + Configurações', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined as never);
    applyLanguage('pt-BR'); // baseline determinística (jsdom nasce en-US)
    useAppStore.setState({ language: 'pt-BR', isSettingsOpen: false });
  });

  afterEach(() => {
    cleanup();
    applyLanguage('pt-BR');
  });

  it("resolveLanguage: 'auto' detecta pt* → pt-BR e o resto → en", () => {
    setNavigatorLanguage('pt-BR');
    expect(resolveLanguage('auto')).toBe('pt-BR');
    setNavigatorLanguage('pt');
    expect(resolveLanguage('auto')).toBe('pt-BR');
    setNavigatorLanguage('en-US');
    expect(resolveLanguage('auto')).toBe('en');
    setNavigatorLanguage('fr-FR');
    expect(resolveLanguage('auto')).toBe('en');
    // escolha explícita ignora o sistema
    expect(resolveLanguage('pt-BR')).toBe('pt-BR');
    expect(resolveLanguage('en')).toBe('en');
  });

  it('applyLanguage troca a instância viva do i18n (t() flipa na hora)', () => {
    expect(i18n.t('settings.title')).toBe('Configurações');
    applyLanguage('en');
    expect(i18n.t('settings.title')).toBe('Settings');
    expect(i18n.t('ribbon.files', { mod: 'Ctrl' })).toBe('File Explorer (Ctrl + Shift + E)');
  });

  it('modal: trocar o idioma re-renderiza AO VIVO e persiste language no config', () => {
    useAppStore.setState({ isSettingsOpen: true });
    render(<SettingsModal />);

    expect(screen.getByText('Configurações')).toBeTruthy();
    fireEvent.click(screen.getByTestId('settings-language-en'));

    // UI flipou na hora
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(useAppStore.getState().language).toBe('en');
    expect(i18n.language).toBe('en');
    // persistiu
    const saveCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'save_config');
    expect((saveCall![1] as { config: { language: string } }).config.language).toBe('en');
  });

  it('engrenagem do ribbon abre o modal; Esc fecha', () => {
    render(
      <>
        <ActivityRibbon />
        <SettingsModal />
      </>
    );
    expect(screen.queryByTestId('settings-modal')).toBeNull();

    fireEvent.click(screen.getByTestId('ribbon-settings'));
    expect(screen.getByTestId('settings-modal')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('settings-modal')).toBeNull();
    expect(useAppStore.getState().isSettingsOpen).toBe(false);
  });

  it('modal: toggles rápidos (corretor) refletem e mudam o store', () => {
    useAppStore.setState({ isSettingsOpen: true, spellcheckEnabled: true });
    render(<SettingsModal />);

    fireEvent.click(screen.getByTestId('settings-spellcheck-off'));
    expect(useAppStore.getState().spellcheckEnabled).toBe(false);
    // clicar no já-ativo não dispara toggle de novo
    fireEvent.click(screen.getByTestId('settings-spellcheck-off'));
    expect(useAppStore.getState().spellcheckEnabled).toBe(false);
  });

  it('init aplica o idioma salvo do config (en → UI em inglês)', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'load_config') {
        return {
          current_vault: null,
          recent_vaults: [],
          theme: 'dark',
          sidebar_width: 260,
          editor_wide_mode: false,
          right_panel_width: 300,
          spellcheck_enabled: true,
          language: 'en',
        };
      }
      return undefined;
    });
    await useAppStore.getState().initApp();
    expect(useAppStore.getState().language).toBe('en');
    expect(i18n.language).toBe('en');
  });
});
