// UI polish (2026-07-16) — estilo dos links do grafo: base cinza VISÍVEL, seleção/busca
// em neon. Helper puro compartilhado 2D/3D — testado direto, sem canvas/three.
import { describe, it, expect } from 'vitest';
import { linkStyle, hexToRgba, interpolateHex } from '../utils/graphLinkStyle';

const COLORS = {
  accent: '#4FE6AE',
  accentBright: '#6FF0C2',
  textMuted: '#66726C',
};

const base = {
  queryActive: false,
  isMatch: false,
  isConnectedToSelected: false,
  transitionProgress: 0,
  colors: COLORS,
};

describe('linkStyle (grafo)', () => {
  it('estado base: cinza translúcido VISÍVEL (alpha 0.35, nunca os 0.12-0.15 antigos)', () => {
    const style = linkStyle(base);
    expect(style.color).toBe('rgba(102, 114, 108, 0.35)'); // textMuted #66726C
    expect(style.width).toBe(0.8);
    expect(style.particles).toBe(0);
  });

  it('conexão da nota selecionada: neon pleno + partículas (o "brilho")', () => {
    const style = linkStyle({ ...base, isConnectedToSelected: true });
    expect(style.color).toBe(COLORS.accentBright);
    expect(style.width).toBe(2.4);
    expect(style.particles).toBe(2);
  });

  it('busca completa (p=1): match acende em neon quase pleno e mais grosso', () => {
    const style = linkStyle({ ...base, queryActive: true, isMatch: true, transitionProgress: 1 });
    // interpolação chegou no accentBright com alpha 1
    expect(style.color).toBe('rgba(111, 240, 194, 1)'); // #6FF0C2
    expect(style.width).toBe(2.2);
  });

  it('busca completa (p=1): não-match esmaece pra quase invisível sem sumir', () => {
    const style = linkStyle({ ...base, queryActive: true, isMatch: false, transitionProgress: 1 });
    expect(style.color).toBe('rgba(102, 114, 108, 0.06)');
    expect(style.width).toBeLessThan(0.8);
  });

  it('durante a busca, a nota selecionada esmaece MENOS que o resto', () => {
    const selected = linkStyle({
      ...base, queryActive: true, isConnectedToSelected: true, transitionProgress: 1,
    });
    const other = linkStyle({ ...base, queryActive: true, transitionProgress: 1 });
    const alphaOf = (rgba: string) => parseFloat(rgba.match(/[\d.]+\)$/)![0]);
    expect(alphaOf(selected.color)).toBeGreaterThan(alphaOf(other.color));
  });

  it('transição no meio (p=0.5) fica ENTRE o estado base e o final (sem salto)', () => {
    const mid = linkStyle({ ...base, queryActive: true, isMatch: true, transitionProgress: 0.5 });
    expect(mid.width).toBeGreaterThan(0.8);
    expect(mid.width).toBeLessThan(2.2);
  });

  it('saindo da busca (queryActive=false, p>0) continua na régua da transição', () => {
    const easing = linkStyle({ ...base, isMatch: true, transitionProgress: 0.5 });
    expect(easing.width).toBeGreaterThan(0.8);
    expect(easing.width).toBeLessThan(2.2);
  });
});

describe('utilitários de cor', () => {
  it('hexToRgba converte #rgb e #rrggbb', () => {
    expect(hexToRgba('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(hexToRgba('#4FE6AE', 1)).toBe('rgba(79, 230, 174, 1)');
  });

  it('interpolateHex nas pontas devolve as cores originais', () => {
    expect(interpolateHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(interpolateHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  });
});
