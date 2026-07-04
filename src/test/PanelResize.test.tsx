import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import { usePanelResize } from '../hooks/usePanelResize';
import { invoke } from '@tauri-apps/api/core';

function Harness() {
  const { handleMouseDown, handleRightMouseDown } = usePanelResize();
  return (
    <div>
      <div data-testid="left-splitter" onMouseDown={handleMouseDown} />
      <div data-testid="right-splitter" onMouseDown={handleRightMouseDown} />
    </div>
  );
}

describe('usePanelResize (BUG-03)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValue(undefined as never);
    useAppStore.setState({
      sidebarWidth: 260,
      rightPanelWidth: 300,
      currentVault: 'C:\\Vault',
      recentVaults: [],
      theme: 'dark',
    });
  });

  it('BUG-03: splitter esquerdo atualiza ao vivo no drag e PERSISTE a config só no mouseup', async () => {
    const { getByTestId } = render(<Harness />);

    fireEvent.mouseDown(getByTestId('left-splitter'), { clientX: 260 + 48 });
    fireEvent.mouseMove(document, { clientX: 300 + 48 });

    // Ao vivo durante o drag...
    expect(useAppStore.getState().sidebarWidth).toBe(300);
    // ...mas SEM martelar a config a cada pixel
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('save_config', expect.anything());

    fireEvent.mouseUp(document);

    // No mouseup, a largura final persiste na config (antes do fix: nunca persistia)
    await vi.waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        'save_config',
        expect.objectContaining({
          config: expect.objectContaining({ sidebar_width: 300 }),
        })
      );
    });
  });

  it('splitter direito atualiza ao vivo no drag e mantém a largura no mouseup', () => {
    const { getByTestId } = render(<Harness />);

    fireEvent.mouseDown(getByTestId('right-splitter'), { clientX: 800 });
    fireEvent.mouseMove(document, { clientX: 760 }); // delta -40 → 300 + 40 = 340

    expect(useAppStore.getState().rightPanelWidth).toBe(340);

    fireEvent.mouseUp(document);
    expect(useAppStore.getState().rightPanelWidth).toBe(340);
  });

  it('drag não vaza listener: mover depois do mouseup não altera mais a largura', () => {
    const { getByTestId } = render(<Harness />);

    fireEvent.mouseDown(getByTestId('left-splitter'), { clientX: 308 });
    fireEvent.mouseMove(document, { clientX: 348 });
    fireEvent.mouseUp(document);
    const widthAfterUp = useAppStore.getState().sidebarWidth;

    fireEvent.mouseMove(document, { clientX: 448 });
    expect(useAppStore.getState().sidebarWidth).toBe(widthAfterUp);
  });
});
