import { useState } from 'react';
import type { TeamSeason, Statistic } from '../api';
import { useFlagText, useLanguage } from '../i18n';
import { metricLabel,reasonText,useStatsText } from '../match/statistics/messages';

function Stat({ stat }: { stat?: Statistic }) {
  const { locale, t } = useLanguage();
  const status = stat?.status ?? 'unavailable';
  return <span className={`stat ${status}`} title={t[status]}>{stat?.value == null ? '—' : new Intl.NumberFormat(locale).format(stat.value)}</span>;
}

export function Roster({ team }: { team: TeamSeason }) {
  const { t } = useLanguage();
  const flagText = useFlagText();
  const fantasy = team.source === 'fpl';
  return <section className="roster">
    <div className="section-line"><h3>{t.roster}</h3><span>{team.players.length} {t.participants}</span></div>
    <p className="small-note">{t.rosterNote}</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`${team.name} ${t.roster}`}>
      <table>
        <thead><tr><th>{t.player}</th><th>{t.appearances}</th><th>{t.minutes}</th><th>{t.goals}</th><th>{fantasy ? t.assistsFantasy : t.assists}</th></tr></thead>
        <tbody>{team.players.map(player => <tr key={player.key}>
          <td><span className="player-name">{player.name}</span><span className="player-role">{player.role ? t[player.role] : t.unknown}</span>
            {player.quality_flags.length > 0 && <details className="player-notes"><summary>{t.quality}</summary><ul>{player.quality_flags.map(flag => <li key={flag}>{flagText(flag)}</li>)}</ul></details>}
          </td>
          <td><Stat stat={player.stats.appearances} /></td><td><Stat stat={player.stats.minutes} /></td>
          <td><Stat stat={player.stats.goals} /></td><td><Stat stat={player.stats[fantasy ? 'assists_fpl' : 'assists']} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="stat-legend"><span className="measured">● {t.measured}</span><span className="estimated">● {t.estimated}</span><span className="unavailable">— {t.unavailable}</span></div>
    <p className="small-note">{t.advanced}</p>
    <AdvancedRoster team={team}/>
  </section>;
}

function AdvancedRoster({team}:{team:TeamSeason}){
  const {locale}=useLanguage(),t=useStatsText();
  const [selected,setSelected]=useState('');
  const player=team.players.find(p=>p.key===selected)??team.players[0];
  const fields=Object.values(player?.advanced_stats??{});
  const partial=fields.some(value=>value.status==='partial');
  const format=(value:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
  return <details className="advanced-roster"><summary>{t.historicalTitle}</summary>
    <p className="small-note">{t.historicalNote}</p>
    <label>{t.historicalPlayer}<select value={player?.key??''} onChange={e=>setSelected(e.target.value)}>{team.players.map(p=><option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
    {partial&&<p className="small-note partial">{t.partialNote}</p>}
    {!fields.some(value=>value.value!=null)&&<p className="small-note">{t.notCovered}</p>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t.historicalTitle}><table>
      <thead><tr><th>{t.metric}</th><th>{t.recorded}</th><th>{t.per90}</th><th>{t.coverage}</th></tr></thead>
      <tbody>{['xg','xa','starts','tackles','recoveries','cbi'].map(id=>{
        const value=player?.advanced_stats?.[id],rate=player?.advanced_stats?.[id+'_per90'];
        return <tr key={id}><th scope="row">{metricLabel(id,locale)}</th><td><Stat stat={value}/></td><td><Stat stat={rate}/></td>
          <td>{value?.covered_minutes!=null?<><span>{format(value.covered_minutes)} min</span><small>{value.fixtures_covered}/{value.fixtures_total} {t.fixtures} · {value.status==='partial'?t.partial:value.status==='unavailable'?t.unavailable:t.available}</small></>:t.unavailable}
            <details><summary>{t.definition}</summary><p>{t.historical} · {value?.source==='fpl:match_observations'?'Fantasy Premier League':team.source}</p>
              {value?.reason&&<p>{reasonText(value.reason,locale)}</p>}
              {value?.coverage_from&&<p>{value.coverage_from.slice(0,10)} – {value.coverage_to?.slice(0,10)}</p>}
              {value&&<p>{value.unit} · {value.definition_version}</p>}
            </details>
          </td></tr>;
      })}</tbody></table></div>
  </details>;
}
