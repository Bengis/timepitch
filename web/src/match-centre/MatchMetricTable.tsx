import { useState } from 'react';
import { useLanguage } from '../i18n';
import { metricLabel } from '../match/statistics/messages';
import type { MetricView } from './session';
import { usePlayerText } from './player-messages';

export function MatchMetricTable({ metrics, title, names = {} }: { metrics: readonly MetricView[]; title?: string; names?: Readonly<Record<string, string>> }) {
  const t = usePlayerText(), { locale } = useLanguage();
  const [search, setSearch] = useState(''), [group, setGroup] = useState('');
  const groups = [...new Set(metrics.map(m => String(m.details?.group ?? m.definition.split(':')[0])))];
  const filtered = metrics.filter(m => (!group || String(m.details?.group ?? m.definition.split(':')[0]) === group) && `${m.id} ${m.definition} ${m.subject?.id ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const scale = (m: MetricView): number | null => {
    if (m.subject?.kind !== 'team' || m.unit !== 'count') return null;
    const peers = metrics.filter(p => p.id === m.id && p.definition === m.definition && p.unit === m.unit && p.subject?.kind === 'team');
    if (peers.length !== 2 || peers[0].subject!.id === peers[1].subject!.id || peers.some(p => p.value === null || p.value < 0 || p.availability.status !== 'available') || JSON.stringify(peers[0].details?.denominator) !== JSON.stringify(peers[1].details?.denominator)) return null;
    return Math.max(1, ...peers.map(p => p.value!));
  };
  return <section className="unified-metrics"><div className="unified-filters"><label>{t.search}<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label><label>{t.group}<select value={group} onChange={e => setGroup(e.target.value)}><option value="">{t.all}</option>{groups.map(g => <option key={g}>{g}</option>)}</select></label></div>
    <div className="unified-table"><table><caption>{title ?? t.metric}</caption><thead><tr><th scope="col">{t.metric}</th><th scope="col">{t.subject}</th><th scope="col">{t.value}</th><th scope="col">{t.details}</th></tr></thead><tbody>{filtered.map((m, index) => <tr key={`${m.id}/${m.subject?.id}/${m.definition}/${index}`} data-metric-id={m.id}>
      <th scope="row">{metricLabel(m.id, locale) !== m.id && <span>{metricLabel(m.id, locale)}<br /></span>}<code>{m.id}</code></th><td>{m.subject ? names[m.subject.id] ?? m.subject.id : '—'}</td><td>{m.value === null || m.availability.status === 'unavailable' ? t.missing : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(m.value)}${m.unit ? ` ${m.unit}` : ''}`}{scale(m) !== null && <meter min="0" max={scale(m)!} value={m.value!} aria-label={`${m.id} · ${m.subject?.id}`} />}</td>
      <td><details><summary>{m.availability.status} · {m.provenance}</summary><p>{t.definition}: {m.definition}</p>{m.availability.reason && <p>{m.availability.reason}</p>}<p>{t.refs}: {m.evidenceIds.join(', ') || '—'}</p>{m.details && <pre>{JSON.stringify(m.details, null, 2)}</pre>}</details></td>
    </tr>)}</tbody></table></div>{filtered.length === 0 && <p>{t.empty}</p>}
  </section>;
}
