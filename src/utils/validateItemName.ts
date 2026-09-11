// Validação de nome de arquivo/pasta (UI polish 2026-07-16): mesmas regras do rename
// inline do MarkdownEditor — uma mensagem só pro usuário em todo lugar.
// D0 (Spec 33): mensagens via i18n (módulo puro → i18n.t direto).
import i18n from '../i18n';

export function validateItemName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return i18n.t('validate.emptyName');
  }
  if (/[\\/:*?"<>|]/.test(trimmed)) {
    return i18n.t('validate.invalidChars');
  }
  return null;
}
