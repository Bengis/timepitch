import type { MatchConfig, TeamSeason } from '../api';
export type Formation = NonNullable<MatchConfig['home_formation']>;
export type Tactic = NonNullable<MatchConfig['home_tactic']>;
export function slots(formation: Formation) {
  const [def, mid, fwd] = formation.split('-').map(Number);
  return ['GK', ...Array<string>(def).fill('DEF'), ...Array<string>(mid).fill('MID'), ...Array<string>(fwd).fill('FWD')];
}
export function defaultLineup(team: TeamSeason, formation: Formation) {
  const remaining = [...team.players].sort((a, b) => (b.stats.minutes?.value ?? 0) - (a.stats.minutes?.value ?? 0) || a.key.localeCompare(b.key));
  return slots(formation).map(role => { const index = remaining.findIndex(p => p.role === role); return index < 0 ? '' : remaining.splice(index, 1)[0].key; });
}
