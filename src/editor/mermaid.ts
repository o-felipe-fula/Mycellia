// Subsistema Mermaid do editor (F3 — Spec 17), extraído intacto do MarkdownEditor.tsx:
// lazy-load do módulo (offline-first, chunk separado), cache de SVG, observer de tema
// (dispara themeChangeEffect pro live preview rebuildar) e o widget assíncrono com as
// 3 correções de leak/async do §32 (unmount guard, limpeza de nó temporário, filtro de
// mutação de tema). securityLevel: 'strict' sempre.
import { EditorView, WidgetType, ViewPlugin, type PluginValue } from '@codemirror/view';
import { themeChangeEffect } from './shared';

let mermaidModule: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

async function loadMermaid() {
  if (mermaidModule) return mermaidModule;
  const mod = await import('mermaid');
  mermaidModule = mod.default || mod;
  mermaidModule.initialize({
    startOnLoad: false,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
    securityLevel: 'strict',
    // E1 (Spec 25): sem SVG-bomba de erro injetado no <body> — o painel de erro é nosso
    suppressErrorRendering: true,
  });
  return mermaidModule;
}

const mermaidCache = new Map<string, string>();
let nextMermaidIdCounter = 0;

class MermaidThemeObserver implements PluginValue {
  private observer: MutationObserver;
  private isDark: boolean;

  constructor(readonly view: EditorView) {
    this.isDark = document.documentElement.classList.contains('dark');

    this.observer = new MutationObserver(() => {
      const currentIsDark = document.documentElement.classList.contains('dark');
      // Correção 3: filtrar mutação de tema para evitar re-chamadas atoa
      if (currentIsDark !== this.isDark) {
        this.isDark = currentIsDark;
        if (mermaidModule) {
          mermaidModule.initialize({
            theme: currentIsDark ? 'dark' : 'default',
            securityLevel: 'strict',
            suppressErrorRendering: true,
          });
        }
        mermaidCache.clear();
        view.dispatch({
          effects: themeChangeEffect.of(),
        });
      }
    });

    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  update() {}

  destroy() {
    this.observer.disconnect();
  }
}

export const mermaidThemePlugin = ViewPlugin.fromClass(MermaidThemeObserver);

export class MermaidWidget extends WidgetType {
  private destroyed = false;
  readonly isDark: boolean;

  constructor(readonly code: string) {
    super();
    this.isDark = document.documentElement.classList.contains('dark');
  }

  toDOM(_view: EditorView) {
    const container = document.createElement('div');
    container.className = 'mycellia-mermaid-wrapper my-4 flex justify-center select-none';

    // Verify cache
    const cachedSvg = mermaidCache.get(this.code);
    if (cachedSvg) {
      container.innerHTML = cachedSvg;
      return container;
    }

    // Placeholder skeleton
    const placeholder = document.createElement('div');
    placeholder.className = 'mycellia-mermaid-placeholder animate-skeleton-pulse w-full h-[150px] bg-[var(--substrate-raised)] rounded-lg flex items-center justify-center text-[var(--text-muted)] font-sans text-xs';
    placeholder.textContent = 'Renderizando diagrama...';
    container.appendChild(placeholder);

    const id = `mycellia-mermaid-${nextMermaidIdCounter++}`;

    loadMermaid()
      .then((m) => {
        if (this.destroyed) return;
        return m.render(id, this.code);
      })
      .then((renderResult) => {
        if (!renderResult) return;
        const { svg } = renderResult;

        // Correção 2 — limpar nó temporário do mermaid no DOM (se mermaid v10+ não removeu)
        const tempElement = document.getElementById(id) || document.getElementById(`d${id}`);
        if (tempElement && tempElement.parentNode) {
          tempElement.parentNode.removeChild(tempElement);
        }

        // Correção 1 — guarda de widget desmontado (obrigatória)
        if (this.destroyed) {
          return;
        }

        mermaidCache.set(this.code, svg);
        container.innerHTML = svg;
      })
      .catch((err) => {
        // Remover nó temporário no catch também
        const tempElement = document.getElementById(id) || document.getElementById(`d${id}`);
        if (tempElement && tempElement.parentNode) {
          tempElement.parentNode.removeChild(tempElement);
        }

        if (this.destroyed) {
          return;
        }

        console.error('Mermaid render error:', err);
        container.innerHTML = '';

        const errorPanel = document.createElement('div');
        errorPanel.className = 'mycellia-mermaid-error w-full p-3 rounded-lg border border-[var(--border-strong)] bg-[var(--substrate-raised)] text-[var(--danger)] text-xs font-mono whitespace-pre-wrap';

        let errorMsg = '⚠️ Erro de sintaxe no diagrama:\n';
        if (err instanceof Error) {
          errorMsg += err.message;
        } else if (typeof err === 'string') {
          errorMsg += err;
        } else {
          errorMsg += String(err);
        }

        errorPanel.textContent = errorMsg;
        container.appendChild(errorPanel);
      });

    return container;
  }

  destroy() {
    this.destroyed = true;
  }

  eq(other: MermaidWidget) {
    return other.code === this.code && other.isDark === this.isDark;
  }
}
