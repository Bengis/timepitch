import { describe, expect, it } from 'vitest';
import type { TeamSummary } from '../api';
import { clubsOf, EMPTY_FILTER, filterTeams, matchupKind } from './matchup';

const t = (club: string, name: string, year: number) => ({
  key: `${club}:${year}`, club, name, season_start: year, season_label: `${year}/${String(year + 1).slice(-2)}`,
}) as TeamSummary;
const teams = [t('arsenal', 'Arsenal', 2003), t('arsenal', 'Arsenal', 1992), t('mancity', 'Manchester City', 2017), t('leeds', 'Leeds United', 2025)];

describe('versus matchup helpers', () => {
  it('filters by era, club, season and text over the whole catalogue', () => {
    expect(filterTeams(teams, EMPTY_FILTER)).toHaveLength(4);
    expect(filterTeams(teams, { ...EMPTY_FILTER, era: '1990s' }).map(x => x.key)).toEqual(['arsenal:1992']);
    expect(filterTeams(teams, { ...EMPTY_FILTER, era: '2020s' }).map(x => x.key)).toEqual(['leeds:2025']);
    expect(filterTeams(teams, { ...EMPTY_FILTER, club: 'arsenal' }).map(x => x.key)).toEqual(['arsenal:2003', 'arsenal:1992']);
    expect(filterTeams(teams, { ...EMPTY_FILTER, season: '2017' }).map(x => x.key)).toEqual(['mancity:2017']);
    expect(filterTeams(teams, { ...EMPTY_FILTER, query: 'manchester' }).map(x => x.key)).toEqual(['mancity:2017']);
    expect(filterTeams(teams, { ...EMPTY_FILTER, query: '2003/04' }).map(x => x.key)).toEqual(['arsenal:2003']);
  });

  it('lists each club once, by name', () => {
    expect(clubsOf(teams).map(c => c.club)).toEqual(['arsenal', 'leeds', 'mancity']);
  });

  it('classifies the matchup', () => {
    expect(matchupKind('arsenal:2003', 'arsenal:1992')).toBe('same_club');
    expect(matchupKind('arsenal:2003', 'mancity:2017')).toBe('cross_era');
    expect(matchupKind('arsenal:2003', 'mancity:2003')).toBe('same_season');
  });
});
