// Callouts/admonitions Obsidian-style (E1 — Spec 25): detecção do padrão `> [!tipo]` no
// Blockquote, widget de cartão (ícone + título + corpo) e o pipeline de render do corpo
// (marked → DOMPurify estrito → pós-passes DOM de wiki-link e callout aninhado).
// Só EXIBIÇÃO: nenhuma mutação de documento acontece aqui — o buffer fica byte a byte igual.
import { WidgetType } from '@codemirror/view';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { useAppStore } from '../store/appStore';

// ---------------------------------------------------------------------------
// Registro de tipos (paridade Obsidian: aliases, cor e ícone por tipo)
// ---------------------------------------------------------------------------

interface CalloutKind {
  key: string;
  rgb: string; // "r, g, b" — vira --callout-rgb no widget
  icon: string; // SVG inline estático (strings constantes, nunca input do usuário)
}

const svg = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const KINDS: Record<string, CalloutKind> = {
  note: {
    key: 'note',
    rgb: '68, 138, 255',
    icon: svg('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>'),
  },
  abstract: {
    key: 'abstract',
    rgb: '0, 191, 188',
    icon: svg('<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>'),
  },
  info: {
    key: 'info',
    rgb: '68, 138, 255',
    icon: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  },
  todo: {
    key: 'todo',
    rgb: '68, 138, 255',
    icon: svg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  },
  tip: {
    key: 'tip',
    rgb: '0, 191, 188',
    icon: svg('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
  },
  success: {
    key: 'success',
    rgb: '68, 207, 110',
    icon: svg('<path d="M20 6 9 17l-5-5"/>'),
  },
  question: {
    key: 'question',
    rgb: '236, 117, 0',
    icon: svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  },
  warning: {
    key: 'warning',
    rgb: '236, 117, 0',
    icon: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  },
  failure: {
    key: 'failure',
    rgb: '233, 49, 71',
    icon: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  },
  danger: {
    key: 'danger',
    rgb: '233, 49, 71',
    icon: svg('<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>'),
  },
  bug: {
    key: 'bug',
    rgb: '233, 49, 71',
    icon: svg('<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>'),
  },
  example: {
    key: 'example',
    rgb: '120, 82, 238',
    icon: svg('<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>'),
  },
  quote: {
    key: 'quote',
    rgb: '158, 158, 158',
    icon: svg('<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>'),
  },
};

const ALIASES: Record<string, string> = {
  note: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  info: 'info',
  todo: 'todo',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'failure',
  fail: 'failure',
  missing: 'failure',
  danger: 'danger',
  error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
};

const CHEVRON = svg('<path d="m9 18 6-6-6-6"/>');

// ---------------------------------------------------------------------------
// Parsing do bloco cru (texto do nó Blockquote, com os marcadores '>')
// ---------------------------------------------------------------------------

const CALLOUT_FIRST_LINE = /^>\s*\[!([a-zA-Z][a-zA-Z0-9-]*)\]([+-])?(?:[ \t]+(.*))?$/;

export interface ParsedCallout {
  type: string; // como o usuário digitou (lowercase)
  kind: CalloutKind; // tipo resolvido (desconhecido cai em note, comportamento Obsidian)
  fold: '+' | '-' | null;
  title: string; // markdown inline; vazio → título default (tipo capitalizado)
  body: string; // markdown do corpo, sem os prefixos '>'
}

export function parseCallout(rawText: string): ParsedCallout | null {
  const lines = rawText.split('\n');
  const match = lines[0].match(CALLOUT_FIRST_LINE);
  if (!match) return null;

  const type = match[1].toLowerCase();
  const kindKey = ALIASES[type];
  return {
    type,
    kind: KINDS[kindKey ?? 'note'],
    fold: (match[2] as '+' | '-' | undefined) ?? null,
    title: (match[3] ?? '').trim(),
    body: lines
      .slice(1)
      .map((l) => l.replace(/^>\s?/, ''))
      .join('\n'),
  };
}

export function isCalloutSource(rawText: string): boolean {
  return CALLOUT_FIRST_LINE.test(rawText.split('\n', 1)[0]);
}

// ---------------------------------------------------------------------------
// Render do corpo: marked (GFM, breaks como o Obsidian) → DOMPurify estrito →
// pós-passes DOM (wiki-links clicáveis + callouts aninhados)
// ---------------------------------------------------------------------------

const md = new Marked({ gfm: true, breaks: true, async: false });

// Allowlist explícita: nada de script/style/iframe/form; nenhum atributo on* nem
// URL javascript: sobrevive (USE_PROFILES desligado — só o que está listado entra).
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'a', 'p', 'br', 'hr', 'em', 'strong', 'del', 's', 'u', 'mark', 'sub', 'sup',
    'kbd', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'input',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'span', 'div', 'small', 'ins',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'class', 'type', 'checked', 'disabled',
    'start', 'colspan', 'rowspan', 'align',
  ],
  ALLOW_DATA_ATTR: false,
} as const;

