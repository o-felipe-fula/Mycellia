// Transclusão de nota `![[Nota]]` / `![[Nota#Título]]` (E2 Fatia C — Spec 28).
// Detecção: alvo SEM extensão de imagem e presente em existingNotes → embed de nota;
// senão o fluxo de imagem existente segue intocado (compat total).
// Corpo renderizado com o MESMO pipeline do callout (marked + DOMPurify + wiki-links
// clicáveis) — zero pipeline novo. Anti-recursão: profundidade máx. 2 + guarda de ciclo
// por caminho. Leitura via read_file com cache invalidado quando a árvore muda.
// Só EXIBIÇÃO: nenhuma escrita acontece aqui.
import { WidgetType } from '@codemirror/view';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';
import i18n from '../i18n';
import { renderMarkdownFragment } from './callouts';

const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
const MAX_DEPTH = 2;

export interface NoteEmbedTarget {
  notePath: string;
  noteName: string;
  fragment: string | null;
}

// Decide se `![[alvo]]` é transclusão de NOTA (senão, o chamador mantém o fluxo de imagem)
export function resolveNoteEmbed(rawTarget: string): NoteEmbedTarget | null {
  const hashIdx = rawTarget.indexOf('#');
  const noteName = (hashIdx === -1 ? rawTarget : rawTarget.slice(0, hashIdx)).trim();
  const fragment = hashIdx === -1 ? null : rawTarget.slice(hashIdx + 1).trim();

  if (noteName === '' || IMAGE_EXTS.test(noteName)) return null;

  const existingNotes = useAppStore.getState().existingNotes;
  const key = noteName.toLowerCase();
  const notePath =
    existingNotes.get(key) ?? existingNotes.get(key.endsWith('.md') ? key.slice(0, -3) : `${key}.md`);
  if (!notePath) return null;

  return { notePath, noteName, fragment: fragment || null };
}

// ---------------------------------------------------------------------------
// Conteúdo: leitura com cache (invalidado pelo MarkdownEditor quando a árvore muda)
// ---------------------------------------------------------------------------

const contentCache = new Map<string, string>();
let embedVersion = 0;

export function invalidateEmbedCache() {
  contentCache.clear();
  embedVersion++;
}

export function getEmbedVersion(): number {
  return embedVersion;
}

// Import ESTÁTICO de propósito: o import() dinâmico do módulo do Tauri pode resolver
// uma instância diferente da mockada nos testes (lição da Fatia C) e não economiza nada
// — a API já está no bundle principal via appStore.
async function readNoteContent(path: string): Promise<string> {
  const cached = contentCache.get(path);
  if (cached !== undefined) return cached;
  const content = await invoke<string>('read_file', { path });
  contentCache.set(path, content);
  return content;
}

// ---------------------------------------------------------------------------
// Helpers puros (exportados pra teste)
// ---------------------------------------------------------------------------

export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') return content;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return lines.slice(i + 1).join('\n');
    }
  }
  return content;
}

// E2 Fatia D (Spec 28): bloco = a linha com a âncora ` ^id` (sem a âncora no render)
export function extractBlock(content: string, blockId: string): string | null {
  const escaped = blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const anchorRe = new RegExp('\\s\\^' + escaped + '\\s*$', 'i');
  for (const line of content.split('\n')) {
    if (anchorRe.test(line)) {
      return line.replace(/\s\^[A-Za-z0-9-]+\s*$/, '');
    }
  }
  return null;
}

// Seção = do heading (inclusive) até o próximo heading de nível ≤ (padrão Obsidian)
export function extractSection(content: string, heading: string): string | null {
  const wanted = heading.trim().toLowerCase();
  const lines = content.split('\n');
  let start = -1;
  let level = 0;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;

    if (start === -1) {
      if (match[2].trim().toLowerCase() === wanted) {
        start = i;
        level = match[1].length;
      }
    } else if (match[1].length <= level) {
      return lines.slice(start, i).join('\n');
    }
  }

  return start === -1 ? null : lines.slice(start).join('\n');
}

// ---------------------------------------------------------------------------
// Corpo do embed (recursivo com guarda de ciclo/profundidade)
// ---------------------------------------------------------------------------

async function buildEmbedBody(
  target: NoteEmbedTarget,
  depth: number,
  visited: Set<string>,
): Promise<HTMLElement> {
  const body = document.createElement('div');
  // Reusa TODO o estilo de corpo do callout (mesma família visual/regras)
  body.className = 'mycellia-callout-body mycellia-embed-body';

  const raw = await readNoteContent(target.notePath);
  let markdown = stripFrontmatter(raw);

  if (target.fragment) {
    // E2 Fatia D: fragmento `^id` embeda o BLOCO; senão é seção por heading
    const piece = target.fragment.startsWith('^')
      ? extractBlock(markdown, target.fragment.slice(1))
      : extractSection(markdown, target.fragment);
    if (piece === null) {
      body.textContent = `⚠️ "${target.fragment}" não encontrado em ${target.noteName}`;
      body.classList.add('mycellia-embed-missing');
      return body;
    }
    markdown = piece;
  }

  body.appendChild(renderMarkdownFragment(markdown));

  // Embeds aninhados: o marked deixa `![[X]]` como texto literal — transformamos em
  // sub-embed (até MAX_DEPTH) ou em link estático (fundo do poço / ciclo detectado)
  await transformNestedEmbeds(body, depth, visited);

  return body;
}

