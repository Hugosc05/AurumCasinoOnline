import { describe, expect, it } from 'vitest';
import {
  PokerError,
  applyPokerAction,
  buildPots,
  chenScore,
  compareHands,
  createDeck,
  decideBotAction,
  estimateEquity,
  evaluateHand,
  legalActions,
  nextButton,
  parseCards,
  playerAt,
  publicHandView,
  seededRng,
  startHand,
  uncalledExcess,
  type Card,
  type PokerHandState,
  type PokerSeat,
} from '../src';

const ev = (s: string) => evaluateHand(parseCards(s));

describe('evaluador: las diez categorías', () => {
  it.each([
    ['As Kd 9h 7c 4s 3d 2c', 0, 'Carta alta'],
    ['As Ad 9h 7c 4s 3d 2c', 1, 'Pareja'],
    ['As Ad 9h 9c 4s 3d 2c', 2, 'Doble pareja'],
    ['As Ad Ah 9c 4s 3d 2c', 3, 'Trío'],
    ['9s 8d 7h 6c 5s Ad Kc', 4, 'Escalera'],
    ['As Js 9s 6s 3s Kd Qc', 5, 'Color'],
    ['As Ad Ah 9c 9s 3d 2c', 6, 'Full'],
    ['As Ad Ah Ac 9s 3d 2c', 7, 'Póker'],
    ['9s 8s 7s 6s 5s Ad Kc', 8, 'Escalera de color'],
    ['As Ks Qs Js Ts 2d 3c', 9, 'Escalera real'],
  ])('%s → %s', (cards, category, name) => {
    const r = ev(cards);
    expect(r.category).toBe(category);
    expect(r.name).toBe(name);
    expect(r.best).toHaveLength(5);
  });

  it('ordena correctamente todas las categorías', () => {
    const hands = [
      'As Kd 9h 7c 4s 3d 2c', 'As Ad 9h 7c 4s 3d 2c', 'As Ad 9h 9c 4s 3d 2c', 'As Ad Ah 9c 4s 3d 2c',
      '9s 8d 7h 6c 5s Ad Kc', 'As Js 9s 6s 3s Kd Qc', 'As Ad Ah 9c 9s 3d 2c', 'As Ad Ah Ac 9s 3d 2c',
      '9s 8s 7s 6s 5s Ad Kc', 'As Ks Qs Js Ts 2d 3c',
    ].map((h) => ev(h).score);
    for (let i = 1; i < hands.length; i += 1) expect(hands[i]!).toBeGreaterThan(hands[i - 1]!);
  });
});

describe('evaluador: escaleras con as y desempates', () => {
  it('la rueda A-2-3-4-5 es escalera al 5', () => {
    const wheel = ev('As 2d 3h 4c 5s Kd Qc');
    expect(wheel.category).toBe(4);
    expect(wheel.score).toBeLessThan(ev('2s 3d 4h 5c 6s Kd Qc').score);
  });
  it('A-K-Q-J-T es la escalera más alta; no hay escaleras "circulares"', () => {
    expect(ev('As Kd Qh Jc Ts 2d 3c').category).toBe(4);
    expect(ev('Qs Kd Ah 2c 3s 8d 9c').category).toBe(0);
  });
  it('escalera de color al 5 con as', () => {
    expect(ev('Ah 2h 3h 4h 5h Kd Kc').category).toBe(8);
  });
  it('desempata por kicker', () => {
    expect(compareHands(parseCards('As Ad Kh 7c 4s 3d 2c'), parseCards('Ac Ah Qh 7d 4d 3s 2s'))).toBeGreaterThan(0);
  });
  it('doble pareja: pareja alta, luego baja, luego kicker', () => {
    expect(compareHands(parseCards('Ks Kd 3h 3c As'), parseCards('Qs Qd Jh Jc As'))).toBeGreaterThan(0);
    expect(compareHands(parseCards('Ks Kd 3h 3c As'), parseCards('Kh Kc 3s 3d Qs'))).toBeGreaterThan(0);
  });
  it('full: manda el trío; con dos tríos se elige el mejor full', () => {
    expect(compareHands(parseCards('3s 3d 3h Ac As'), parseCards('2s 2d 2h Kc Ks'))).toBeGreaterThan(0);
    const r = ev('9s 9d 9h 5c 5s 5d 2c');
    expect(r.category).toBe(6);
    expect(r.best.filter((c) => c[0] === '9')).toHaveLength(3);
  });
  it('color: compara las cinco cartas', () => {
    expect(compareHands(parseCards('As Js 9s 6s 3s'), parseCards('Ah Jh 9h 6h 2h'))).toBeGreaterThan(0);
  });
  it('empate exacto cuando el tablero juega', () => {
    const board = 'As Ks Qs Js Ts';
    expect(compareHands(parseCards(`${board} 2d 3c`), parseCards(`${board} 4d 5c`))).toBe(0);
  });
});

