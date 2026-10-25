import type { PanelData, SessionSnapshot } from './session';
import { matchTime, usePlayerText } from './player-messages';

export function MatchData({ panel, snapshot, revealed, explanationsAvailable = false }: { panel: PanelData | undefined; snapshot: SessionSnapshot; revealed: boolean; explanationsAvailable?: boolean }) {
  const t = usePlayerText();
  const { finalResult, ...metadata } = snapshot.descriptor.metadata ?? {};
  return <section className="unified-data"><h2>{t.data}</h2><p>{snapshot.descriptor.identity.source} · {snapshot.descriptor.identity.id} · {snapshot.descriptor.identity.revision}</p>
    <p>{t.clock}: {matchTime(snapshot.clockMs)} · {t.elapsed}: {matchTime(snapshot.presentedCursor.elapsedMs)}</p>
    {snapshot.observations && <details><summary>{t.native} · {snapshot.observations.provenance}</summary><pre>{JSON.stringify(snapshot.observations, null, 2)}</pre></details>}
    <details><summary>{t.source}</summary><pre>{JSON.stringify(metadata, null, 2)}</pre></details>
    {panel?.definitions.map((d, i) => <article key={`${d.id}/${i}`}><h3>{d.id}</h3><p>{d.text}</p><p>{d.provenance} · {d.availability.status} {d.availability.reason}</p>{d.details && <details><summary>{t.details}</summary><pre>{JSON.stringify(d.details, null, 2)}</pre></details>}</article>)}
    {panel?.sourceDetails.map((d, i) => <article key={`${d.id}/${i}`}><h3>{d.id}</h3><p>{d.value === null ? t.missing : String(d.value)}</p><p>{d.provenance} · {d.availability.status} {d.availability.reason}</p><p>{t.refs}: {d.refs.map(ref => <code key={ref}>{ref}</code>)}</p>{d.details && <details><summary>{t.details}</summary><pre>{JSON.stringify(d.details, null, 2)}</pre></details>}</article>)}
    {revealed && (finalResult || panel?.finalDetails) && <details><summary>{t.final}</summary><pre>{JSON.stringify({ finalResult, ...panel?.finalDetails }, null, 2)}</pre></details>}
    <p>{explanationsAvailable ? t.explicitExplanation : t.off}</p>
  </section>;
}
