import type { PitchProjection } from '../match/renderers/types';
import type { SessionSnapshot } from './session';
import { usePlayerText } from './player-messages';

export function MatchLayers({ layers, projection, elapsedMs, showAnchors, label }: { layers: SessionSnapshot['layers']; projection: PitchProjection; elapsedMs: number; showAnchors: boolean; label?: string }) {
  const t = usePlayerText();
  const visible = layers?.anchors.filter(a => a.point && a.elapsedMs !== null && a.elapsedMs <= elapsedMs && elapsedMs - a.elapsedMs <= 2000) ?? [];
  return showAnchors && <svg className="unified-anchor-overlay" viewBox={`0 0 ${projection.viewport.width} ${projection.viewport.height}`} role="img" aria-label={label ?? t.anchors}>{visible.map(a => {
    const point = projection.projectFieldPoint(a.point!.x, a.point!.y);
    return point && <g key={a.id} data-anchor={a.id}><title>{a.eventId} · {a.status} · {a.reason ?? ''}</title><circle cx={point.x} cy={point.y} r="3" fill="none" stroke="currentColor" /></g>;
  })}</svg>;
}

export function MatchLayerEvidence({ layers }: { layers: SessionSnapshot['layers'] }) {
  const t = usePlayerText();
  return <div className="unified-layer-evidence">{!!layers?.cuts.length && <details><summary>{t.cuts} ({layers.cuts.length})</summary><ul>{layers.cuts.map(c => <li key={c.id}>{c.reason}<details><summary>{t.details}</summary><pre>{JSON.stringify(c, null, 2)}</pre></details></li>)}</ul></details>}
    {!!layers?.anchors.length && <details><summary>{t.anchors} ({layers.anchors.length})</summary><ul>{layers.anchors.map(a => <li key={a.id}>{a.eventId} · {a.status} · {a.reason}<details><summary>{t.refs}</summary><pre>{JSON.stringify(a, null, 2)}</pre></details></li>)}</ul></details>}
  </div>;
}