async function transformNestedEmbeds(root: HTMLElement, depth: number, visited: Set<string>) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    if (parent && !parent.closest('code, pre')) {
      textNodes.push(current as Text);
    }
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? '';

    // ⚠️ Regex LOCAL e matches coletados SÍNCRONO antes de qualquer await: uma /g
    // compartilhada com exec() intercalado por await na recursão tem o lastIndex
    // clobberado pela chamada interna → loop infinito + OOM (pego nos testes da Fatia C)
    const embedRe = /!\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;
    const matches: { index: number; length: number; target: string }[] = [];
    let match;
    while ((match = embedRe.exec(text)) !== null) {
      matches.push({ index: match.index, length: match[0].length, target: match[1].trim() });
    }
    if (matches.length === 0) continue;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    for (const m of matches) {
      if (m.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
      }

      const subTarget = resolveNoteEmbed(m.target);
      if (subTarget && depth < MAX_DEPTH && !visited.has(subTarget.notePath.toLowerCase())) {
        // Sub-embed real (recursão controlada)
        const sub = await buildEmbedShell(subTarget, depth + 1, visited);
        frag.appendChild(sub);
      } else {
        // Fundo do poço, ciclo ou imagem/inexistente: vira link estático clicável
        const span = document.createElement('span');
        span.className = 'cm-wiki-link cm-wiki-link-resolved mycellia-embed-static';
        span.setAttribute('data-target', m.target);
        const isCycle = subTarget && visited.has(subTarget.notePath.toLowerCase());
        span.textContent = `${m.target.replace('#', ' › ')}${isCycle ? ' (ciclo)' : ''}`;
        frag.appendChild(span);
      }
      lastIndex = m.index + m.length;
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.replaceWith(frag);
  }
}

async function buildEmbedShell(
  target: NoteEmbedTarget,
  depth: number,
  visited: Set<string>,
): Promise<HTMLElement> {
  const card = document.createElement('div');
  card.className = 'mycellia-embed';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'mycellia-embed-header';
  header.setAttribute(
    'data-embed-target',
    target.fragment ? `${target.noteName}#${target.fragment}` : target.noteName,
  );
  header.title = 'Abrir a nota';
  header.textContent = target.fragment
    ? `${target.noteName} › ${target.fragment}`
    : target.noteName;
  card.appendChild(header);

  const nextVisited = new Set(visited);
  nextVisited.add(target.notePath.toLowerCase());

  try {
    const body = await buildEmbedBody(target, depth, nextVisited);
    card.appendChild(body);
  } catch (e) {
    console.error('Failed to load embed content:', e);
    const err = document.createElement('div');
    err.className = 'mycellia-callout-body mycellia-embed-missing';
    err.textContent = i18n.t('embed.loadError', { name: target.noteName });
    card.appendChild(err);
  }

  return card;
}

// ---------------------------------------------------------------------------
// Widget CM6 (mesmo padrão async do MermaidWidget: guard de unmount)
// ---------------------------------------------------------------------------

export class NoteEmbedWidget extends WidgetType {
  private destroyed = false;

  constructor(
    readonly target: NoteEmbedTarget,
    readonly version: number, // muda quando o cache invalida → CM recria o DOM
  ) {
    super();
  }

  toDOM() {
    const container = document.createElement('div');
    container.className = 'mycellia-embed-wrapper my-2 select-text';

    const placeholder = document.createElement('div');
    placeholder.className = 'mycellia-embed animate-skeleton-pulse';
    placeholder.textContent = `Carregando ${this.target.noteName}…`;
    container.appendChild(placeholder);

    buildEmbedShell(this.target, 0, new Set())
      .then((card) => {
        if (this.destroyed) return;
        container.innerHTML = '';
        container.appendChild(card);
      })
      .catch((e) => {
        if (this.destroyed) return;
        console.error('Embed render error:', e);
        placeholder.textContent = i18n.t('embed.loadError', { name: this.target.noteName });
      });

    // Cliques autocontidos (padrão CalloutWidget): header/link estático navegam via
    // store; links externos nunca navegam a webview
    container.addEventListener('click', (event) => {
      const targetEl = event.target as HTMLElement;
      const headerEl = targetEl.closest('.mycellia-embed-header');
      if (headerEl) {
        event.preventDefault();
        event.stopPropagation();
        const embedTarget = headerEl.getAttribute('data-embed-target');
        if (embedTarget) useAppStore.getState().handleWikiLinkClick(embedTarget);
        return;
      }
      const wikiLink = targetEl.closest('.cm-wiki-link');
      if (wikiLink) {
        event.preventDefault();
        event.stopPropagation();
        const linkTarget = wikiLink.getAttribute('data-target');
        if (linkTarget) useAppStore.getState().handleWikiLinkClick(linkTarget);
        return;
      }
      const anchor = targetEl.closest('a');
      if (anchor) event.preventDefault();
    });

    return container;
  }

  destroy() {
    this.destroyed = true;
  }

  eq(other: NoteEmbedWidget) {
    return (
      other.target.notePath === this.target.notePath &&
      other.target.fragment === this.target.fragment &&
      other.version === this.version
    );
  }

  ignoreEvent() {
    return true;
  }
}
