// E5 (Spec 29) — Multi-formato: regressão BYTE-A-BYTE do caminho de não-md (a mais
// importante da spec). Não-md nunca passa pelo parser de frontmatter (um `---` inicial de
// .yaml seria comido e regravado errado), abrir sem editar = ZERO write, salvar preserva
// CRLF/BOM/ausência de \n final, PDF nunca passa por read_file, e arquivo ilegível
// (não-UTF-8) faz fallback pro app padrão sem deixar buffer vazio editável.
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';
import FileViewer from '../components/FileViewer';

let mockFiles: Record<string, string> = {};
let writeCalls: { path: string; content: string }[] = [];
let readCalls: string[] = [];
let defaultAppCalls: string[] = [];
let backlinkQueryCalls: string[] = [];

const JSON_CRLF = '{\r\n  "nome": "mycellia",\r\n  "versao": 1\r\n}';
const YAML_DOC_MARKERS = '---\nfoo: bar\n---\nsegunda_parte: x\n';
const CSV_BOM = '﻿a,b\r\n1,2\r\n';

describe('E5 Multi-formato (Spec 29) — integridade byte-a-byte de não-md', () => {
  beforeEach(() => {
    mockFiles = {
      'C:\\MyVault\\Nota A.md': 'Conteúdo Original da Nota A',
      'C:\\MyVault\\config.json': JSON_CRLF,
      'C:\\MyVault\\doc.yaml': YAML_DOC_MARKERS,
      'C:\\MyVault\\dados.csv': CSV_BOM,
      'C:\\MyVault\\manual.pdf': '<binário>',
      'C:\\MyVault\\quebrado.txt': '<não-utf8>',
    };
    writeCalls = [];
    readCalls = [];
    defaultAppCalls = [];
    backlinkQueryCalls = [];

    useAppStore.getState().closeVault();

    vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
      if (cmd === 'load_config') {
        return {
          current_vault: 'C:\\MyVault',
          recent_vaults: ['C:\\MyVault'],
          theme: 'dark',
          sidebar_width: 260,
        };
      }
      if (cmd === 'load_vault_tree') {
        const children = Object.keys(mockFiles).map((path) => {
          const name = path.split('\\').pop() || '';
          return { name, path, is_dir: false };
        });
        return { name: 'MyVault', path: 'C:\\MyVault', is_dir: true, children };
      }
      if (cmd === 'read_file') {
        const path = (args as { path: string })?.path;
        readCalls.push(path);
        if (path.endsWith('quebrado.txt')) {
          throw new Error('stream did not contain valid UTF-8');
        }
        const normalized = path.replace(/\\/g, '/');
        const key = Object.keys(mockFiles).find((k) => k.replace(/\\/g, '/') === normalized);
        if (key) return mockFiles[key];
        throw new Error(`File not found: ${path}`);
      }
      if (cmd === 'write_file') {
        const { path, content } = args as { path: string; content: string };
        writeCalls.push({ path, content });
        const normalized = path.replace(/\\/g, '/');
        const key = Object.keys(mockFiles).find((k) => k.replace(/\\/g, '/') === normalized) || path;
        mockFiles[key] = content;
        return;
      }
      if (cmd === 'open_in_default_app') {
        defaultAppCalls.push((args as { path: string })?.path);
        return;
      }
      if (cmd === 'get_backlinks' || cmd === 'get_outgoing_links') {
        backlinkQueryCalls.push(cmd);
        return [];
      }
      if (cmd === 'get_all_notes') {
        return Object.keys(mockFiles)
          .filter((p) => p.endsWith('.md'))
          .map((path) => ({ path, basename: path.split('\\').pop()?.replace('.md', '') || '' }));
      }
      return;
    });
  });

  it('abrir .json: conteúdo cru no buffer, frontmatter vazio, ZERO write no disco', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\config.json');

    const s = useAppStore.getState();
    expect(s.activeNoteContent).toBe(JSON_CRLF);
    expect(s.activeNoteRawFrontmatter).toBe('');
    expect(s.activeNoteYamlDoc).toBeNull();
    expect(s.activeContentPath).toBe('C:\\MyVault\\config.json');

    // Abrir sem editar = zero write; bytes do disco intactos (CRLF preservado no buffer)
    expect(writeCalls).toHaveLength(0);
    expect(mockFiles['C:\\MyVault\\config.json']).toBe(JSON_CRLF);
  });

  it('.yaml com `---` de document marker NÃO é comido pelo parser de frontmatter', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\doc.yaml');

    const s = useAppStore.getState();
    // O regex de frontmatter do md casaria os dois `---` — pra .yaml o conteúdo INTEIRO
    // (marcadores inclusos) tem que estar no buffer
    expect(s.activeNoteContent).toBe(YAML_DOC_MARKERS);
    expect(s.activeNoteRawFrontmatter).toBe('');

    // E o save pós-edição regrava os marcadores intactos
    const editado = YAML_DOC_MARKERS + 'nova_linha: y\n';
    await useAppStore.getState().updateActiveNoteContent(editado);
    await useAppStore.getState().flushPendingSave();
    expect(mockFiles['C:\\MyVault\\doc.yaml']).toBe(editado);
    expect(mockFiles['C:\\MyVault\\doc.yaml'].startsWith('---\nfoo: bar\n---\n')).toBe(true);
  });

  it('salvar .json editado grava byte a byte, JAMAIS injeta frontmatter', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\config.json');

    const editado = '{\r\n  "nome": "mycellia",\r\n  "versao": 2\r\n}';
    await useAppStore.getState().updateActiveNoteContent(editado);
    await useAppStore.getState().flushPendingSave();

    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0].path).toBe('C:\\MyVault\\config.json');
    expect(writeCalls[0].content).toBe(editado);
    expect(mockFiles['C:\\MyVault\\config.json']).toBe(editado);
    expect(mockFiles['C:\\MyVault\\config.json'].startsWith('---')).toBe(false);
  });

  it('BOM + CRLF + sem \\n final sobrevivem ao round-trip de save', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\dados.csv');
    expect(useAppStore.getState().activeNoteContent).toBe(CSV_BOM);

    // Edita mantendo BOM/CRLF (é o que o PlainTextEditor emite — lineSeparator \r\n)
    const editado = '﻿a,b\r\n1,2\r\n3,4';
    await useAppStore.getState().updateActiveNoteContent(editado);
    await useAppStore.getState().flushPendingSave();

    const salvo = mockFiles['C:\\MyVault\\dados.csv'];
    expect(salvo).toBe(editado);
    expect(salvo.charCodeAt(0)).toBe(0xfeff); // BOM intacto
    expect(salvo.includes('\r\n')).toBe(true); // CRLF intacto
    expect(salvo.endsWith('\n')).toBe(false); // sem \n final adicionado
  });

  it('alternar md ↔ não-md sem editar não gera NENHUM write', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');
    await useAppStore.getState().openTab('C:\\MyVault\\config.json');
    await useAppStore.getState().setActiveTab('C:\\MyVault\\Nota A.md');
    await useAppStore.getState().setActiveTab('C:\\MyVault\\config.json');

    expect(writeCalls).toHaveLength(0);
    expect(mockFiles['C:\\MyVault\\Nota A.md']).toBe('Conteúdo Original da Nota A');
    expect(mockFiles['C:\\MyVault\\config.json']).toBe(JSON_CRLF);
  });

  it('abrir .pdf NUNCA chama read_file (binário) e não cria buffer de edição', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\manual.pdf');

    const s = useAppStore.getState();
    expect(s.activeTab).toBe('C:\\MyVault\\manual.pdf');
    expect(readCalls).not.toContain('C:\\MyVault\\manual.pdf');
    expect(s.activeNoteContent).toBeNull();
    expect(s.activeContentPath).toBeNull();
  });

  it('não-md não consulta o índice de backlinks (fica fora do grafo)', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\config.json');

    expect(backlinkQueryCalls).toHaveLength(0);
    expect(useAppStore.getState().activeNoteBacklinks).toEqual([]);
    expect(useAppStore.getState().activeNoteOutgoingLinks).toEqual([]);
  });

  it('arquivo ilegível (não-UTF-8): fecha a aba, abre no app padrão, buffer vazio NÃO fica editável', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\Nota A.md');
    await useAppStore.getState().openTab('C:\\MyVault\\quebrado.txt');

    const s = useAppStore.getState();
    // A aba quebrada não sobrevive — foco volta pra anterior, sem buffer '' do quebrado
    expect(s.openTabs).not.toContain('C:\\MyVault\\quebrado.txt');
    expect(s.activeTab).toBe('C:\\MyVault\\Nota A.md');
    expect(s.activeNoteContent).toBe('Conteúdo Original da Nota A');
    expect(defaultAppCalls).toContain('C:\\MyVault\\quebrado.txt');
    // E nada foi escrito por cima do arquivo quebrado
    expect(writeCalls).toHaveLength(0);
    expect(mockFiles['C:\\MyVault\\quebrado.txt']).toBe('<não-utf8>');
  });

  it('FileViewer: monta o editor de texto só com o conteúdo REAL da aba carregado', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\config.json');

    const { container } = render(<FileViewer />);
    await vi.waitFor(() => {
      expect(container.querySelector('.cm-content')).toBeInTheDocument();
    });

    // Gate anti-stale: content de OUTRA aba (activeContentPath divergente) → não monta
    useAppStore.setState({ activeContentPath: 'C:\\MyVault\\outro.json' });
    const { container: gated } = render(<FileViewer />);
    expect(gated.querySelector('.cm-content')).toBeNull();
  });

  it('FileViewer: PDF monta iframe via asset protocol (sem read_file)', async () => {
    await useAppStore.getState().initApp();
    await useAppStore.getState().openTab('C:\\MyVault\\manual.pdf');

    const { getByTestId } = render(<FileViewer />);
    const frame = getByTestId('pdf-viewer-frame');
    expect(frame.getAttribute('src')).toContain('mock-asset://');
    expect(frame.getAttribute('src')).toContain('manual.pdf');
  });
});
