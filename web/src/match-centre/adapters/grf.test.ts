import { describe, expect, it, vi } from 'vitest';
import { createGrfSession } from './grf';
import { sampleGrfFrame } from '../../grf/replay';
import { fullFixture, legacyFixture } from '../../grf/test-fixtures';
import { summaryFixture } from '../../grf/statistics/test-fixtures';
import { sampleInterval } from '../sampling';
import { modernGrf, signal } from './test-fixtures';

describe('GRF data adapter', () => {
  for (const make of [legacyFixture, fullFixture, modernGrf]) it(`preserves ${make.name} native clock/phase and existing restart guards`, async () => {
    const record = make(), original = JSON.stringify(record), adapter = createGrfSession('saved', record);
    for (const ms of [0,50,99,100,150,199,200,record.duration_ms]) {
      await adapter.ensure(ms, signal()); const snapshot = adapter.snapshot(), frame = sampleInterval(snapshot.interval!, snapshot.presentedCursor.elapsedMs);
      const expected = sampleGrfFrame(record, ms);
      expect(frame.ball).toEqual(expected.frame.ball); expect(frame.score).toEqual(expected.frame.score); expect(frame.period).toBe(expected.frame.period);
      for(const [index,p] of frame.players.entries()) { const original=expected.frame.players[index];
        expect({...p,key:p.key.replace(/^grf:/,''),x:0,y:0}).toEqual({...original,x:0,y:0});
        expect(p.x).toBeCloseTo(original.x,10);expect(p.y).toBeCloseTo(original.y,10); }
      expect(snapshot.clockMs).toBe(expected.matchTimeMs);
      expect(snapshot.observations?.values.engine_step).toBe(expected.nativeStep);
    }
    expect(JSON.stringify(record)).toBe(original); adapter.dispose();
  });
  it('unknown owner stays unknown, never defaults to the home team', async () => {
    const record = legacyFixture(); record.samples[0].owner_team = -1; record.samples[0].owner_slot = -1;
    const adapter = createGrfSession('free', record); await adapter.ensure(50, signal());
    expect(adapter.snapshot().facts.possession.value).toBeNull(); expect(adapter.snapshot().interval!.before.possession).toBeNull(); expect(adapter.snapshot().interval!.before.carrier).toBeNull();
  });
  it('rejects player/ball displacement and game-mode/score/step/phase discontinuities', async () => {
    const records = Array.from({length:5}, () => legacyFixture());
    records[0].samples[1].home_xy[0] = [.9,.4]; records[1].samples[1].ball_xyz = [1,.4,.1];
    records[2].samples[1].game_mode = 1; records[3].samples[1].score = [1,0]; records[4].samples[1].engine_step += 20;
    for (const record of records) { const adapter = createGrfSession('cut', record); await adapter.ensure(50, signal()); expect(adapter.snapshot().interval!.continuousPlayers.size).toBe(0); expect(adapter.snapshot().interval!.continuousBall).toBe(false); }
  });
  it('loads final statistics only after explicit demand, verifies trace and preserves final scope', async () => {
    const statistics = vi.fn(async () => summaryFixture()); const adapter = createGrfSession('saved', fullFixture(), { statistics });
    await adapter.ensure(0, signal()); expect(statistics).not.toHaveBeenCalled();
    await adapter.loadPanel('summary', 0, false, signal()); expect(statistics).not.toHaveBeenCalled();
    expect(adapter.snapshot().panels.summary?.availability.status).toBe('unavailable');
    await adapter.loadPanel('summary', 0, true, signal()); expect(statistics).toHaveBeenCalledOnce(); expect(adapter.snapshot().panels.summary?.scope).toBe('final');
    const bad = createGrfSession('wrong', fullFixture(), { statistics: async () => summaryFixture('other') });
    await bad.loadPanel('summary', 0, true, signal()); expect(bad.snapshot().panels.summary?.availability.status).toBe('unavailable');
  });
  it('native touch cues are resolved actions; a decision alone cannot animate a pass',async()=>{
    const record=modernGrf(),adapter=createGrfSession('v3',record);await adapter.ensure(99,signal());expect(adapter.snapshot().events).toHaveLength(0);
    await adapter.ensure(100,signal());expect(adapter.snapshot().cue).toMatchObject({type:'pass',participants:['grf:home:p1'],t1_ms:100});
    await adapter.ensure(200,signal());expect(adapter.snapshot().events.find(e=>e.kind==='goal')).toMatchObject({actorId:'grf:home:p1',side:'away',outcome:'own_goal'});
    expect(adapter.snapshot().cue?.type).toBe('goal');adapter.dispose();
    const decision=modernGrf();decision.telemetry.events[0].type='decision';decision.telemetry.events[1].actor_team=-1;
    const other=createGrfSession('decision',decision);await other.ensure(100,signal());expect(other.snapshot().cue).toBeUndefined();other.dispose();
  });
  it('inactive native members are not replaced by invented players',async()=>{
    const record=modernGrf();record.samples[0].home_active[1]=false;const adapter=createGrfSession('active',record);await adapter.ensure(0,signal());
    expect(adapter.snapshot().interval!.before.players).toHaveLength(21);expect(adapter.snapshot().interval!.before.players.some(p=>p.key==='grf:home:p1')).toBe(false);adapter.dispose();
  });
});
