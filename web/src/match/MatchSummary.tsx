import type { MatchRecord } from '../api';
import { useMatchText } from './messages';

export function MatchSummary({ record }: { record: MatchRecord }) {
  const m = useMatchText();
  return <section className="match-summary"><h2>{m.summary}</h2><div className="table-scroll"><table><thead><tr><th>{m.match}</th><th>{record.home_name}</th><th>{record.away_name}</th></tr></thead><tbody>
    {(['shots', 'shots_on_target', 'passes', 'completed_passes', 'saves', 'pressures', 'tackles'] as const).map(key => <tr key={key}><td>{m[key]}</td><td>{record.metrics.home?.[key]}</td><td>{record.metrics.away?.[key]}</td></tr>)}
    <tr><td>{m.possession}</td><td>{((record.metrics.home?.possession_ms ?? 0) / 54000).toFixed(1)}%</td><td>{((record.metrics.away?.possession_ms ?? 0) / 54000).toFixed(1)}%</td></tr>
  </tbody></table></div></section>;
}
