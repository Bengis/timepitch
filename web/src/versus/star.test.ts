import { describe, expect, it } from 'vitest';
import type { PlayerSeason, Statistic, TeamSeason } from '../api';
import { pickStar, starStats } from './star';

const s = (value: number | null, status: Statistic['status'] = 'measured', unit = 'count'): Statistic =>
  ({ value, source: 'epldata', status: value == null ? 'unavailable' : status, unit });

function player(key: string, role: PlayerSeason['role'], goals: number | null, assists: number | null, minutes: number | null,
  source: 'epldata' | 'fpl' = 'epldata'): PlayerSeason {
  const assistKey = source === 'fpl' ? 'assists_fpl' : 'assists';
  return { key: `${source}:2003:club:${key}`, source_id: key, name: key, role, quality_flags: [], stats: {
    appearances: s(10), goals: s(goals), [assistKey]: s(assists), minutes: s(minutes, source === 'epldata' ? 'estimated' : 'measured', 'minutes'),
  } };
}
const team = (players: PlayerSeason[], source: 'epldata' | 'fpl' = 'epldata') => ({ source, players }) as Pick<TeamSeason, 'source' | 'players'>;

describe('star player rule (TP213)', () => {
  it('picks the highest goals + assists', () => {
    const star = pickStar(team([player('A', 'MID', 5, 20, 3000), player('B', 'FWD', 20, 2, 3000), player('C', 'FWD', 10, 0, 3400)]));
    expect(star?.player.source_id).toBe('A');
    expect(star?.rule).toBe('goals_assists');
    expect(star?.score).toBe(25);
  });

  it('breaks ties by goals, then minutes, then source key', () => {
    expect(pickStar(team([player('A', 'MID', 5, 10, 3000), player('B', 'FWD', 10, 5, 1000)]))?.player.source_id).toBe('B');
    expect(pickStar(team([player('A', 'FWD', 10, 5, 1000), player('B', 'FWD', 10, 5, 2000)]))?.player.source_id).toBe('B');
    expect(pickStar(team([player('B', 'FWD', 10, 5, 2000), player('A', 'FWD', 10, 5, 2000)]))?.player.source_id).toBe('A');
  });

  it('uses the FPL assist definition for FPL seasons and never mixes the two', () => {
    const star = pickStar(team([player('A', 'FWD', 22, 3, 2700, 'fpl'), player('B', 'MID', 4, 9, 1700, 'fpl')], 'fpl'));
    expect(star?.player.source_id).toBe('A');
    expect(star?.assistsKey).toBe('assists_fpl');
  });

  it('missing assists rank as no assists but a missing goals value excludes the player from the scoring rule', () => {
    expect(pickStar(team([player('A', 'FWD', 3, null, 900), player('B', 'FWD', null, 9, 3000)]))?.player.source_id).toBe('A');
  });

  it('falls back to most minutes when nobody scored or assisted (e.g. goalkeepers only)', () => {
    const star = pickStar(team([player('GK1', 'GK', 0, 0, 3420), player('GK2', 'GK', 0, 0, 1200)]));
    expect(star?.player.source_id).toBe('GK1');
    expect(star?.rule).toBe('minutes_fallback');
  });

  it('returns null for an empty squad', () => {
    expect(pickStar(team([]))).toBeNull();
  });

  it('lists goals, assists, appearances and minutes with the source status (never invented)', () => {
    const p = player('A', 'FWD', 30, null, 3330);
    const stats = starStats(p, 'assists');
    expect(stats.map(x => x.id)).toEqual(['goals', 'assists', 'appearances', 'minutes']);
    expect(stats.find(x => x.id === 'assists')?.stat?.value ?? null).toBeNull();
    expect(stats.find(x => x.id === 'minutes')?.stat?.status).toBe('estimated');
  });
});
