// E4 Fatia 2 (Spec 30): editor Excalidraw pra .excalidraw. Contratos pinados:
// roteamento do kind · parse do arquivo em initialData · DIRTY-GATE por getSceneVersion
// (onChange de viewport/seleção NUNCA vira save — risco #1 da spec) · arquivo vazio =
// canvas novo (create_item cria vazio) · fail-soft de JSON corrompido.
// A lib é mockada (jsdom não roda canvas real) — o alvo é o CONTRATO do wrapper;
// o comportamento real valida no Review Gate ao vivo.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import { getFileKind } from '../utils/fileKind';
import { applyLanguage } from '../i18n';

interface MockElement {
  id: string;
  version: number;
}

// Captura os props passados ao <Excalidraw> mockado pra simular onChange nos testes
let lastExcalidrawProps: Record<string, unknown> = {};

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (props: Record<string, unknown>) => {
    lastExcalidrawProps = props;
    return <div data-testid="excalidraw-mock" />;
  },
  // Mesma semântica da real: soma das versions dos elementos (muda ⇔ cena mudou)
  getSceneVersion: (elements: MockElement[]) =>
    elements.reduce((acc, el) => acc + (el.version ?? 0), 0),
  serializeAsJSON: (elements: MockElement[]) =>
    JSON.stringify({ type: 'excalidraw', version: 2, elements }),
}));
vi.mock('@excalidraw/excalidraw/index.css', () => ({}));

import ExcalidrawEditor from '../components/ExcalidrawEditor';

const FILE_PATH = 'C:\\MyVault\\Desenhos\\Fluxo.excalidraw';
const SAVED_SCENE = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  elements: [
    { id: 'a', version: 3 },
    { id: 'b', version: 5 },
  ],
});

function fireExcalidrawChange(elements: MockElement[]) {
  const onChange = lastExcalidrawProps.onChange as (
    elements: MockElement[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>
  ) => void;
  act(() => {
    onChange(elements, {}, {});
  });
}

describe('E4 Fatia 2 — ExcalidrawEditor (.excalidraw)', () => {
  beforeEach(() => {
    lastExcalidrawProps = {};
    useAppStore.setState({ activeTab: FILE_PATH, notifications: [], theme: 'dark' });
  });

  it('roteamento: .excalidraw ganha kind próprio', () => {
    expect(getFileKind('C:\\v\\Desenho.excalidraw')).toBe('excalidraw');
    expect(getFileKind('C:\\v\\Mapa.canvas')).toBe('canvas');
  });

  it('monta o Excalidraw com os elements do arquivo (initialData do parse)', () => {
    render(<ExcalidrawEditor content={SAVED_SCENE} onChange={vi.fn()} />);
    expect(screen.getByTestId('excalidraw-mock')).toBeTruthy();
    const initialData = lastExcalidrawProps.initialData as { elements: MockElement[] };
    expect(initialData.elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('D0 (Spec 33): langCode do Excalidraw segue o idioma do app (fix do review 30/07)', () => {
    useAppStore.setState({ language: 'pt-BR' });
    const { unmount } = render(<ExcalidrawEditor content={SAVED_SCENE} onChange={vi.fn()} />);
    expect(lastExcalidrawProps.langCode).toBe('pt-BR');
    unmount();

    useAppStore.setState({ language: 'en' });
    applyLanguage('en');
    render(<ExcalidrawEditor content={SAVED_SCENE} onChange={vi.fn()} />);
    expect(lastExcalidrawProps.langCode).toBe('en');
    useAppStore.setState({ language: 'pt-BR' });
  });

  it('DIRTY-GATE: onChange com a MESMA scene version (pan/zoom/seleção) não gera save', () => {
    const onChange = vi.fn();
    render(<ExcalidrawEditor content={SAVED_SCENE} onChange={onChange} />);

    // Excalidraw dispara onChange no mount/viewport — mesma versão (3+5=8) ⇒ ignorado
    fireExcalidrawChange([
      { id: 'a', version: 3 },
      { id: 'b', version: 5 },
    ]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('edição REAL (scene version muda) → save com o JSON serializado da cena', () => {
    const onChange = vi.fn();
    render(<ExcalidrawEditor content={SAVED_SCENE} onChange={onChange} />);

    fireExcalidrawChange([
      { id: 'a', version: 4 }, // elemento movido/editado
      { id: 'b', version: 5 },
    ]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(onChange.mock.calls[0][0] as string);
    expect(saved.type).toBe('excalidraw');
    expect(saved.elements).toHaveLength(2);

    // Mesma versão de novo (9) ⇒ não salva em dobro
    fireExcalidrawChange([
      { id: 'a', version: 4 },
      { id: 'b', version: 5 },
    ]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('arquivo VAZIO = canvas novo (cena em branco), não JSON corrompido', () => {
    render(<ExcalidrawEditor content="" onChange={vi.fn()} />);
    expect(screen.getByTestId('excalidraw-mock')).toBeTruthy();
    expect(screen.queryByTestId('excalidraw-fallback')).toBeNull();
    const initialData = lastExcalidrawProps.initialData as { elements: MockElement[] };
    expect(initialData.elements).toEqual([]);
  });

  it('fail-soft: JSON corrompido → fallback read-only com conteúdo cru + notificação', () => {
    render(<ExcalidrawEditor content="{quebrado" onChange={vi.fn()} />);
    expect(screen.getByTestId('excalidraw-fallback').textContent).toContain('{quebrado');
    expect(
      useAppStore.getState().notifications.some((n) => n.message.includes('inválido'))
    ).toBe(true);
  });
});
