// E5 (Spec 29): roteamento por extensão — a whitelist é FECHADA (desconhecido = external,
// nunca vira buffer de texto editável)
import { describe, it, expect } from 'vitest';
import { getFileKind, getLanguageId, getExtension } from '../utils/fileKind';

describe('getFileKind (E5 — Spec 29)', () => {
  it('roteia .md pra markdown (case-insensitive)', () => {
    expect(getFileKind('C:\\Vault\\nota.md')).toBe('markdown');
    expect(getFileKind('C:\\Vault\\NOTA.MD')).toBe('markdown');
    expect(getFileKind('/vault/sub/nota.md')).toBe('markdown');
  });

  it('roteia os formatos de texto/código da whitelist pra text', () => {
    for (const ext of ['txt', 'json', 'xml', 'yaml', 'yml', 'csv', 'toml', 'css', 'html', 'js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'sql', 'sh', 'log', 'ini']) {
      expect(getFileKind(`C:\\Vault\\arquivo.${ext}`)).toBe('text');
    }
    expect(getFileKind('C:\\Vault\\CONFIG.JSON')).toBe('text');
  });

  it('roteia .pdf pro viewer', () => {
    expect(getFileKind('C:\\Vault\\manual.pdf')).toBe('pdf');
    expect(getFileKind('C:\\Vault\\MANUAL.PDF')).toBe('pdf');
  });

  it('todo o resto é external (whitelist fechada)', () => {
    expect(getFileKind('C:\\Vault\\app.exe')).toBe('external');
    expect(getFileKind('C:\\Vault\\foto.png')).toBe('external');
    expect(getFileKind('C:\\Vault\\dados.xlsx')).toBe('external');
    expect(getFileKind('C:\\Vault\\sem_extensao')).toBe('external');
  });

  it('dotfiles não têm extensão — caem em external', () => {
    expect(getFileKind('C:\\Vault\\.gitignore')).toBe('external');
    expect(getExtension('.gitignore')).toBe('');
  });

  it('getLanguageId: código tem linguagem, texto puro é null', () => {
    expect(getLanguageId('C:\\Vault\\config.json')).toBe('json');
    expect(getLanguageId('C:\\Vault\\config.yml')).toBe('yaml');
    expect(getLanguageId('C:\\Vault\\comp.tsx')).toBe('typescript');
    expect(getLanguageId('C:\\Vault\\notas.txt')).toBeNull();
    expect(getLanguageId('C:\\Vault\\dados.csv')).toBeNull();
  });
});