describe('botes secundarios', () => {
  it('forma bote principal y secundarios con all-in de distintos importes', () => {
    const pots = buildPots([
      { seat: 0, amount: 50, folded: false },
      { seat: 1, amount: 200, folded: false },
      { seat: 2, amount: 200, folded: false },
      { seat: 3, amount: 120, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 200, eligible: [0, 1, 2, 3] },
      { amount: 210, eligible: [1, 2, 3] },
      { amount: 160, eligible: [1, 2] },
    ]);
    expect(pots.reduce((a, p) => a + p.amount, 0)).toBe(570);
  });
  it('las fichas de jugadores retirados cuentan pero no son elegibles', () => {
    const pots = buildPots([
      { seat: 0, amount: 100, folded: true },
      { seat: 1, amount: 60, folded: false },
      { seat: 2, amount: 150, folded: false },
    ]);
    expect(pots.reduce((a, p) => a + p.amount, 0)).toBe(310);
    expect(pots[0]!.eligible).toEqual([1, 2]);
    expect(pots[1]!.eligible).toEqual([2]);
  });
  it('detecta la apuesta no igualada', () => {
    expect(uncalledExcess([{ seat: 0, amount: 300, folded: false }, { seat: 1, amount: 100, folded: false }])).toEqual({ seat: 0, amount: 200 });
    expect(uncalledExcess([{ seat: 0, amount: 100, folded: false }, { seat: 1, amount: 100, folded: false }])).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */

function seats(stacks: (number | null)[]): (PokerSeat | null)[] {
  return stacks.map((s, i) => (s === null ? null : { id: `p${i}`, name: `P${i}`, isBot: false, stack: s }));
}

/**
 * Mazo preparado: `startHand` saca con pop(), así que se invierte. Reparto:
 * una carta por jugador desde la izquierda del botón (dos vueltas), después
 * quemada + flop, quemada + turn, quemada + river.
 */
function deckFor(holes: string[][], board: string, order: number[]): Card[] {
  const draw: Card[] = [];
  for (const idx of [0, 1]) for (const p of order) draw.push(holes[p]![idx]!);
  const b = parseCards(board);
  draw.push('2c', b[0]!, b[1]!, b[2]!, '3c', b[3]!, '4c', b[4]!);
  const used = new Set(draw);
  const rest = createDeck().filter((c) => !used.has(c));
  return [...rest, ...draw.reverse()];
}

const cfg = { smallBlind: 5, bigBlind: 10 };
const rng = seededRng(7);

function act(s: PokerHandState, seat: number, type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin', amount?: number) {
  return applyPokerAction(s, seat, amount === undefined ? { type } : { type, amount }, rng);
}

describe('mesa de Texas Hold\'em', () => {
  it('rotación del botón y ciegas', () => {
    const st = seats([100, 100, null, 100]);
    expect(nextButton(st, -1)).toBe(0);
    expect(nextButton(st, 0)).toBe(1);
    expect(nextButton(st, 1)).toBe(3);
    expect(nextButton(st, 3)).toBe(0);
    const h = startHand(st, 0, cfg, rng, 'h1');
    expect(h.button).toBe(1);
    expect(h.sbSeat).toBe(3);
    expect(h.bbSeat).toBe(0);
    expect(playerAt(h, 3)!.bet).toBe(5);
    expect(playerAt(h, 0)!.bet).toBe(10);
    expect(h.toAct).toBe(1); // UTG = a la izquierda de la BB
  });

  it('heads-up: el botón pone la ciega pequeña y habla primero preflop', () => {
    const h = startHand(seats([100, 100]), 1, cfg, rng, 'h2');
    expect(h.button).toBe(0);
    expect(h.sbSeat).toBe(0);
    expect(h.bbSeat).toBe(1);
    expect(h.toAct).toBe(0);
  });

  it('impide actuar fuera de turno y apuestas incompatibles', () => {
    const h = startHand(seats([100, 100, 100]), -1, cfg, rng, 'h3');
    // botón 0, SB 1, BB 2, UTG = 0
    expect(h.toAct).toBe(0);
    expect(() => act(h, 1, 'call')).toThrow(PokerError);
    expect(() => act(h, 0, 'check')).toThrow(/pasar/);
    expect(() => act(h, 0, 'raise', 15)).toThrow(/mínima/);
    expect(() => act(h, 0, 'raise', 500)).toThrow(/suficientes/);
    expect(() => act(h, 0, 'bet', 30)).toThrow(PokerError);
    act(h, 0, 'raise', 30);
    expect(h.currentBet).toBe(30);
    expect(legalActions(h, 1)!.minRaiseTo).toBe(50);
  });

  it('una mano completa hasta el showdown reparte el bote al mejor', () => {
    // Botón 0 → SB 1, BB 2; orden de reparto: 1, 2, 0.
    const holes = [parseCards('As Ad'), parseCards('Ks Kd'), parseCards('7h 2c')];
    const h = startHand(seats([1000, 1000, 1000]), 2, cfg, rng, 'h4', deckFor(holes, 'Ah 9d 5s Jc 3h', [1, 2, 0]));
    expect(playerAt(h, 0)!.hole).toEqual(['As', 'Ad']);
    act(h, 0, 'call');
    act(h, 1, 'call');
    act(h, 2, 'check');
    expect(h.street).toBe('flop');
    expect(h.board).toEqual(['Ah', '9d', '5s']);
    expect(h.toAct).toBe(1); // primero tras el botón
    act(h, 1, 'check');
    act(h, 2, 'bet', 20);
    act(h, 0, 'raise', 60);
    act(h, 1, 'fold');
    act(h, 2, 'call');
    expect(h.street).toBe('turn');
    act(h, 2, 'check');
    act(h, 0, 'check');
    act(h, 2, 'check');
    act(h, 0, 'check');
    expect(h.street).toBe('complete');
    expect(h.result!.showdown).toBe(true);
    expect(h.result!.winners).toEqual([{ seat: 0, id: 'p0', amount: 150, handName: 'Trío' }]);
    expect(playerAt(h, 0)!.stack).toBe(1000 - 70 + 150);
    // Conservación de fichas
    expect(h.players.reduce((a, p) => a + p.stack, 0)).toBe(3000);
  });

  it('all-in con bote secundario y conservación de fichas', () => {
    // p0 corto (50) con la mejor mano; p1 y p2 juegan bote secundario.
    const holes = [parseCards('As Ad'), parseCards('Ks Kd'), parseCards('Qh Qc')];
    const h = startHand(seats([50, 500, 500]), 2, cfg, rng, 'h5', deckFor(holes, '2h 7d 9s Jc 3h', [1, 2, 0]));
    act(h, 0, 'allin');
    act(h, 1, 'raise', 200);
    act(h, 2, 'call');
    expect(h.street).toBe('flop');
    act(h, 1, 'bet', 100);
    act(h, 2, 'call');
    act(h, 1, 'check');
    act(h, 2, 'check');
    act(h, 1, 'check');
    act(h, 2, 'check');
    expect(h.street).toBe('complete');
    const pots = h.result!.pots;
    expect(pots[0]).toEqual({ amount: 150, eligible: [0, 1, 2] });
    expect(pots[1]).toEqual({ amount: 500, eligible: [1, 2] });
    expect(playerAt(h, 0)!.stack).toBe(150);
    expect(playerAt(h, 1)!.stack).toBe(500 - 300 + 500);
    expect(playerAt(h, 2)!.stack).toBe(200);
    expect(h.players.reduce((a, p) => a + p.stack, 0)).toBe(1050);
  });

  it('si todos van all-in se reparten las calles restantes automáticamente', () => {
    const h = startHand(seats([100, 100]), -1, cfg, rng, 'h6');
    act(h, h.toAct!, 'allin');
    act(h, h.toAct!, 'call');
    expect(h.board).toHaveLength(5);
    expect(h.street).toBe('complete');
    expect(h.players.reduce((a, p) => a + p.stack, 0)).toBe(200);
  });

  it('devuelve la apuesta no igualada y da el bote al último jugador', () => {
    const h = startHand(seats([1000, 1000, 1000]), -1, cfg, rng, 'h7');
    act(h, 0, 'raise', 100);
    act(h, 1, 'fold');
    act(h, 2, 'fold');
    expect(h.result!.showdown).toBe(false);
    expect(h.events.some((e) => e.type === 'return' && e.amount === 90)).toBe(true);
    expect(playerAt(h, 0)!.stack).toBe(1015);
  });

  it('un all-in corto no reabre la apuesta a quien ya actuó', () => {
    const h = startHand(seats([1000, 1000, 75]), 2, cfg, rng, 'h8');
    // botón 0, SB 1, BB 2 (75). UTG = 0.
    act(h, 0, 'raise', 60);
    act(h, 1, 'call');
    act(h, 2, 'allin'); // 75: subida de 15 < 50 → incompleta
    const l = legalActions(h, 0)!;
    expect(l.canRaise).toBe(false);
    expect(l.callAmount).toBe(15);
  });

  it('la vista pública no revela cartas ajenas', () => {
    const h = startHand(seats([100, 100, 100]), -1, cfg, rng, 'h9');
    const view = publicHandView(h, 'p0');
    expect(view.players.find((p) => p.id === 'p0')!.hole.every((c) => c !== null)).toBe(true);
    expect(view.players.filter((p) => p.id !== 'p0').every((p) => p.hole.every((c) => c === null))).toBe(true);
    const ownCards = new Set(playerAt(h, 1)!.hole.concat(playerAt(h, 2)!.hole));
    expect([...ownCards].some((c) => JSON.stringify(view).includes(`"${c}"`))).toBe(false);
  });

  it('cientos de manos aleatorias con bots conservan las fichas y terminan', () => {
    const r = seededRng(123);
    let st = seats([1000, 1000, 1000, 1000, 1000, 1000]);
    let button = -1;
    for (let hand = 0; hand < 150; hand += 1) {
      const alive = st.filter((s) => s && s.stack > 0).length;
      if (alive < 2) break;
      const h = startHand(st, button, cfg, r, `m${hand}`);
      button = h.button;
      let guard = 0;
      while (h.toAct !== null && guard < 200) {
        const seat = h.toAct;
        const p = playerAt(h, seat)!;
        const legal = legalActions(h, seat)!;
        const others = h.players.filter((o) => !o.folded && o.seat !== seat).length;
        const decision = decideBotAction(
          {
            hole: p.hole, board: h.board, street: h.street as 'preflop', legal, stack: p.stack, bigBlind: 10,
            activeOpponents: others, position: 0.5, facingRaise: h.currentBet > 10, aggressorStats: null,
          },
          (['conservative', 'aggressive', 'balanced', 'analytical'] as const)[seat % 4]!,
          'easy',
          r,
        );
        applyPokerAction(h, seat, decision.action, r);
        guard += 1;
      }
      expect(h.street).toBe('complete');
      st = st.map((s) => (s ? { ...s, stack: playerAt(h, st.indexOf(s))?.stack ?? s.stack } : null));
      expect(st.reduce((a, s) => a + (s?.stack ?? 0), 0)).toBe(6000);
    }
  });
});

describe('bots', () => {
  it('Chen: AA > AKs > 72o', () => {
    expect(chenScore(parseCards('As Ad'))).toBe(20);
    expect(chenScore(parseCards('As Ks'))).toBeGreaterThan(chenScore(parseCards('7h 2c')));
  });
  it('equidad Monte Carlo razonable: AA vs 1 ≈ 85 %', () => {
    const e = estimateEquity(parseCards('As Ad'), [], 1, 4000, seededRng(5), 5000);
    expect(e).toBeGreaterThan(0.8);
    expect(e).toBeLessThan(0.9);
  });
  it('con nuts en el river el bot apuesta/sube; con aire ante apuesta grande se retira', () => {
    const legal = { seat: 0, canFold: true, canCheck: false, callAmount: 200, canRaise: true, isBet: false, minRaiseTo: 400, maxRaiseTo: 1000, currentBet: 200, pot: 300 };
    const nuts = decideBotAction({
      hole: parseCards('As Ks'), board: parseCards('Qs Js Ts 2d 3c'), street: 'river', legal, stack: 1000, bigBlind: 10,
      activeOpponents: 1, position: 1, facingRaise: true, aggressorStats: null,
    }, 'conservative', 'hard', seededRng(1));
    expect(['raise', 'allin']).toContain(nuts.action.type);
    const air = decideBotAction({
      hole: parseCards('7h 2c'), board: parseCards('Ks Qd 9s 4d 3c'), street: 'river', legal, stack: 1000, bigBlind: 10,
      activeOpponents: 1, position: 0, facingRaise: true, aggressorStats: null,
    }, 'balanced', 'hard', seededRng(1));
    expect(air.action.type).toBe('fold');
  });
  it('nunca se retira cuando puede pasar gratis', () => {
    const legal = { seat: 0, canFold: false, canCheck: true, callAmount: 0, canRaise: true, isBet: true, minRaiseTo: 10, maxRaiseTo: 1000, currentBet: 0, pot: 40 };
    for (let i = 0; i < 50; i += 1) {
      const d = decideBotAction({
        hole: parseCards('7h 2c'), board: parseCards('Ks Qd 9s'), street: 'flop', legal, stack: 1000, bigBlind: 10,
        activeOpponents: 2, position: 0.5, facingRaise: false, aggressorStats: null,
      }, 'conservative', 'normal', seededRng(i));
      expect(d.action.type).not.toBe('fold');
    }
  });
});
