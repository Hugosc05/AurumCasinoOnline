import { parseCards } from '@aurum/engine';
import { describe, expect, it } from 'vitest';
import { cardEmphasis, heroInsight } from './assist';

describe('resaltado del asistente de póker', () => {
  it('pareja de reyes: ilumina los dos reyes y atenúa el resto de cartas propias y comunitarias', () => {
    const board = parseCards('2c 5s 9h');
    const ins = heroInsight(['Kh', 'Kd'], board, 'standard');
    expect(ins?.title).toBe('Pareja de reyes');
    expect(cardEmphasis(ins, 'Kh', true)).toBe('highlight');
    expect(cardEmphasis(ins, 'Kd', true)).toBe('highlight');
    for (const c of board) expect(cardEmphasis(ins, c, true)).toBe('soft');
  });

  it('nunca toca las cartas de los rivales', () => {
    const ins = heroInsight(['Kh', 'Kd'], parseCards('2c 5s 9h'), 'standard');
    expect(cardEmphasis(ins, 'Kh', false)).toBe('none');
  });

  it('el resaltado cambia al aparecer el turn (pareja → doble pareja)', () => {
    const flop = heroInsight(['Kh', '8d'], parseCards('Kc 4s 2h'), 'standard');
    const turn = heroInsight(['Kh', '8d'], parseCards('Kc 4s 2h 8c'), 'standard');
    expect(cardEmphasis(flop, '8d', true)).toBe('soft');
    expect(cardEmphasis(turn, '8d', true)).toBe('highlight');
    expect(cardEmphasis(turn, '8c', true)).toBe('highlight');
    expect(turn?.core).toHaveLength(4);
  });

  it('con carta alta no ilumina nada (no hay combinación)', () => {
    const ins = heroInsight(['Ah', '9d'], parseCards('2c 5s Jh'), 'standard');
    expect(ins?.category).toBe(0);
    expect(cardEmphasis(ins, 'Ah', true)).toBe('none');
  });

  it('sin cartas propias visibles (mirando o retirado) no hay asistente', () => {
    expect(heroInsight(undefined, [], 'beginner')).toBeNull();
    expect(heroInsight([null, null], parseCards('2c 5s Jh'), 'beginner')).toBeNull();
  });

  it('el modo avanzado no calcula probabilidades', () => {
    expect(heroInsight(['Ah', 'Kh'], parseCards('2h 7h 9c'), 'advanced')?.improvement).toBeNull();
    expect(heroInsight(['Ah', 'Kh'], parseCards('2h 7h 9c'), 'beginner')?.improvement).not.toBeNull();
  });
});
