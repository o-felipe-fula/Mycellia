// E1 (Spec 25) — Matriz de tipos Mermaid: garante que TODO fence ```mermaid vira
// MermaidWidget e que o código chega INTACTO no mermaid.render, tipo a tipo.
// (O SVG real de cada tipo é validado ao vivo no Review Gate — jsdom não renderiza SVG.)
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MarkdownEditor from '../components/MarkdownEditor';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

interface MockedMermaid {
  _clearPromises: () => void;
  _resolveRender: (index: number, svg: string) => void;
  _getPromises: () => { id: string; code: string }[];
}

vi.mock('mermaid', () => {
  let renderPromises: { resolve: (val: { svg: string }) => void; reject: (err: unknown) => void; id: string; code: string }[] = [];
  return {
    default: {
      initialize: vi.fn(),
      render: vi.fn().mockImplementation((id: string, code: string) => {
        return new Promise((resolve, reject) => {
          renderPromises.push({ resolve, reject, id, code });
        });
      }),
      _resolveRender: (index: number, svg: string) => {
        if (renderPromises[index]) {
          renderPromises[index].resolve({ svg });
        }
      },
      _clearPromises: () => {
        renderPromises = [];
      },
      _getPromises: () => renderPromises,
    },
  };
});

// Um snippet mínimo válido por tipo de diagrama do Mermaid v11
const DIAGRAM_TYPES: Array<{ name: string; code: string }> = [
  { name: 'flowchart', code: 'flowchart TD\n  A --> B' },
  { name: 'graph (alias de flowchart)', code: 'graph LR\n  A --> B' },
  { name: 'sequenceDiagram', code: 'sequenceDiagram\n  Alice->>Bob: Oi' },
  { name: 'classDiagram', code: 'classDiagram\n  Animal <|-- Pato' },
  { name: 'stateDiagram-v2', code: 'stateDiagram-v2\n  [*] --> Ativo' },
  { name: 'erDiagram', code: 'erDiagram\n  CLIENTE ||--o{ PEDIDO : faz' },
  { name: 'gantt', code: 'gantt\n  title Cronograma\n  section Fase\n  Tarefa :a1, 2026-01-01, 3d' },
  { name: 'pie', code: 'pie title Distribuicao\n  "A" : 60\n  "B" : 40' },
  { name: 'quadrantChart', code: 'quadrantChart\n  title Matriz\n  x-axis Baixo --> Alto\n  y-axis Lento --> Rapido\n  Item: [0.5, 0.5]' },
  { name: 'requirementDiagram', code: 'requirementDiagram\n  requirement req1 {\n  id: 1\n  text: requisito\n  }' },
  { name: 'gitGraph', code: 'gitGraph\n  commit\n  branch dev\n  commit' },
  { name: 'C4Context', code: 'C4Context\n  title Sistema\n  Person(user, "Usuario")' },
  { name: 'mindmap', code: 'mindmap\n  root((central))\n    ramo' },
  { name: 'timeline', code: 'timeline\n  title Historia\n  2025 : evento' },
  { name: 'journey', code: 'journey\n  title Jornada\n  section Dia\n    Acordar: 5: Eu' },
  { name: 'sankey-beta', code: 'sankey-beta\n  A,B,10' },
  { name: 'xychart-beta', code: 'xychart-beta\n  title "Vendas"\n  x-axis [jan, fev]\n  bar [10, 20]' },
  { name: 'block-beta', code: 'block-beta\n  columns 2\n  a b' },
  { name: 'packet-beta', code: 'packet-beta\n  0-15: "Campo A"' },
  { name: 'kanban', code: 'kanban\n  Todo\n    tarefa1' },
  { name: 'architecture-beta', code: 'architecture-beta\n  group api(cloud)[API]' },
];

// FLAKE-guard (padrão FLAKE-02): sob carga da suíte inteira o ciclo assíncrono do
// CodeMirror passa do timeout default de 1s — espera ativa folgada, asserções idênticas.
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 });

describe('Matriz de tipos Mermaid (E1)', () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'load_vault_tree') {
        return { name: 'Vault', path: 'C:\\Vault', is_dir: true, children: [] };
      }
      return undefined;
    });

    useAppStore.setState({
      activeTab: 'C:\\Vault\\nota_teste.md',
      activeNoteContent: '',
      activeNoteYamlDoc: null,
      currentVault: 'C:\\Vault',
      openTabs: ['C:\\Vault\\nota_teste.md'],
      existingNotes: new Map(),
    });

    const mockedMermaid = (await import('mermaid')).default as unknown as MockedMermaid;
    mockedMermaid._clearPromises();
  });

  it.each(DIAGRAM_TYPES)('renderiza fence mermaid do tipo $name como widget com código intacto', async ({ code }) => {
    const content = `Linha inicial\n\`\`\`mermaid\n${code}\n\`\`\``;
    const mockedMermaid = (await import('mermaid')).default as unknown as MockedMermaid;

    const { container } = render(<MarkdownEditor content={content} onChange={vi.fn()} />);

    // O fence virou widget (placeholder de render aparece)
    await waitFor(() => {
      expect(container.querySelector('.mycellia-mermaid-placeholder')).toBeInTheDocument();
    });

    // O código do diagrama chegou BYTE A BYTE no mermaid.render
    await waitFor(() => {
      const calls = mockedMermaid._getPromises();
      expect(calls.length).toBe(1);
      expect(calls[0].code).toBe(code);
    });

    // E o SVG resolvido é injetado no lugar do placeholder
    mockedMermaid._resolveRender(0, '<svg data-testid="diagrama">SVG</svg>');
    await waitFor(() => {
      expect(container.querySelector('[data-testid="diagrama"]')).toBeInTheDocument();
    });
  });
});
