// Validação de nome de arquivo/pasta (UI polish 2026-07-16): mesmas regras do rename
// inline do MarkdownEditor — uma mensagem só pro usuário em todo lugar.
export function validateItemName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'O nome não pode ser vazio';
  }
  if (/[\\/:*?"<>|]/.test(trimmed)) {
    return 'O nome contém caracteres inválidos. Não use: \\ / : * ? " < > |';
  }
  return null;
}
