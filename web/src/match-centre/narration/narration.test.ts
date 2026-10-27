import { describe, expect, it } from 'vitest';
import type { EventView } from '../session';
import { narrate, type NarrationContext } from './narration';

const ev = (id: string, kind: string, ms: number, side: 'home' | 'away' | null, actor: string | null, extra: Partial<EventView> = {}, details: Record<string, unknown> = {}): EventView => ({
  id, sourceIndex: ms, kind, period: 1, periodMs: ms, elapsedMs: ms, side, actorId: actor, participantIds: actor ? [actor] : [],
  outcome: null, provenance: 'simulated', refs: [], details, ...extra,
});
const NAMES: Record<string, string> = { vieira: 'Patrick Vieira', henry: 'Thierry Henry', haaland: 'Erling Haaland', ederson: 'Ederson', lehmann: 'Jens Lehmann', rodri: 'Rodri' };
const ctx = (locale: 'es' | 'en' = 'es'): NarrationContext => ({ locale, name: id => id ? NAMES[id] ?? null : null,
  teams: { home: 'Arsenal', away: 'Man City' }, keepers: new Set(['ederson', 'lehmann']) });
const texts = (events: EventView[], locale: 'es' | 'en' = 'es') => narrate(events, ctx(locale)).map(l => l.text);

