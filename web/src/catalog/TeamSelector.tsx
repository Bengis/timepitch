import { useMemo, useState } from 'react';
import type { TeamSummary } from '../api';
import { useLanguage } from '../i18n';

type Props = { side: 'home' | 'away'; teams: TeamSummary[]; value: string; onChange: (key: string) => void };

export function TeamSelector({ side, teams, value, onChange }: Props) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [season, setSeason] = useState('');
  const years = useMemo(() => [...new Set(teams.map(team => team.season_start))].sort((a, b) => b - a), [teams]);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = teams.filter(team => (!season || String(team.season_start) === season) &&
    `${team.name} ${team.club} ${team.season_label}`.toLocaleLowerCase().includes(needle));
  const containsSelected = filtered.some(team => team.key === value);

  return <div className="team-selector">
    <div className="side-label"><span className={`side-dot ${side}`} />{t[side]}</div>
    <div className="filter-row">
      <label htmlFor={`${side}-search`}>{t.search}<input id={`${side}-search`} type="search" placeholder={t.searchPlaceholder} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label htmlFor={`${side}-season`}>{t.season}<select id={`${side}-season`} value={season} onChange={e => setSeason(e.target.value)}>
        <option value="">{t.allSeasons}</option>
        {years.map(year => <option key={year} value={year}>{year}/{String(year + 1).slice(-2)}</option>)}
      </select></label>
    </div>
    <label htmlFor={`${side}-team`}>{t.teamSeason}<select id={`${side}-team`} value={containsSelected ? value : ''} onChange={e => onChange(e.target.value)}>
      {!containsSelected && <option value="" disabled>{t.choose}</option>}
      {filtered.map(team => <option key={team.key} value={team.key}>{team.name} · {team.season_label}</option>)}
    </select></label>
    <p className="filter-count" aria-live="polite">{filtered.length ? `${filtered.length} ${t.options}` : t.noTeams}</p>
    {!containsSelected && filtered.length > 0 && <p className="small-note">{t.outsideFilters}</p>}
  </div>;
}
