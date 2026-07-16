// HTML inline no live preview (E1 — Spec 25). Duas vias, priorizando decoração nativa:
// 1) tags inline pareadas na MESMA linha viram Decoration.mark (zero innerHTML — a via
//    mais segura possível); 2) blocos HTML (HTMLBlock) viram widget com innerHTML
//    SANITIZADO pelo DOMPurify (allowlist estrita, nenhum on*/script/iframe sobrevive).
// Só EXIBIÇÃO: nenhuma mutação de documento acontece aqui.
import { EditorState } from '@codemirror/state';
import { Decoration, WidgetType } from '@codemirror/view';
import DOMPurify from 'dompurify';
import type { DecSpec } from './shared';
import { EmptyWidget } from './widgets';

// ---------------------------------------------------------------------------
// Via 1 — tags inline por decoração (sem HTML injetado)
// ---------------------------------------------------------------------------

// Tag suportada → classe CSS aplicada ao miolo (tags escondidas via EmptyWidget)
const INLINE_CLASS: Record<string, string> = {
  u: 'cm-html-u',
  ins: 'cm-html-u',
  b: 'cm-strong',
  strong: 'cm-strong',
  i: 'cm-em',
  em: 'cm-em',
  s: 'cm-strikethrough',
  del: 'cm-strikethrough',
  strike: 'cm-strikethrough',
  mark: 'cm-html-mark',
  sub: 'cm-html-sub',
  sup: 'cm-html-sup',
  kbd: 'cm-html-kbd',
  code: 'cm-inline-code',
  small: 'cm-html-small',
};

// span/font aceitam um subset de estilo com validador ESTRITO por propriedade
// (charset fechado — nada de url()/expression()/javascript: passa pelos validadores)
const STYLE_VALIDATORS: Record<string, RegExp> = {
  color: /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d\s,.%]+\)|hsla?\([\d\s,.%]+\))$/,
  'background-color': /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d\s,.%]+\)|hsla?\([\d\s,.%]+\))$/,
  'font-weight': /^(bold|bolder|lighter|normal|[1-9]00)$/,
  'font-style': /^(italic|normal|oblique)$/,
  'text-decoration': /^(underline|line-through|overline|none)([ ](underline|line-through|overline))*$/,
};

function sanitizeInlineStyle(rawStyle: string): string {
  const out: string[] = [];
  for (const declaration of rawStyle.split(';')) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) continue;
    const prop = declaration.slice(0, colonIndex).trim().toLowerCase();
    const value = declaration.slice(colonIndex + 1).trim();
    const validator = STYLE_VALIDATORS[prop];
    if (validator && validator.test(value)) {
      out.push(`${prop}: ${value}`);
    }
  }
  return out.join('; ');
}

const OPEN_TAG_RE = /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*?)?)\s*(\/?)>$/;
const CLOSE_TAG_RE = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>$/;
const STYLE_ATTR_RE = /style\s*=\s*"([^"]*)"/i;
const COLOR_ATTR_RE = /color\s*=\s*"([^"]*)"/i;

class LineBreakWidget extends WidgetType {
  toDOM() {
    return document.createElement('br');
  }
  eq() {
    return true;
  }
}

interface OpenTag {
  from: number;
  to: number;
  attrs: string;
  line: number;
}

export interface HtmlTagRange {
  from: number;
  to: number;
}

