// E3 (Spec 32): marcação de erro ortográfico — sublinhado ondulado em palavra
// desconhecida (pt-BR + en-US + dicionário pessoal, motor no core Rust).
// Desenho anti-perf-regressão (o risco oficial do backlog): só o VIEWPORT é
// verificado (visibleRanges), com debounce e cache de veredito por palavra —
// o front manda pro Rust apenas o vocabulário novo, nunca a nota inteira.
// Zonas ignoradas: código (inline/fenced), frontmatter, URLs, hashtags,
// wiki-links/embeds, URL de link markdown, tags HTML, tokens com dígito e
// palavras ALL-CAPS (siglas). Zero caminho de escrita.
import { EditorView, Decoration, ViewPlugin, type ViewUpdate, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';
import { isRangeInCode } from './utils';

export interface WordSpan {
  word: string;
  from: number;
  to: number;
}

// ── Tokenização pura (testável isolada) ──────────────────────────────────────

// Zonas mascaradas com espaços (offsets preservados) ANTES de tokenizar
const MASKS: RegExp[] = [
  /`[^`]*`/g, // código inline
  /!?\[\[[^\]]*\]\]/g, // wiki-links e embeds inteiros (target E alias)
  /\]\([^)]*\)/g, // a URL de um link markdown [texto](url) — o texto continua válido
  /https?:\/\/\S+/g, // URLs cruas
  /#[\p{L}\p{N}_/-]+/gu, // hashtags (charset espelha o parser de tags)
  /<[^>\n]+>/g, // tags HTML inline
  /\S*\d\S*/g, // qualquer token com dígito (v0.7, abc123, 10h30)
];

const WORD_RE = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;
const ALL_CAPS_RE = /^[\p{Lu}\p{M}]{2,}$/u;

/** Extrai as palavras verificáveis de UMA linha (offsets absolutos via lineFrom) */
export function checkableWordsInLine(text: string, lineFrom: number): WordSpan[] {
  let masked = text;
  for (const re of MASKS) {
    masked = masked.replace(re, (m) => ' '.repeat(m.length));
  }
  const out: WordSpan[] = [];
  for (const m of masked.matchAll(WORD_RE)) {
    const word = m[0];
    if (word.length < 2) continue; // letra solta não é erro digno de sublinhado
    if (ALL_CAPS_RE.test(word)) continue; // sigla (IPC, CDP, UAUFLOW)
    out.push({ word, from: lineFrom + (m.index ?? 0), to: lineFrom + (m.index ?? 0) + word.length });
  }
  return out;
}

/** Range [from, to) do frontmatter YAML no início do doc (0,0 se não houver) */
export function frontmatterEnd(state: EditorState): number {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trim() !== '---') return 0;
  for (let l = 2; l <= doc.lines; l++) {
    const line = doc.line(l);
    if (line.text.trim() === '---') return line.to;
  }
  return 0;
}

// ── Cache de veredito por palavra (sessão; limpo quando o dicionário pessoal muda) ──

const verdictCache = new Map<string, boolean>();
const CACHE_CAP = 20000;

export function clearSpellCache(): void {
  verdictCache.clear();
}

// ── "Ignorar nesta sessão" (L4 da spec: dura até fechar o app; não persiste) ──

const sessionIgnored = new Set<string>();

export function ignoreWordThisSession(word: string): void {
  sessionIgnored.add(word);
}

export function clearSessionIgnored(): void {
  sessionIgnored.clear();
}

// ── Decorações via StateField + effect (o plugin async publica aqui) ──

const setSpellDecorations = StateEffect.define<DecorationSet>();
/** Cutucada externa (toggle no palette): força o plugin a reavaliar */
export const spellcheckToggled = StateEffect.define<void>();

const spellField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setSpellDecorations)) deco = e.value;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const errorMark = Decoration.mark({ class: 'cm-spell-error' });

let warmedUp = false;

const spellPlugin = ViewPlugin.fromClass(
  class {
    private timer: number | null = null;
    private destroyed = false;

    constructor(private readonly view: EditorView) {
      if (!warmedUp) {
        // Aquece o load dos dicionários (pt ~440ms) fora do caminho do 1º check
        warmedUp = true;
        void invoke('spellcheck_warmup').catch(() => {});
      }
      this.schedule();
    }

    update(u: ViewUpdate) {
      const poked = u.transactions.some((tr) => tr.effects.some((e) => e.is(spellcheckToggled)));
      if (u.docChanged || u.viewportChanged || poked) this.schedule();
    }

    private schedule() {
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.timer = null;
        void this.run();
      }, 300);
    }

    private async run() {
      if (this.destroyed) return;
      const view = this.view;

      if (!useAppStore.getState().spellcheckEnabled) {
        view.dispatch({ effects: setSpellDecorations.of(Decoration.none) });
        return;
      }

      // 1) Coleta os spans verificáveis do viewport (pulando frontmatter, código e
      //    palavras ignoradas nesta sessão)
      const fmEnd = frontmatterEnd(view.state);
      const spans: WordSpan[] = [];
      for (const range of view.visibleRanges) {
        let pos = Math.max(range.from, fmEnd);
        while (pos <= range.to) {
          const line = view.state.doc.lineAt(pos);
          if (line.text.length > 0 && !isRangeInCode(view.state, line.from, line.to)) {
            for (const span of checkableWordsInLine(line.text, line.from)) {
              // palavra parcialmente fora do range visível ainda vale — o range é por linha
              if (!sessionIgnored.has(span.word)) spans.push(span);
            }
          }
          if (line.to + 1 > range.to) break;
          pos = line.to + 1;
        }
      }

      // 2) Vocabulário ainda sem veredito → UMA chamada em lote pro Rust
      const unknown = [...new Set(spans.map((s) => s.word))].filter((w) => !verdictCache.has(w));
      if (unknown.length > 0) {
        try {
          const verdicts = await invoke<boolean[]>('check_words', { words: unknown });
          if (verdictCache.size + unknown.length > CACHE_CAP) verdictCache.clear();
          unknown.forEach((w, i) => verdictCache.set(w, verdicts[i] ?? true));
        } catch {
          // Motor indisponível (ex.: teste sem mock): fail-soft, sem decoração nova
          return;
        }
      }
      if (this.destroyed) return;

      // 3) Publica as decorações das palavras reprovadas
      const ranges = spans
        .filter((s) => verdictCache.get(s.word) === false)
        .sort((a, b) => a.from - b.from)
        .map((s) => errorMark.range(s.from, s.to));
      view.dispatch({ effects: setSpellDecorations.of(Decoration.set(ranges, true)) });
    }

    destroy() {
      this.destroyed = true;
      if (this.timer !== null) window.clearTimeout(this.timer);
    }
  }
);

// ── Menu de contexto: sugestões + adicionar ao dicionário + ignorar sessão ──

interface SpellHit {
  word: string;
  from: number;
  to: number;
}

/** Range de erro ortográfico decorado que contém `pos` (null se não houver) */
function findSpellErrorAt(view: EditorView, pos: number): SpellHit | null {
  let hit: SpellHit | null = null;
  view.state.field(spellField).between(pos, pos, (from, to) => {
    hit = { word: view.state.doc.sliceString(from, to), from, to };
    return false;
  });
  return hit;
}

let openMenu: HTMLElement | null = null;
let closeListeners: (() => void) | null = null;

function closeSpellMenu() {
  openMenu?.remove();
  openMenu = null;
  closeListeners?.();
  closeListeners = null;
}

function menuButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = label;
  // mousedown (não click): fecha ANTES do mousedown-away global disparar
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function openSpellMenu(view: EditorView, hit: SpellHit, x: number, y: number) {
  closeSpellMenu();
  const menu = document.createElement('div');
  menu.className = 'mycellia-spellmenu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const hintEl = document.createElement('div');
  hintEl.className = 'mycellia-spellmenu-hint';
  hintEl.textContent = 'Buscando sugestões…';
  menu.appendChild(hintEl);

  const actions = document.createElement('div');
  actions.className = 'mycellia-spellmenu-actions';
  actions.appendChild(
    menuButton('Adicionar ao dicionário', 'mycellia-spellmenu-add', () => {
      void invoke('add_personal_word', { word: hit.word })
        .then(() => {
          clearSpellCache(); // o veredito da palavra mudou pro processo inteiro
          view.dispatch({ effects: spellcheckToggled.of() });
        })
        .catch(() => {
          useAppStore.getState().notify('warning', 'Não foi possível salvar no dicionário pessoal.');
        });
      closeSpellMenu();
    })
  );
  actions.appendChild(
    menuButton('Ignorar nesta sessão', 'mycellia-spellmenu-ignore', () => {
      ignoreWordThisSession(hit.word);
      view.dispatch({ effects: spellcheckToggled.of() });
      closeSpellMenu();
    })
  );
  menu.appendChild(actions);

  document.body.appendChild(menu);
  openMenu = menu;

  // Clampa dentro da viewport (depois de medir)
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${Math.max(0, window.innerWidth - rect.width - 8)}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${Math.max(0, y - rect.height)}px`;

  // Fecha em clique fora ou Esc
  const onAway = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) closeSpellMenu();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeSpellMenu();
  };
  document.addEventListener('mousedown', onAway, true);
  document.addEventListener('keydown', onKey, true);
  closeListeners = () => {
    document.removeEventListener('mousedown', onAway, true);
    document.removeEventListener('keydown', onKey, true);
  };

  // Sugestões chegam async (pt ~100-330ms) — o menu já está utilizável enquanto isso
  void invoke<string[]>('suggest_word', { word: hit.word })
    .then((suggestions) => {
      if (openMenu !== menu) return; // menu já fechou/trocou
      hintEl.remove();
      if (suggestions.length === 0) {
        const none = document.createElement('div');
        none.className = 'mycellia-spellmenu-hint';
        none.textContent = 'Sem sugestões';
        menu.prepend(none);
        return;
      }
      // ordem reversa + prepend ⇒ sugestões no topo, na ordem original
      for (const sug of [...suggestions].reverse()) {
        menu.prepend(
          menuButton(sug, 'mycellia-spellmenu-suggestion', () => {
            view.dispatch({ changes: { from: hit.from, to: hit.to, insert: sug } });
            view.focus();
            closeSpellMenu();
          })
        );
      }
    })
    .catch(() => {
      if (openMenu !== menu) return;
      hintEl.textContent = 'Sem sugestões';
    });
}

const spellContextMenu = EditorView.domEventHandlers({
  contextmenu(event, view) {
    const target = event.target as HTMLElement;
    if (!target.closest('.cm-spell-error')) return false;
    // posAtCoords precisa de layout real (jsdom LANÇA sem getClientRects) — posAtDOM cobre
    let pos: number | null = null;
    try {
      pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    } catch {
      // ambiente sem layout (testes): segue pro fallback
    }
    if (pos === null) pos = view.posAtDOM(target);
    const hit = findSpellErrorAt(view, pos);
    if (!hit) return false;
    event.preventDefault();
    openSpellMenu(view, hit, event.clientX, event.clientY);
    return true;
  },
});

export function spellcheckExtension() {
  return [spellField, spellPlugin, spellContextMenu];
}
