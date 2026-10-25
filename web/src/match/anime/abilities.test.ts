import { describe, expect, it } from 'vitest';
import { abilityCandidates, abilityFor, abilitySourceText, THRESHOLDS, type AbilityInput } from './abilities';
import { cutInSources, type CutIn } from './cutins';
import { specFor, cardAbility, OUTCOME_TEXT } from './spec';
import { abilityInputFor, matchFacts, teamTopGoals } from './useAnimeAbilities';
import type { Announcement } from '../../match-centre/announcements/announcements';
import type { EventView, PlayerView } from '../../match-centre/session';
import type { PlayerSeason, TeamSeason } from '../../api';

// TP234 · Capitán Hane abilities: visual only, from real data with provenance, zero or one per player.
const m = (value: number | null, status = 'measured') => ({ value, status });
const henry: AbilityInput = { role: 'A', season: { goals: m(30), assists: m(18), teamTopGoals: 30 } };

describe('threshold mapping', () => {
  it('season top scorer with ≥ 12 goals → Ultimate Shot (historical); the strongest of several wins', () => {
    expect(abilityCandidates(henry).map(a => a.id)).toEqual(['ultimate-shot', 'sky-pass']);
    expect(abilityFor(henry)).toMatchObject({ id: 'ultimate-shot', stat: 'season_goals', value: 30, provenance: 'historical' });
    expect(abilityFor({ role: 'A', season: { goals: m(11), teamTopGoals: 11 } })).toBeNull();
    expect(abilityFor({ role: 'A', season: { goals: m(20), teamTopGoals: 25 } })).toBeNull();
    expect(abilityFor({ role: 'A', season: { goals: m(14, 'estimated'), teamTopGoals: 14 } })).toMatchObject({ provenance: 'estimated' });
    expect(abilityFor({ role: 'A', season: { goals: m(30, 'unavailable'), teamTopGoals: 30 } })).toBeNull();
  });
  it('assists ≥ 11 → Sky Pass, from the source definition or, labelled apart, the FPL one', () => {
    expect(abilityFor({ role: 'M', season: { assists: m(11) } })).toMatchObject({ id: 'sky-pass', stat: 'season_assists' });
    expect(abilityFor({ role: 'M', season: { assistsFpl: m(12) } })).toMatchObject({ id: 'sky-pass', stat: 'season_assists_fpl' });
    expect(abilityFor({ role: 'M', season: { assists: m(10) } })).toBeNull();
  });
  it('keepers: ≥ 114 season saves → The Wall; match saves are used only when the season has no saves at all', () => {
    expect(abilityFor({ role: 'K', season: { saves: m(120) } })).toMatchObject({ id: 'wall', provenance: 'historical' });
    expect(abilityFor({ role: 'K', season: { saves: m(54) }, match: { saves: 9 } })).toBeNull();
    expect(abilityFor({ role: 'K', season: { saves: m(null, 'unavailable') }, match: { saves: 4 } })).toMatchObject({ id: 'wall', stat: 'match_saves', provenance: 'simulated' });
    expect(abilityFor({ role: 'D', season: { saves: m(200) } })).toBeNull();
  });
  it('defenders: ≥ 5.4 recoveries per 90 → Shield, else ≥ 4 recorded winning tackles in this match', () => {
    expect(abilityFor({ role: 'D', season: { recoveriesPer90: m(6.1) } })).toMatchObject({ id: 'shield', stat: 'season_recoveries_per90' });
    expect(abilityFor({ role: 'D', match: { tacklesWon: 4 } })).toMatchObject({ id: 'shield', stat: 'match_tackles_won', provenance: 'simulated' });
    expect(abilityFor({ role: 'D', match: { tacklesWon: 3 } })).toBeNull();
  });
  it('the match leader in high-speed distance with ≥ 400 m → Phantom Sprint (simulated)', () => {
    expect(abilityFor({ role: 'M', match: { hsrM: 620, matchTopHsrM: 620 } })).toMatchObject({ id: 'phantom-sprint', provenance: 'simulated' });
    expect(abilityFor({ role: 'M', match: { hsrM: 600, matchTopHsrM: 620 } })).toBeNull();
    expect(abilityFor({ role: 'M', match: { hsrM: 399, matchTopHsrM: 399 } })).toBeNull();
  });
  it('no data, no ability', () => {
    expect(abilityFor({ role: null })).toBeNull();
    expect(abilityFor({ role: 'K', season: null, match: null })).toBeNull();
  });
  it('thresholds are the documented ones', () => {
    expect(THRESHOLDS).toEqual({ ultimateShotGoals: 12, skyPassAssists: 11, wallSeasonSaves: 114, wallMatchSaves: 4, shieldRecoveriesPer90: 5.4,
      shieldMatchTackles: 4, phantomSprintHsrM: 400 });
  });
});