export function renderMarkdownFragment(markdown: string): DocumentFragment {
  const html = md.parse(markdown) as string;
  const clean = DOMPurify.sanitize(html, {
    ...PURIFY_CONFIG,
    ALLOWED_TAGS: [...PURIFY_CONFIG.ALLOWED_TAGS],
    ALLOWED_ATTR: [...PURIFY_CONFIG.ALLOWED_ATTR],
    RETURN_DOM_FRAGMENT: true,
  });
  linkifyWikiLinks(clean);
  transformNestedCallouts(clean);
  return clean;
}

const WIKI_LINK_RE = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;

// Converte [[alvo|alias]] em spans .cm-wiki-link — o handler de clique global do
// MarkdownEditor (closest('.cm-wiki-link')) já os torna navegáveis de graça.
function linkifyWikiLinks(root: ParentNode) {
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    if (parent && !parent.closest('code, pre, a')) {
      textNodes.push(current as Text);
    }
    current = walker.nextNode();
  }

  const existingNotes = useAppStore.getState().existingNotes;
  for (const textNode of textNodes) {
    const text = textNode.textContent ?? '';
    WIKI_LINK_RE.lastIndex = 0;
    if (!WIKI_LINK_RE.test(text)) continue;
    WIKI_LINK_RE.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = WIKI_LINK_RE.exec(text)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const target = match[1].trim();
      // E2 Fatia B (Spec 28): `Nota#Título` resolve pela nota e exibe `Nota › Título`
      const hashIdx = target.indexOf('#');
      const noteName = hashIdx === -1 ? target : target.slice(0, hashIdx).trim();
      const resolved = noteName === '' ? true : existingNotes.has(noteName.toLowerCase());
      const span = document.createElement('span');
      span.className = `cm-wiki-link ${resolved ? 'cm-wiki-link-resolved' : 'cm-wiki-link-unresolved'}`;
      span.setAttribute('data-target', target);
      span.textContent = match[2] ? match[2].trim() : target.replace('#', ' › ');
      frag.appendChild(span);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.replaceWith(frag);
  }
}

const NESTED_FIRST_LINE = /^\s*\[!([a-zA-Z][a-zA-Z0-9-]*)\]([+-])?[ \t]?/;

// Callout aninhado: o marked renderiza `> [!tip] X` interno como <blockquote><p>[!tip] X…
// — reconstruímos o cartão recursivamente (a recursão é finita: profundidade do DOM).
function transformNestedCallouts(root: ParentNode) {
  for (const bq of Array.from(root.querySelectorAll('blockquote'))) {
    const firstPara = bq.firstElementChild;
    if (!firstPara || firstPara.tagName !== 'P') continue;
    const firstText = firstPara.childNodes[0];
    if (!firstText || firstText.nodeType !== Node.TEXT_NODE) continue;

    const match = (firstText.textContent ?? '').match(NESTED_FIRST_LINE);
    if (!match) continue;

    const type = match[1].toLowerCase();
    const kind = KINDS[ALIASES[type] ?? 'note'];
    const fold = (match[2] as '+' | '-' | undefined) ?? null;
    firstText.textContent = (firstText.textContent ?? '').slice(match[0].length);

    // Título = resto da primeira linha visual (até o primeiro <br> do parágrafo)
    const titleFrag = document.createDocumentFragment();
    while (firstPara.firstChild && firstPara.firstChild.nodeName !== 'BR') {
      titleFrag.appendChild(firstPara.firstChild);
    }
    if (firstPara.firstChild) firstPara.removeChild(firstPara.firstChild); // o <br>
    if (!firstPara.hasChildNodes()) firstPara.remove();

    const bodyFrag = document.createDocumentFragment();
    while (bq.firstChild) bodyFrag.appendChild(bq.firstChild);

    const titleIsEmpty = (titleFrag.textContent ?? '').trim() === '';
    const card = buildCalloutShell(
      type,
      kind,
      fold,
      titleIsEmpty ? document.createTextNode(defaultTitle(type)) : titleFrag,
      bodyFrag,
    );
    bq.replaceWith(card);
  }
}

