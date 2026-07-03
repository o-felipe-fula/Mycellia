import '@testing-library/jest-dom';
import { vi } from 'vitest';

interface TestWindow extends Window {
  __tauriListeners?: Record<string, ((event: { payload: unknown }) => void)[]>;
  __triggerTauriEvent?: (event: string, payload: unknown) => void;
}

// Mock das APIs do Tauri v2 para ambiente de teste Vitest
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === 'load_config') {
      return Promise.resolve({
        current_vault: null,
        recent_vaults: [],
        theme: 'dark',
        sidebar_width: 260,
      });
    }
    return Promise.resolve();
  }),
  convertFileSrc: vi.fn().mockImplementation((path: string) => `mock-asset://${path}`),
}));

Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: {
    invoke: vi.fn(),
  },
  writable: true,
});

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: vi.fn().mockResolvedValue(vi.fn()),
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    minimize: vi.fn().mockResolvedValue(undefined),
    maximize: vi.fn().mockResolvedValue(undefined),
    unmaximize: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation((event: string, cb: (event: { payload: unknown }) => void) => {
    const w = window as TestWindow;
    if (!w.__tauriListeners) {
      w.__tauriListeners = {};
    }
    if (!w.__tauriListeners[event]) {
      w.__tauriListeners[event] = [];
    }
    w.__tauriListeners[event].push(cb);
    return Promise.resolve(() => {
      if (w.__tauriListeners && w.__tauriListeners[event]) {
        w.__tauriListeners[event] = w.__tauriListeners[event].filter((c) => c !== cb);
      }
    });
  }),
}));

(window as TestWindow).__triggerTauriEvent = (event: string, payload: unknown) => {
  const w = window as TestWindow;
  const list = w.__tauriListeners?.[event] || [];
  list.forEach((cb) => cb({ payload }));
};

// Mock window.matchMedia for JSDom environment
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver for JSDom environment
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
});
