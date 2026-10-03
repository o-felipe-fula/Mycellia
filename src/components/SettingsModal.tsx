// D0 (Spec 33): mini-modal de Configurações — o "menuzinho" pedido pelo Felipe (30/07).
// v1: seletor de IDIOMA (Auto/Português/English, troca AO VIVO via i18n) + os toggles
// rápidos que já existem no store (tema, largura da linha, corretor). DNA visual dos
// modais do DS (InputModal/ConfirmModal: portal + overlay blur + glass-card, Esc fecha).
// O D7 (settings hub completo) expande ESTE componente — não cria outro.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import type { LanguageSetting } from '../i18n';

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  testid,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  testid: string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--substrate-base)] p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          data-testid={`${testid}-${opt.value}`}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-xs rounded-md cursor-pointer transition-colors ${
            value === opt.value
              ? 'bg-[var(--accent-muted)] text-[var(--accent)] font-semibold'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--substrate-raised)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      {children}
    </div>
  );
}

export default function SettingsModal() {
  const { t } = useTranslation();
  const {
    isSettingsOpen,
    setSettingsOpen,
    language,
    setLanguage,
    theme,
    setTheme,
    editorWideMode,
    toggleEditorWideMode,
    spellcheckEnabled,
    toggleSpellcheck,
  } = useAppStore();

  useEffect(() => {
    if (!isSettingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isSettingsOpen, setSettingsOpen]);

  if (!isSettingsOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSettingsOpen(false);
      }}
    >
      <div
        data-testid="settings-modal"
        className="glass-card max-w-md w-full p-6 rounded-2xl border border-[var(--border-default)] flex flex-col gap-5 shadow-2xl animate-in zoom-in-95 duration-200"
      >
        <div className="flex items-center gap-2.5">
          <SettingsIcon className="w-5 h-5 text-[var(--accent-dim)]" />
          <h2 className="text-lg font-display font-bold text-[var(--text-primary)]">
            {t('settings.title')}
          </h2>
        </div>

        <SettingsRow label={t('settings.language')}>
          <Segmented<LanguageSetting>
            value={language}
            testid="settings-language"
            onChange={setLanguage}
            options={[
              { value: 'auto', label: t('settings.languageAuto') },
              { value: 'pt-BR', label: t('settings.languagePt') },
              { value: 'en', label: t('settings.languageEn') },
            ]}
          />
        </SettingsRow>

        <SettingsRow label={t('settings.theme')}>
          <Segmented
            value={theme}
            testid="settings-theme"
            onChange={(v) => setTheme(v)}
            options={[
              { value: 'dark', label: t('settings.themeDark') },
              { value: 'light', label: t('settings.themeLight') },
            ]}
          />
        </SettingsRow>

        <SettingsRow label={t('settings.wideMode')}>
          <Segmented
            value={editorWideMode ? 'full' : 'comfort'}
            testid="settings-widemode"
            onChange={(v) => {
              if ((v === 'full') !== editorWideMode) toggleEditorWideMode();
            }}
            options={[
              { value: 'comfort', label: t('settings.wideModeComfort') },
              { value: 'full', label: t('settings.wideModeFull') },
            ]}
          />
        </SettingsRow>

        <SettingsRow label={t('settings.spellcheck')}>
          <Segmented
            value={spellcheckEnabled ? 'on' : 'off'}
            testid="settings-spellcheck"
            onChange={(v) => {
              if ((v === 'on') !== spellcheckEnabled) toggleSpellcheck();
            }}
            options={[
              { value: 'on', label: t('settings.on') },
              { value: 'off', label: t('settings.off') },
            ]}
          />
        </SettingsRow>

        <div className="flex items-center justify-end mt-1">
          <button
            onClick={() => setSettingsOpen(false)}
            className="px-4 py-2 text-xs rounded-lg font-medium cursor-pointer transition-all border border-[var(--border-default)] bg-transparent hover:bg-[var(--substrate-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
