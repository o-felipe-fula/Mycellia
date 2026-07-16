// Estilo visual dos links do grafo (UI polish 2026-07-16, pedido do Felipe):
// base = cinza translúcido SEMPRE visível; conexões da nota selecionada e da busca
// acendem em verde neon (accent-bright). Helper PURO — compartilhado pelo 3D (props)
// e pelo 2D (drawLink) pra os dois modos nunca divergirem; testado direto.
// (hexToRgba/interpolateColor locais de propósito: o GraphView tem cópias próprias
// acopladas ao desenho de NÓS — unificar é refactor à parte, fora deste escopo.)

export interface LinkStyleColors {
  accent: string;
  accentBright: string;
  textMuted: string;
}

export interface LinkStyleInput {
  /** busca ativa agora (query não-vazia) */
  queryActive: boolean;
  /** os DOIS lados do link batem na busca */
  isMatch: boolean;
  /** o link toca a nota ativa/selecionada */
  isConnectedToSelected: boolean;
  /** progresso da transição de busca (0..1; sobe ao buscar, desce ao limpar) */
  transitionProgress: number;
  colors: LinkStyleColors;
}

export interface LinkStyle {
  color: string;
  /** largura base (o 2D divide por globalScale) */
  width: number;
  /** partículas direcionais (só o 3D usa; o brilho "vivo" da conexão selecionada) */
  particles: number;
}

// Constantes do desenho (uma fonte só pros dois modos)
const BASE_ALPHA = 0.35; // cinza translúcido visível — antes era 0.12-0.15 e sumia
const FADE_ALPHA = 0.06; // não-match durante busca: quase some, sem desaparecer
const BASE_WIDTH = 0.8;
const NEON_WIDTH = 2.4;
const MATCH_WIDTH = 2.2;

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function interpolateHex(hexA: string, hexB: string, t: number): string {
  const parse = (hex: string) => {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parse(hexA);
  const [r2, g2, b2] = parse(hexB);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function linkStyle({
  queryActive,
  isMatch,
  isConnectedToSelected,
  transitionProgress,
  colors,
}: LinkStyleInput): LinkStyle {
  const p = Math.max(0, Math.min(1, transitionProgress));
  const searchInfluence = queryActive || p > 0;

  if (searchInfluence) {
    if (isMatch) {
      // Conexão entre resultados da busca: acende do cinza pro neon
      const color = hexToRgba(
        interpolateHex(colors.textMuted, colors.accentBright, p),
        BASE_ALPHA + (1 - BASE_ALPHA) * p,
      );
      return { color, width: BASE_WIDTH + (MATCH_WIDTH - BASE_WIDTH) * p, particles: 0 };
    }
    // Não-match esmaece (a nota selecionada esmaece MENOS, sem sumir do mapa)
    const floor = isConnectedToSelected ? 0.18 : FADE_ALPHA;
    const alpha = BASE_ALPHA + (floor - BASE_ALPHA) * p;
    const width = isConnectedToSelected
      ? NEON_WIDTH + (1.0 - NEON_WIDTH) * p
      : BASE_WIDTH + (0.5 - BASE_WIDTH) * p;
    return {
      color: hexToRgba(isConnectedToSelected ? colors.accent : colors.textMuted, alpha),
      width,
      particles: 0,
    };
  }

  // Estado base (sem busca)
  if (isConnectedToSelected) {
    // Neon pleno + partículas: a conexão da nota ativa "brilha"
    return { color: colors.accentBright, width: NEON_WIDTH, particles: 2 };
  }
  return { color: hexToRgba(colors.textMuted, BASE_ALPHA), width: BASE_WIDTH, particles: 0 };
}
