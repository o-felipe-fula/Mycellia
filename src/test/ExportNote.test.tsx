// E6 (trilha E) — exportação: render markdown→HTML standalone (puro), fluxo de salvar
// HTML (dialog + comando Rust mockados) e criação do iframe de impressão.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderNoteToHtml, exportNoteAsHtml, printNote } from '../utils/exportNote';
import { invoke } from '@tauri-apps/api/core';

const saveMock = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...args: unknown[]) => saveMock(...args),
}));

describe('renderNoteToHtml (E6)', () => {
  it('gera HTML standalone com título e o corpo renderizado', () => {
    const html = renderNoteToHtml('# Seção\ntexto com **negrito** e `código`', 'Minha Nota');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>Minha Nota</title>');
    expect(html).toContain('<h1>Minha Nota</h1>');
    expect(html).toContain('<strong>negrito</strong>');
    expect(html).toContain('<code>código</code>');
    expect(html).toContain('<style>'); // CSS embutido
  });

  it('achata wiki-links pra texto legível (alias, ou nome sem path/#)', () => {
    const html = renderNoteToHtml('veja [[Alvo]], [[Nota#Seção]] e [[X|apelido]]', 'T');
    expect(html).toContain('veja Alvo, Nota e apelido');
    expect(html).not.toContain('[[');
  });

  it('sanitiza: script no markdown não sobrevive', () => {
    const html = renderNoteToHtml('texto\n<script>alert(1)</script>', 'T');
    expect(html).not.toContain('<script>alert');
  });

  it('escapa o título (sem injeção via nome de nota)', () => {
    const html = renderNoteToHtml('corpo', '<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x onerror');
  });
});

describe('exportNoteAsHtml (E6)', () => {
  beforeEach(() => {
    saveMock.mockReset();
    vi.mocked(invoke).mockClear();
  });

  it('salva o HTML no caminho escolhido via export_text_file', async () => {
    saveMock.mockResolvedValue('C:\\Users\\user\\Desktop\\Nota.html');
    const result = await exportNoteAsHtml('# Oi', 'Nota');

    expect(result).toBe('saved');
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      'export_text_file',
      expect.objectContaining({
        path: 'C:\\Users\\user\\Desktop\\Nota.html',
        content: expect.stringContaining('<h1>Nota</h1>'),
      }),
    );
  });

  it('cancelar o diálogo NÃO escreve arquivo', async () => {
    saveMock.mockResolvedValue(null);
    const result = await exportNoteAsHtml('# Oi', 'Nota');

    expect(result).toBe('cancelled');
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('export_text_file', expect.anything());
  });
});

describe('printNote (E6)', () => {
  it('injeta um iframe com o HTML da nota (o print do SO abre no onload)', () => {
    const before = document.querySelectorAll('iframe').length;
    printNote('# Conteúdo', 'Nota');
    const frames = document.querySelectorAll('iframe');
    expect(frames.length).toBe(before + 1);
    const last = frames[frames.length - 1] as HTMLIFrameElement;
    expect(last.srcdoc).toContain('<h1>Nota</h1>');
    last.remove();
  });
});
