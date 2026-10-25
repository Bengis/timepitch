import { describe, expect, it, vi } from 'vitest';
import { createTimePitchSession } from './timepitch';
import { sampleFrame } from '../../match/replay';
import { sampleInterval } from '../sampling';
import { bundle, legacyRecord, signal, spatialRecord } from './test-fixtures';
import type { TeamSeason } from '../../api';
import { deferred } from './test-fixtures';

describe('TimePitch data adapter', () => {
  for (const make of [legacyRecord, spatialRecord]) it(`matches existing ${make.name} discrete facts and coordinates without source mutation`, async () => {
    const record = make(), original = JSON.stringify(record), adapter = createTimePitchSession('saved', record);
    for (const ms of [0,125,249,250,499,500,501,750,999,1000,1001,2700000,5400000]) {
      await adapter.ensure(ms, signal());
      const frame = sampleInterval(adapter.snapshot().interval!, ms), expected = sampleFrame(record, ms);
      expect(frame.ball).toEqual(expected.ball); expect(frame.score).toEqual(expected.score); expect(frame.period).toBe(expected.period);
      expect(frame.players.map(p => ({ ...p, key: p.key.replace(/^timepitch:/,'') }))).toEqual(expected.players);
      expect(adapter.snapshot().events.every(e => e.elapsedMs! <= ms)).toBe(true);
    }
    expect(JSON.stringify(record)).toBe(original); adapter.dispose();
  });
  it('resolves simultaneous markers in source order, cues only known actors and raw evidence retained', async () => {
    const adapter = createTimePitchSession('v1', legacyRecord()); await adapter.ensure(1000, signal());
    expect(adapter.snapshot().events.map(e => e.refs[0])).toEqual(['pass','goal']);
    expect(adapter.snapshot().cue).toMatchObject({ type: 'goal', participants: ['timepitch:test:home:1'], t1_ms: 1000 });
    expect(adapter.snapshot().descriptor.export.href).toBe('/api/matches/v1/replay');
  });
  it('uses only requested owned statistics, validates cutoff and never exposes persisted future metrics at the cursor', async () => {
    const record = spatialRecord(); record.statistics = bundle(5400000);
    const statistics = vi.fn(async (_id: string, ms: number) => bundle(ms));
    const adapter = createTimePitchSession('mine', record, { statistics });
    expect(statistics).not.toHaveBeenCalled();
    await adapter.loadPanel('summary', 1000, false, signal());
    expect(statistics).toHaveBeenCalledOnce(); expect(adapter.snapshot().panels.summary?.cutoff?.elapsedMs).toBe(1000);
    await adapter.loadPanel('summary', 1000, true, signal());
    expect(statistics).toHaveBeenCalledOnce(); expect(adapter.snapshot().panels.summary?.scope).toBe('final');
    statistics.mockResolvedValueOnce(bundle(5000));
    await adapter.loadPanel('maps', 2000, false, signal());
    expect(adapter.snapshot().panels.maps?.availability.status).toBe('unavailable');
  });
  it('aborted/disposed reads cannot publish', async () => {
    const adapter = createTimePitchSession('saved', legacyRecord()); const before = adapter.snapshot(); const callback = vi.fn(); adapter.subscribe(callback);
    const control = new AbortController(); control.abort(); await expect(adapter.ensure(1000, control.signal)).rejects.toThrow();
    adapter.dispose(); await expect(adapter.ensure(1000, signal())).rejects.toThrow(); expect(callback).not.toHaveBeenCalled(); expect(adapter.snapshot()).toBe(before);
  });
  it('a late catalog player card cannot restore match metrics from before a backwards seek',async()=>{
    const pending=deferred<TeamSeason>(),stats=bundle(5000);stats.by_player['test:home:1']={shots:{...stats.by_team.home.shots,value:7}};
    const adapter=createTimePitchSession('saved',spatialRecord(),{statistics:async()=>stats,team:async()=>pending.promise});
    await adapter.ensure(5000,signal());await adapter.loadPanel('players',5000,false,signal());
    const card=adapter.loadPlayer('timepitch:test:home:1',signal());await Promise.resolve();await adapter.ensure(0,signal());
    pending.resolve({key:'a:2000',club:'a',name:'A',season_start:2000,season_label:'2000/01',source:'epldata',results_sources:[],dataset_version:'test',
      player_count:1,matches:38,goals_for:0,goals_against:0,available_formations:[],coverage:{},quality_flags:[],
      players:[{key:'test:home:1',source_id:'1',name:'Source player',role:'MID',stats:{},quality_flags:[]}]});
    await card;expect(adapter.snapshot().panels.players?.playerDetails.find(p=>p.id==='timepitch:test:home:1')?.metrics.some(m=>m.id==='shots'&&m.value===7)).toBe(false);adapter.dispose();
  });
});
