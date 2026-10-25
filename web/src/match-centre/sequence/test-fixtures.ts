import type { HistoricalEvent } from '../../historical/api';
import { historicalEvent } from '../adapters/test-fixtures';
import { syntheticFrame, syntheticSnapshot } from '../unified-fixtures';
import { normalizeSequenceEvent } from './evidence';
import { AYEW_SEQUENCE } from './pilot';
import type { SequenceSource } from './types';

export function sequenceDescriptor() {
  const d = syntheticSnapshot().descriptor;
  d.identity = { source: 'historical', id: '3754078', revision: 'test' };
  d.home.id = 'statsbomb:33'; d.away.id = 'statsbomb:26';
  d.durationMs = 5851968;
  d.periods = [{ period: 1, startMs: 0, durationMs: 2880495 }, { period: 2, startMs: 2880495, durationMs: 2971473 }];
  d.metadata = { clockBasis: 'source_period_local', playerIdentities: [3057,7063,20521,3509,3347,3645].map(id => ({ sourceId: id, key: `statsbomb:${id}` })) };
  return d;
}
export function action(id: string, ms: number, kind: string, player: number, details = {}, related: string[] = []): HistoricalEvent {
  return { ...historicalEvent(id, ms, kind), source_index: ms, team_key: [3509,3645].includes(player) ? 'statsbomb:33' : 'statsbomb:26',
    player_key: `statsbomb:${player}`, possession:65, details, related_events: related };
}
export function analysisSource(): SequenceSource {
  const d = sequenceDescriptor();
  const events = [
    action('delivery',1692171,'Pass',7063,{ pass: { recipient: { id: 20521 }, assisted_shot_id: 'header' } }),
    action('header',1693655,'Shot',20521,{ shot: { outcome: { name: 'Saved' }, body_part: { name: 'Head' }, statsbomb_xg: .0826579 } },['save']),
    action('save',1694186,'Goal Keeper',3509,{ goalkeeper: { type: { name: 'Shot Saved' } } },['header']),
    action('recovery',1694593,'Ball Recovery',3347),
    { ...action('carry',1694593,'Carry',3347,{},['recovery','shot']), source_index: 1694594 },
    action('shot',1695068,'Shot',3347,{ shot: { outcome: { name: 'Blocked' }, body_part: { name: 'Left Foot' }, statsbomb_xg: .26275134 } },['block']),
    action('block',1695328,'Block',3645,{},['shot']),
    action('goal',1697116,'Shot',3347,{ shot: { outcome: { name: 'Goal' }, statsbomb_xg: .30670494 } }),
  ].map(e => normalizeSequenceEvent(e, d));
  const names = new Map([[7063,'Montero'],[20521,'Gomis'],[3509,'Courtois'],[3347,'Ayew'],[3645,'Cahill']]);
  return { key: 'test', identity: d.identity, motionRevision: 'test', rawDigest: 'test', request: AYEW_SEQUENCE, events,
    frames: [syntheticFrame({ score: null, possession: null, carrier: null,
      players: [...names].map(([id,name]) => ({ key: `historical:statsbomb:${id}`, name, side: [3509,3645].includes(id) ? 'home' : 'away', role: 'MID', x: 10, y: 20 })) })], cuts: [] };
}
