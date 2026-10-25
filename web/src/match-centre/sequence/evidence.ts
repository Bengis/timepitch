import type { HistoricalEvent } from '../../historical/api';
import type { SessionDescriptor } from '../session';
import type { Point, SequenceEvent } from './types';

const record = (v: unknown): Record<string,unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const text = (v: unknown): string | null => typeof v === 'string' && v.length > 0 ? v : null;
const ns = (v: string) => `historical:${v}`;
function point(value: unknown): Point | null {
  const p = record(value); return finite(p.x) !== null && finite(p.y) !== null ? { x:p.x as number,y:p.y as number } : null;
}
export function normalizeSequenceEvent(e: HistoricalEvent, d: SessionDescriptor): SequenceEvent {
  const p = d.periods.find(p => p.period === e.period);
  if (!e.id || !Number.isInteger(e.source_index) || !Number.isFinite(e.period_ms) || e.period_ms < 0 || p?.startMs == null
    || p.durationMs == null || e.period_ms > p.durationMs) throw new Error('Sequence event identity/time unavailable');
  const identities = Array.isArray(d.metadata?.playerIdentities) ? d.metadata.playerIdentities.map(record) : [];
  const resolveKey = (key: string | null): string | null => key !== null && identities.filter(p => p.key === key).length === 1 ? ns(key) : null;
  const pass = record(e.details?.pass), shot = record(e.details?.shot), keeper = record(e.details?.goalkeeper);
  const recipient = identities.filter(p => p.sourceId === record(pass.recipient).id);
  const rawRecipient = recipient.length === 1 ? text(recipient[0].key) : null;
  const body = text(record(shot.body_part).name) ?? text(record(pass.body_part).name);
  const duration = finite(e.duration);
  const xg = finite(shot.statsbomb_xg);
  return {
    id: ns(e.id), refs: [e.id], sourceIndex:e.source_index, period:e.period, periodMs:e.period_ms, elapsedMs:p.startMs + e.period_ms,
    kind:e.type, actorId:resolveKey(e.player_key), side:e.team_key === d.home.id ? 'home' : e.team_key === d.away.id ? 'away' : null,
    recipientId:resolveKey(rawRecipient), relatedIds:(e.related_events ?? []).filter(id => typeof id === 'string' && id.length > 0).map(ns),
    assistedShotId:text(pass.assisted_shot_id) === null ? null : ns(pass.assisted_shot_id as string), possessionId:finite(e.possession),
    durationMs:duration === null ? null : duration * 1000,
    start:point(e.canonical_location), end:point(e.canonical_end_location),
    outcome:text(record(shot.outcome).name) ?? text(record(pass.outcome).name) ?? text(record(keeper.type).name),
    bodyPart:body === 'Head' ? 'head' : body === 'Left Foot' ? 'left_foot' : body === 'Right Foot' ? 'right_foot' : null,
    xg:xg !== null && xg >= 0 && xg <= 1 ? xg : null,
  };
}
export function validateSequenceEvents(events: readonly SequenceEvent[]): readonly SequenceEvent[] {
  if (new Set(events.map(e => e.id)).size !== events.length) throw new Error('Duplicate sequence event ID');
  if (new Set(events.map(e => e.sourceIndex)).size !== events.length) throw new Error('Duplicate sequence source index');
  return [...events].sort((a,b) => a.elapsedMs - b.elapsedMs || a.sourceIndex - b.sourceIndex);
}