describe('source text', () => {
  it('«Source: <stat> = <value> (<provenance>)» in both languages, with the card chip', () => {
    const a = abilityFor(henry)!;
    expect(abilitySourceText(a, 'en')).toBe('Source: season league goals = 30 (historical)');
    expect(abilitySourceText(a, 'es')).toBe('Fuente: goles de liga en la temporada = 30 (histórico)');
    const shield = abilityFor({ role: 'D', season: { recoveriesPer90: m(6.25, 'estimated') } })!;
    expect(abilitySourceText(shield, 'es')).toBe('Fuente: recuperaciones por 90 en la temporada = 6,3 (estimado)');
    const sprint = abilityFor({ role: 'M', match: { hsrM: 1234.4, matchTopHsrM: 1234.4 } })!;
    expect(abilitySourceText(sprint, 'en')).toBe('Source: high-speed distance in this match (m) = 1,234 (simulated)');
    expect(cardAbility(a, 'es')).toMatchObject({ name: 'Tiro definitivo', chip: 'hist' });
    expect(cardAbility(sprint, 'en')).toMatchObject({ name: 'Phantom Sprint', chip: 'sim' });
    expect(cardAbility(null, 'en')).toBeNull();
  });
});

describe('abilities never affect events or scores', () => {
  const view = (id: string, side: 'home' | 'away', role: string): PlayerView => ({ id, name: id, side, sourceRefs: [], role: { value: role, provenance: 'estimated', refs: [] },
    jersey: { value: null, provenance: 'unavailable', refs: [] }, intervals: { value: null, provenance: 'unavailable', refs: [] }, estimatedAttributes: [], metrics: [],
    availability: { status: 'available', reason: null }, details: { sourceKey: `epldata:2003:arsenal:${id}`, teamKey: 'arsenal:2003' } } as unknown as PlayerView);
  const ann = (kind: Announcement['kind'], atMs: number, primary: string, secondary?: string): Announcement => ({ id: `${kind}@${atMs}`, kind, priority: 50,
    minuteLabel: '', atMs, side: 'home', primaryPlayerId: primary, secondaryPlayerId: secondary, provenance: 'simulated', durationMs: 3000 });
  const events: EventView[] = Object.freeze([]) as unknown as EventView[];
  it('the scene result is always the recorded kind, whatever ability the players have', () => {
    const announcements = Object.freeze([ann('shot_saved', 1000, 'H', 'K'), ann('shot_off_target', 2000, 'H'), ann('goal', 3000, 'H')]) as Announcement[];
    const snapshot = JSON.stringify(announcements);
    const sources = cutInSources(events, announcements);
    const strong = new Map([['H', { identity: { seedKey: 'H' }, ability: abilityFor(henry) }], ['K', { identity: { seedKey: 'K' }, ability: abilityFor({ role: 'K', season: { saves: m(150) } }) }]]);
    const players = [view('H', 'home', 'FWD'), view('K', 'away', 'GK')];
    for (const cut of sources) {
      const spec = specFor(cut, { players, cast: null, data: strong, events, locale: 'en' })!;
      const plain = specFor(cut, { players, cast: null, data: new Map(), events, locale: 'en' })!;
      expect(spec.kind).toBe(cut.kind); expect(plain.kind).toBe(cut.kind);
      expect(spec.outcomeText).toBe(OUTCOME_TEXT.en[cut.kind]); expect(spec.outcomeText).toBe(plain.outcomeText);
    }
    expect(sources.map((s: CutIn) => s.kind)).toEqual(['save', 'miss', 'goal']);
    expect(JSON.stringify(announcements)).toBe(snapshot);
  });
  it('ability inputs read only season stats and recorded match facts, and return no event or score', () => {
    const season = { key: 'epldata:2003:arsenal:H', role: 'FWD', stats: { goals: m(30), assists: m(18) }, advanced_stats: {} } as unknown as PlayerSeason;
    const team = { key: 'arsenal:2003', players: [season, { ...season, key: 'x', stats: { goals: m(12) } }] } as unknown as TeamSeason;
    expect(teamTopGoals(team)).toBe(30);
    const facts = matchFacts([{ id: 's', sourceIndex: 0, kind: 'save', period: 1, periodMs: 0, elapsedMs: 1, side: 'away', actorId: 'K', participantIds: ['K'], outcome: null,
      provenance: 'simulated', refs: [], details: {} }], new Map([['H', 500]]));
    const input = abilityInputFor(view('H', 'home', 'FWD'), { seedKey: 'Q45901', position: 'FW' }, season, teamTopGoals(team), facts);
    expect(Object.keys(input).sort()).toEqual(['match', 'role', 'season']);
    expect(input.match).toEqual({ saves: 0, tacklesWon: 0, hsrM: 500, matchTopHsrM: 500 });
    const result = abilityFor(input)!;
    expect(Object.keys(result).sort()).toEqual(['id', 'provenance', 'stat', 'strength', 'value']);
    expect(result.id).toBe('ultimate-shot');
  });
});
