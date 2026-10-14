import { createDeck } from '@aurum/engine';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayingCard } from '../PlayingCard';
import { CardBackFace, CardFace } from './CardFace';
import { PIP_LAYOUT, RANK_PIPS, RED, BLACK, cardName, parseCard } from './glyphs';

const count = (html: string, needle: string): number => html.split(needle).length - 1;

/** Comprueba que un punto (con el tamaño del símbolo) cabe dentro de la carta de 100 × 140. */
const inside = (x: number, y: number, half: number): boolean => x - half >= 0 && x + half <= 100 && y - half >= 0 && y + half <= 140;

describe('baraja: las 52 cartas', () => {
  const deck = createDeck();

  it('la baraja del motor tiene 52 cartas únicas', () => {
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it.each(deck)('%s: rango, palo, color, índices y símbolos correctos', (card) => {
    const { rank, suit } = parseCard(card);
    const html = renderToStaticMarkup(<CardFace card={card} variant="full" />);
    expect(html).toContain(`data-card="${card}"`);
    expect(html).toContain(`data-rank="${rank}"`);
    expect(html).toContain(`data-suit="${suit}"`);
    const red = suit === 'h' || suit === 'd';
    expect(html).toContain(`data-color="${red ? 'red' : 'black'}"`);
    // Índices y símbolos del palo con su color tradicional (rojo ♥♦, negro ♠♣).
    const color = red ? RED : BLACK;
    const other = red ? BLACK : RED;
    const glyphs = [...html.matchAll(/stroke="([^"]+)"[^>]*data-rank-glyph/g)].map((m) => m[1]);
    expect(glyphs).toEqual([color, color]);
    const pipFills = [...html.matchAll(/<path data-pip="true" d="[^"]+" fill="([^"]+)"/g)].map((m) => m[1]);
    for (const f of pipFills) expect(f).toBe(color);
    if (rank !== 'J' && rank !== 'Q' && rank !== 'K') expect(html).not.toContain(`fill="${other}"`);
    // Índices en dos esquinas opuestas, cada uno con el trazo del rango.
    expect(count(html, 'data-corner')).toBe(2);
    expect(count(html, `data-rank-glyph="${rank}"`)).toBe(2);
    // Símbolos contables en las numéricas; as con símbolo central; figuras ilustradas.
    const pips = RANK_PIPS[rank];
    if (pips) expect(count(html, 'data-pip')).toBe(pips);
    if (rank === 'A') {
      expect(count(html, 'data-pip')).toBe(1);
      expect(html).toContain('data-ace');
    }
    if (rank === 'J' || rank === 'Q' || rank === 'K') expect(html).toContain(`data-court="${rank}"`);
    // Sin texto ni fuentes: todo es vectorial.
    expect(html).not.toContain('<text');
  });

  it.each(deck)('%s: la variante compacta mantiene rango y palo', (card) => {
    const { rank } = parseCard(card);
    const html = renderToStaticMarkup(<CardFace card={card} variant="compact" />);
    expect(html).toContain('data-compact');
    expect(count(html, `data-rank-glyph="${rank}"`)).toBe(1);
    expect(html).not.toContain('<text');
  });

  it('nombres accesibles correctos', () => {
    expect(cardName('As')).toBe('As de picas');
    expect(cardName('Th')).toBe('10 de corazones');
    expect(cardName('Qd')).toBe('Reina de diamantes');
    expect(cardName('Kc')).toBe('Rey de tréboles');
    expect(cardName('Jh')).toBe('Jota de corazones');
  });

  it('ningún símbolo de las numéricas se sale de la carta ni invade los índices', () => {
    for (const [n, layout] of Object.entries(PIP_LAYOUT)) {
      const half = (Number(n) >= 9 ? 17 : 19) / 2;
      for (const [x, y] of layout) {
        expect(inside(x, y, half)).toBe(true);
        // Zona de índices: x < 18 y (y < 40 o y > 100)
        expect(x - half).toBeGreaterThan(18);
      }
    }
  });

  it('identificadores SVG únicos por carta (sin referencias cruzadas entre cartas)', () => {
    const html = renderToStaticMarkup(
      <>
        <CardFace card="Kh" />
        <CardFace card="Qs" />
        <CardBackFace />
        <CardBackFace />
      </>,
    );
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('cartas ocultas', () => {
  it('una carta oculta no incluye ningún dato de la carta real', () => {
    const html = renderToStaticMarkup(<PlayingCard card={null} faceUp={false} width={80} />);
    expect(html).toContain('Carta boca abajo');
    expect(html).not.toContain('data-card');
    expect(html).not.toContain('data-rank');
  });
  it('boca abajo con carta conocida: etiqueta accesible neutra', () => {
    const html = renderToStaticMarkup(<PlayingCard card="As" faceUp={false} width={80} />);
    expect(html).toContain('aria-label="Carta boca abajo"');
    // Solo el reverso está en el DOM: no hay rastro de la carta real.
    expect(html).not.toContain('data-card');
    expect(html).toContain('data-back');
  });
  it('elige la variante compacta en tamaños pequeños', () => {
    expect(renderToStaticMarkup(<PlayingCard card="7d" width={50} />)).toContain('data-variant="compact"');
    expect(renderToStaticMarkup(<PlayingCard card="7d" width={92} />)).toContain('data-variant="full"');
    expect(renderToStaticMarkup(<PlayingCard card="7d" width={92} screenScale={0.5} />)).toContain('data-variant="compact"');
  });
});