function defaultTitle(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ---------------------------------------------------------------------------
// Montagem do cartão (compartilhada entre o widget top-level e os aninhados)
// ---------------------------------------------------------------------------

function buildCalloutShell(
  type: string,
  kind: CalloutKind,
  fold: '+' | '-' | null,
  titleContent: Node,
  bodyContent: Node | null,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'mycellia-callout';
  card.setAttribute('data-callout', type);
  card.style.setProperty('--callout-rgb', kind.rgb);
  if (fold === '-') card.classList.add('collapsed');

  const header = document.createElement('div');
  header.className = 'mycellia-callout-header';

  const iconEl = document.createElement('span');
  iconEl.className = 'mycellia-callout-icon';
  iconEl.innerHTML = kind.icon; // SVG constante do registro — nunca input do usuário

  const titleEl = document.createElement('span');
  titleEl.className = 'mycellia-callout-title';
  titleEl.appendChild(titleContent);

  header.appendChild(iconEl);
  header.appendChild(titleEl);

  const hasBody = bodyContent !== null && bodyContent.hasChildNodes();

  if (fold && hasBody) {
    const chevron = document.createElement('span');
    chevron.className = 'mycellia-callout-fold';
    chevron.innerHTML = CHEVRON;
    header.appendChild(chevron);
    header.classList.add('foldable');
    header.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.classList.toggle('collapsed');
    });
  }

  card.appendChild(header);

  if (hasBody) {
    const body = document.createElement('div');
    body.className = 'mycellia-callout-body';
    body.appendChild(bodyContent);
    card.appendChild(body);
  }

  return card;
}

// ---------------------------------------------------------------------------
// Widget CM6 (mesmo padrão de Table/Mermaid: substitui o nó inteiro fora do cursor)
// ---------------------------------------------------------------------------

export class CalloutWidget extends WidgetType {
  constructor(readonly rawText: string) {
    super();
  }

  toDOM() {
    const parsed = parseCallout(this.rawText);
    const container = document.createElement('div');
    container.className = 'mycellia-callout-wrapper my-2 select-text';

    if (!parsed) {
      // Guard: não deveria acontecer (a extensão só cria o widget após isCalloutSource)
      container.textContent = this.rawText;
      return container;
    }

    const titleMd = parsed.title !== '' ? parsed.title : defaultTitle(parsed.type);
    const titleFrag = renderInlineTitle(titleMd);
    const bodyFrag = parsed.body.trim() !== '' ? renderMarkdownFragment(parsed.body) : null;

    const card = buildCalloutShell(parsed.type, parsed.kind, parsed.fold, titleFrag, bodyFrag);
    container.appendChild(card);

    // Cliques são autocontidos no widget (mesmo padrão do TaskMarkerWidget):
    // wiki-link navega via store; link externo NUNCA navega a webview.
    container.addEventListener('click', (event) => {
      const targetEl = event.target as HTMLElement;
      const wikiLink = targetEl.closest('.cm-wiki-link');
      if (wikiLink) {
        event.preventDefault();
        event.stopPropagation();
        const target = wikiLink.getAttribute('data-target');
        if (target) useAppStore.getState().handleWikiLinkClick(target);
        return;
      }
      const anchor = targetEl.closest('a');
      if (anchor) event.preventDefault();
    });

    return container;
  }

  eq(other: CalloutWidget) {
    return other.rawText === this.rawText;
  }

  ignoreEvent() {
    // Cliques dentro do cartão (fold, links) são nossos; o CM não move o cursor.
    return true;
  }
}

function renderInlineTitle(titleMd: string): DocumentFragment {
  const html = md.parseInline(titleMd) as string;
  const clean = DOMPurify.sanitize(html, {
    ...PURIFY_CONFIG,
    ALLOWED_TAGS: [...PURIFY_CONFIG.ALLOWED_TAGS],
    ALLOWED_ATTR: [...PURIFY_CONFIG.ALLOWED_ATTR],
    RETURN_DOM_FRAGMENT: true,
  });
  linkifyWikiLinks(clean);
  return clean;
}