// Pareia tags inline linha a linha e devolve os specs de decoração. Tags sem par na
// mesma linha ficam cruas (limitação v1 documentada na Spec 25). Linha ativa fica crua.
export function collectInlineHtmlSpecs(
  state: EditorState,
  activeLineNumber: number,
  tags: HtmlTagRange[],
): DecSpec[] {
  const specs: DecSpec[] = [];
  const openStacks = new Map<string, OpenTag[]>();

  for (const tag of tags) {
    const line = state.doc.lineAt(tag.from).number;
    if (line === activeLineNumber) continue;

    const text = state.doc.sliceString(tag.from, tag.to);

    const closeMatch = text.match(CLOSE_TAG_RE);
    if (closeMatch) {
      const name = closeMatch[1].toLowerCase();
      const stack = openStacks.get(`${line}:${name}`);
      const open = stack?.pop();
      if (!open) continue;

      const dec = inlineDecorationFor(name, open.attrs);
      if (!dec) continue;

      specs.push({ from: open.from, to: open.to, dec: Decoration.replace({ widget: new EmptyWidget() }) });
      if (open.to < tag.from) {
        specs.push({ from: open.to, to: tag.from, dec });
      }
      specs.push({ from: tag.from, to: tag.to, dec: Decoration.replace({ widget: new EmptyWidget() }) });
      continue;
    }

    const openMatch = text.match(OPEN_TAG_RE);
    if (!openMatch) continue;
    const name = openMatch[1].toLowerCase();
    const selfClosing = openMatch[3] === '/';

    if (name === 'br') {
      specs.push({ from: tag.from, to: tag.to, dec: Decoration.replace({ widget: new LineBreakWidget() }) });
      continue;
    }
    if (selfClosing) continue;

    if (INLINE_CLASS[name] || name === 'span' || name === 'font') {
      const key = `${line}:${name}`;
      if (!openStacks.has(key)) openStacks.set(key, []);
      openStacks.get(key)!.push({ from: tag.from, to: tag.to, attrs: openMatch[2] ?? '', line });
    }
  }

  return specs;
}

function inlineDecorationFor(name: string, attrs: string): Decoration | null {
  const cssClass = INLINE_CLASS[name];
  if (cssClass) {
    return Decoration.mark({ class: cssClass });
  }

  if (name === 'span' || name === 'font') {
    let style = '';
    const styleMatch = attrs.match(STYLE_ATTR_RE);
    if (styleMatch) {
      style = sanitizeInlineStyle(styleMatch[1]);
    } else if (name === 'font') {
      const colorMatch = attrs.match(COLOR_ATTR_RE);
      if (colorMatch && STYLE_VALIDATORS.color.test(colorMatch[1].trim())) {
        style = `color: ${colorMatch[1].trim()}`;
      }
    }
    if (style === '') return null; // sem estilo válido → deixa cru
    return Decoration.mark({ class: 'cm-html-styled', attributes: { style } });
  }

  return null;
}

// ---------------------------------------------------------------------------
// Via 2 — blocos HTML sanitizados (widget)
// ---------------------------------------------------------------------------

const BLOCK_ALLOWED_TAGS = [
  'a', 'p', 'br', 'hr', 'em', 'strong', 'del', 's', 'u', 'mark', 'sub', 'sup',
  'kbd', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'span', 'div', 'small', 'ins',
  'details', 'summary', 'center', 'figure', 'figcaption', 'b', 'i', 'font',
];

const BLOCK_ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'width', 'height',
  'start', 'colspan', 'rowspan', 'align', 'open', 'color',
];

export class HtmlBlockWidget extends WidgetType {
  constructor(readonly rawText: string) {
    super();
  }

  toDOM() {
    const container = document.createElement('div');
    container.className = 'mycellia-html-block my-2 select-text';

    const clean = DOMPurify.sanitize(this.rawText, {
      ALLOWED_TAGS: BLOCK_ALLOWED_TAGS,
      ALLOWED_ATTR: BLOCK_ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
    container.appendChild(clean);

    // Links externos NUNCA navegam a webview (o app não sai do lugar por um <a>)
    container.addEventListener('click', (event) => {
      const anchor = (event.target as HTMLElement).closest('a');
      if (anchor) event.preventDefault();
    });

    return container;
  }

  eq(other: HtmlBlockWidget) {
    return other.rawText === this.rawText;
  }

  ignoreEvent() {
    return true;
  }
}
