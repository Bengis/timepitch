// TP205 · Reglas puras de presentación del análisis grabado (posesión al empezar, filtro inicial de la cronología).
import { describe, expect, it } from 'vitest';
import { defaultTimelineFilter, POSSESSION_MIN_MS, shownPossession } from './presentation-rules';
import { initialTimelineFilter, isKeyFact, timelineKinds } from './timeline-rules';

describe('shownPossession', () => {
  const at = (untilMs: number) => ({ untilMs, possession: { home: 1, away: 0, basis: 'recorded_owner' as const } });
  it('hides possession until a minute of play so 0:00 never reads 100 % / 0 %', () => {
    expect(shownPossession(at(0))).toEqual({ home: null, away: null });
    expect(shownPossession(at(POSSESSION_MIN_MS - 1))).toEqual({ home: null, away: null });
  });
  it('shows the recorded share from the first minute on', () => {
    expect(POSSESSION_MIN_MS).toBe(60_000);
    expect(shownPossession(at(POSSESSION_MIN_MS))).toEqual({ home: 1, away: 0 });
  });
  it('keeps an unrecorded possession as unknown', () => {
    expect(shownPossession({ untilMs: 600_000, possession: { home: null, away: null, basis: 'nearest_player' } })).toEqual({ home: null, away: null });
  });
});

describe('defaultTimelineFilter', () => {
  it('opens on key events when the recording has goals', () => {
    expect(defaultTimelineFilter([{ kind: 'shot' }, { kind: 'goal' }])).toBe('key');
  });
  it('opens on chances when the engine recorded no goal (key would only hold half-time)', () => {
    expect(defaultTimelineFilter([{ kind: 'shot' }, { kind: 'halftime' }])).toBe('chances');
    expect(defaultTimelineFilter([])).toBe('chances');
  });
});

// Maqueta v1-2d: la cronología muestra solo hechos clave (goles, tarjetas, cambios, paradas, descanso/final).
describe('timeline key facts (mockup v1-2d)', () => {
  it('counts goals, cards, substitutions, penalties and saves as key facts, not half-time or shots', () => {
    for (const kind of ['goal', 'card_yellow', 'card_red', 'substitution', 'penalty', 'save']) expect(isKeyFact(kind)).toBe(true);
    for (const kind of ['halftime', 'fulltime', 'shot', 'foul', 'corner', 'offside']) expect(isKeyFact(kind)).toBe(false);
  });
  it('opens on Key whenever there is a key fact, and on Chances when Key would only hold the period markers', () => {
    expect(initialTimelineFilter([{ kind: 'shot' }, { kind: 'save' }, { kind: 'halftime' }])).toBe('key');
    expect(initialTimelineFilter([{ kind: 'shot' }, { kind: 'substitution' }])).toBe('key');
    expect(initialTimelineFilter([{ kind: 'shot' }, { kind: 'halftime' }, { kind: 'fulltime' }])).toBe('chances');
    expect(initialTimelineFilter([])).toBe('chances');
  });
  it('filters: Key = key facts + period markers; Chances adds shots; All adds fouls, corners and offsides', () => {
    expect(timelineKinds('key').has('halftime')).toBe(true);
    expect(timelineKinds('key').has('shot')).toBe(false);
    expect(timelineKinds('chances').has('shot')).toBe(true);
    expect(timelineKinds('chances').has('foul')).toBe(false);
    for (const kind of ['foul', 'corner', 'offside', 'save', 'goal']) expect(timelineKinds('all').has(kind)).toBe(true);
    expect(timelineKinds('all').has('kickoff')).toBe(false);
  });
});
