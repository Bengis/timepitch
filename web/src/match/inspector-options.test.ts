// TP205 · El selector «Consultar jugador» usa el reparto del partido (dorsal real y nombre de la cronología).
import { describe, expect, it } from 'vitest';
import { inspectorOptions } from './inspector-options';
import { GENERIC_APPEARANCE, type CastEntry, type MatchCast } from '../presentation/types';

const players = [
  { key: 'h1', side: 'home' as const, name: 'Thierry Henry' },
  { key: 'h2', side: 'home' as const, name: 'Patrik Vieira' },
  { key: 'a1', side: 'away' as const, name: 'Ilkay Gundogan' },
];
const entry = (number: string | null, displayName: string | null): CastEntry =>
  ({ number, displayName, appearance: GENERIC_APPEARANCE, appearanceSource: 'generic', record: null });
const cast = (entries: Record<string, CastEntry>) => ({ kits: null, players: new Map(Object.entries(entries)) }) as unknown as MatchCast;

describe('inspectorOptions', () => {
  it('without a cast numbers lineup slots per side and says so', () => {
    const r = inspectorOptions(players, null);
    expect(r.realNumbers).toBe(false);
    expect(r.options.map(o => [o.key, o.side, o.label])).toEqual([['h1', 'home', '1 · Thierry Henry'], ['h2', 'home', '2 · Patrik Vieira'], ['a1', 'away', '1 · Ilkay Gundogan']]);
  });
  it('with the match cast shows the real shirt number and the cast display name', () => {
    const r = inspectorOptions(players, cast({ h1: entry('14', 'Thierry Henry'), h2: entry('4', 'Patrick Vieira'), a1: entry('8', 'İlkay Gündoğan') }));
    expect(r.realNumbers).toBe(true);
    expect(r.options.map(o => o.label)).toEqual(['14 Thierry Henry', '4 Patrick Vieira', '8 İlkay Gündoğan']);
    expect(r.options.map(o => o.name)).toEqual(['Thierry Henry', 'Patrick Vieira', 'İlkay Gündoğan']);
  });
  it('never borrows a slot number for a cast player without shirt number', () => {
    const r = inspectorOptions(players, cast({ h1: entry('14', null), h2: entry(null, 'Patrick Vieira') }));
    expect(r.realNumbers).toBe(true);
    expect(r.options.map(o => o.label)).toEqual(['14 Thierry Henry', '— Patrick Vieira', '— Ilkay Gundogan']);
  });
});
