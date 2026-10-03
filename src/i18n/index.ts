// D0 (Spec 33): i18n do Mycellia — pt-BR é a FONTE DA VERDADE, en é espelho completo,
// fallback de chave faltante cai no pt-BR (nunca chave crua na tela). 100% local:
// recursos em JSON no bundle, zero fetch de tradução (§1.5).
// `auto` resolve pelo locale do sistema: pt* → pt-BR, resto → en — o default certo
// pra distribuição open source bilíngue (decisão do Felipe, Spec 33 §3).
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ptBR from './pt-BR.json';
import en from './en.json';

export type LanguageSetting = 'auto' | 'pt-BR' | 'en';
export type ResolvedLanguage = 'pt-BR' | 'en';

export function resolveLanguage(setting: LanguageSetting): ResolvedLanguage {
  if (setting === 'pt-BR' || setting === 'en') return setting;
  const sys = (typeof navigator !== 'undefined' ? navigator.language : 'pt-BR') || 'pt-BR';
  return sys.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    'pt-BR': { translation: ptBR },
    en: { translation: en },
  },
  lng: resolveLanguage('auto'),
  fallbackLng: 'pt-BR',
  interpolation: { escapeValue: false }, // React já escapa
  returnEmptyString: false,
});

/** Aplica a escolha do usuário (config `language`) na instância viva — troca AO VIVO */
export function applyLanguage(setting: LanguageSetting): void {
  void i18n.changeLanguage(resolveLanguage(setting));
}

export default i18n;
