// E4.3 (Spec 31): parse/serialize round-trip do JSON Canvas (jsoncanvas.org — o .canvas
// do Obsidian). Princípio sagrado: campos DESCONHECIDOS (do topo, de nó e de aresta) são
// preservados sempre — o parse guarda os objetos crus e as mutações escrevem só os campos
// conhecidos tocados (spread preserva a ordem de inserção das chaves existentes).
// O writer mimetiza o do Obsidian (tab, um nó/aresta compacto por linha, array vazio
// inline) pra edição no Mycellia gerar diff mínimo no git do vault.
// Módulo PURO: zero import de store/Tauri — testável isolado.

export type Raw = Record<string, unknown>;

export interface RawScene {
  /** Objeto do topo como veio do parse (nodes/edges inclusos — fonte da ordem das chaves) */
  top: Raw;
  /** Ordem das chaves do topo na serialização (garante nodes/edges presentes) */
  topOrder: string[];
  nodes: Raw[];
  edges: Raw[];
  /** O arquivo original terminava com \n? (preservado byte a byte) */
  trailingNewline: boolean;
}

function isRaw(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** String vazia = canvas novo (cena em branco). JSON inválido/estrutura errada → null. */
export function parseScene(content: string): RawScene | null {
  if (content.trim() === '') {
    return { top: {}, topOrder: ['nodes', 'edges'], nodes: [], edges: [], trailingNewline: false };
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRaw(parsed)) return null;
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes.filter(isRaw) : [];
    const edges = Array.isArray(parsed.edges) ? parsed.edges.filter(isRaw) : [];
    const topOrder = Object.keys(parsed);
    if (!topOrder.includes('nodes')) topOrder.push('nodes');
    if (!topOrder.includes('edges')) topOrder.push('edges');
    return { top: parsed, topOrder, nodes, edges, trailingNewline: content.endsWith('\n') };
  } catch {
    return null;
  }
}

/** Writer formato-Obsidian. Aceite da spec: parse→serialize sem mutação = byte-idêntico. */
export function serializeScene(scene: RawScene): string {
  const parts: string[] = [];
  for (const key of scene.topOrder) {
    if (key === 'nodes' || key === 'edges') {
      const arr = key === 'nodes' ? scene.nodes : scene.edges;
      if (arr.length === 0) {
        parts.push(`\t${JSON.stringify(key)}:[]`);
      } else {
        const body = arr.map((o) => `\t\t${JSON.stringify(o)}`).join(',\n');
        parts.push(`\t${JSON.stringify(key)}:[\n${body}\n\t]`);
      }
    } else {
      parts.push(`\t${JSON.stringify(key)}:${JSON.stringify(scene.top[key])}`);
    }
  }
  return `{\n${parts.join(',\n')}\n}${scene.trailingNewline ? '\n' : ''}`;
}

/** Clone profundo pra pilha de undo (objetos JSON puros por construção) */
export function cloneScene(scene: RawScene): RawScene {
  return {
    top: scene.top,
    topOrder: [...scene.topOrder],
    nodes: scene.nodes.map((n) => ({ ...n })),
    edges: scene.edges.map((e) => ({ ...e })),
    trailingNewline: scene.trailingNewline,
  };
}

// ── Leitores tipados dos campos conhecidos (cru → view) ──
export function num(o: Raw, key: string): number {
  const v = o[key];
  return typeof v === 'number' ? v : 0;
}
export function str(o: Raw, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' ? v : undefined;
}

/** Substitui campos conhecidos preservando a ordem das chaves existentes (spread JS) */
export function withFields(o: Raw, fields: Raw): Raw {
  return { ...o, ...fields };
}

/** ID novo no padrão do Obsidian: 16 hex */
export function newCanvasId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Remove um nó + cascata das arestas conectadas a ele */
export function removeNode(scene: RawScene, nodeId: string): RawScene {
  return {
    ...scene,
    nodes: scene.nodes.filter((n) => n.id !== nodeId),
    edges: scene.edges.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId),
  };
}

/** Remove uma aresta */
export function removeEdge(scene: RawScene, edgeId: string): RawScene {
  return { ...scene, edges: scene.edges.filter((e) => e.id !== edgeId) };
}

/** Aplica delta de posição a um conjunto de nós (drag), a partir das posições originais */
export function moveNodes(
  scene: RawScene,
  origins: Map<string, { x: number; y: number }>,
  dx: number,
  dy: number
): RawScene {
  return {
    ...scene,
    nodes: scene.nodes.map((n) => {
      const o = typeof n.id === 'string' ? origins.get(n.id) : undefined;
      return o ? withFields(n, { x: Math.round(o.x + dx), y: Math.round(o.y + dy) }) : n;
    }),
  };
}