describe('narration (TP241)', () => {
  it('narrates recorded GRF pass attempts and shots without inventing a recipient, distance or save',()=>{
    const events=[
      ev('p','pass',1000,'home','vieira',{}, {engine:'grf',native:'touch:long_pass',subtype:'long_pass'}),
      ev('short','pass',2000,'home','henry',{}, {engine:'grf',native:'touch:short_pass',subtype:'short_pass'}),
      ev('s','shot',3000,'home','henry',{}, {engine:'grf',native:'touch:shot'}),
      ev('next','pass',4000,'away','ederson',{}, {engine:'grf',native:'touch:short_pass',subtype:'short_pass'}),
      ev('off','offside',5000,'away','haaland',{}, {engine:'grf',native:'decision:offside:awarded'}),
    ];
    const lines=texts(events,'en');
    expect(lines).toContain('Patrick Vieira attempts a long pass.');
    expect(lines).toContain('Thierry Henry shoots.');
    expect(lines).toContain('Erling Haaland is offside.');
    expect(lines.join(' ')).not.toMatch(/metres|saves|pass to/);
  });
  it('TimePitch: long passes with metres and receiver; short passes are not narrated', () => {
    const long = ev('p1', 'pass', 1000, 'home', 'vieira', { outcome: 'complete', participantIds: ['vieira', 'henry'] }, { origin_mm: [40000, 30000], end_mm: [70000, 30000] });
    const short = ev('p2', 'pass', 2000, 'home', 'henry', { outcome: 'complete', participantIds: ['henry', 'vieira'] }, { origin_mm: [70000, 30000], end_mm: [75000, 30000] });
    const passes = (locale: 'es' | 'en', list: EventView[]) => narrate(list, ctx(locale)).filter(l => l.kind === 'pass').map(l => l.text);
    expect(passes('es', [long, short])).toEqual(['Patrick Vieira pasa en largo a Thierry Henry, 30 metros.']);
    expect(passes('en', [long])).toEqual(['Patrick Vieira plays a long pass to Thierry Henry, 30 metres.']);
  });

  it('TimePitch: shot outcomes, the keeper who saves, ball won and the running score on goals', () => {
    const events = [
      ev('k', 'kickoff', 0, 'home', 'henry'),
      ev('t', 'tackle', 1000, 'away', 'rodri', { outcome: 'won_ball', participantIds: ['rodri', 'vieira'] }),
      ev('s1', 'shot', 2000, 'away', 'haaland', { outcome: 'saved' }, { id: 'e9' }),
      ev('sv', 'save', 2100, 'home', 'lehmann', { outcome: 'saved' }, { evidence: { shot_id: 'e9' } }),
      ev('s2', 'shot', 3000, 'home', 'henry', { outcome: 'off_target' }),
      ev('s3', 'shot', 4000, 'home', 'henry', { outcome: 'goal' }),
      ev('g', 'goal', 4000, 'home', 'henry', { outcome: 'scored' }),
      ev('h', 'halftime', 5000, null, null),
    ];
    expect(texts(events)).toEqual([
      'Empieza el partido. Saca el Arsenal.',
      'Rodri le roba el balón a Patrick Vieira.',
      'Erling Haaland dispara… ¡y para Jens Lehmann!',
      'Thierry Henry dispara… ¡fuera!',
      'Thierry Henry dispara… ¡GOL! Arsenal 1–0 Man City.',
      'Descanso. Arsenal 1–0 Man City.',
    ]);
  });

  it('GRF: long pass received by a team-mate, the shot outcome deduced from the next touch, set pieces and offside', () => {
    const grf = (id: string, kind: string, ms: number, side: 'home' | 'away', actor: string, ball: [number, number]) =>
      ev(id, kind, ms, side, actor, {}, { type: 'touch', ball_xyz: [ball[0], ball[1], 0.1] });
    const events = [
      grf('a', 'long_pass', 1000, 'home', 'vieira', [0, 0]),
      grf('b', 'trap', 2000, 'home', 'henry', [0.6, 0]),
      grf('c', 'shot', 3000, 'home', 'henry', [0.8, 0]),
      grf('d', 'ball_control', 4000, 'away', 'ederson', [0.95, 0]),
      ev('e', 'corner', 9000, 'home', null, {}, { type: 'decision' }),
      ev('f', 'offside', 10000, 'away', 'haaland', {}, { type: 'decision' }),
      // La falta por ese fuera de juego no se narra aparte.
      ev('g', 'free_kick', 12000, 'home', null, {}, { type: 'decision' }),
    ];
    // 0,6 en x son 31,5 m.
    expect(texts(events)).toEqual([
      'Empieza el partido: Arsenal contra Man City.',
      'Patrick Vieira pasa en largo a Thierry Henry, 32 metros.',
      'Thierry Henry dispara… ¡y para Ederson!',
      'Córner a favor del Arsenal.',
      'Fuera de juego de Erling Haaland.',
    ]);
    // La frase del tiro sale cuando se sabe el desenlace, no antes.
    expect(narrate(events, ctx()).find(l => l.kind === 'save')?.atMs).toBe(4000);
  });

  it('TouchLines recordings: long passes in metres to a real receiver, recorded shot outcomes with the saving keeper, one full time (TP243)', () => {
    const tl = (id: string, kind: string, ms: number, side: 'home' | 'away' | null, actor: string | null, extra: Partial<EventView> = {}, details: Record<string, unknown> = {}) =>
      ev(id, kind, ms, side, actor, extra, { engine: 'touchlines', ...details });
    const events = [
      tl('p1', 'pass', 1000, 'home', 'vieira', { participantIds: ['vieira', 'henry'] }, { distance_yd: 33 }),
      tl('p2', 'pass', 2000, 'home', 'henry', { participantIds: ['henry', 'henry'] }, { distance_yd: 40 }),
      tl('s1', 'shot', 3000, 'away', 'haaland', { outcome: 'saved' }, { resolved_t_ms: 3500 }),
      tl('sv', 'save', 3500, 'home', 'lehmann'),
      tl('f1', 'fulltime', 9000, null, null), tl('f2', 'fulltime', 9000, null, null),
    ];
    expect(texts(events)).toEqual([
      'Empieza el partido: Arsenal contra Man City.',
      'Patrick Vieira pasa en largo a Thierry Henry, 30 metros.',
      'Erling Haaland dispara… ¡y para Jens Lehmann!',
      '¡Final del partido! Arsenal 0–0 Man City.',
    ]);
  });

  it('never narrates an unknown shot outcome', () => {
    const shot = ev('c', 'shot', 3000, 'home', 'henry', {}, { type: 'touch' });
    expect(texts([shot, ev('d', 'other', 3500, 'home', 'vieira', {}, { type: 'touch' })])).toEqual(['Empieza el partido: Arsenal contra Man City.']);
  });
});
