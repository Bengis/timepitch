import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHistoricalSession } from './historical';
import { sampleInterval } from '../sampling';
import { deferred, historicalEvent, signal, sourceReaders } from './test-fixtures';
import type { HistoricalStatistics, ReconstructionSegment } from '../../historical/api';

afterEach(() => vi.useRealTimers());
describe('historical source adapter', () => {
  it('concatenates actual period durations; unknown duration remains unknown but facts/manual windows work', async () => {
    const f = sourceReaders(); f.match.clock!.periods.push({ ...f.match.clock!.periods[0], period:2,duration_ms:12345,observed_end_ms:12345,playback_start_ms:125000 });
    const adapter = createHistoricalSession(9,'v1',{readers:f.readers}); await adapter.ensure(0,signal());
    expect(adapter.snapshot().descriptor.durationMs).toBe(137345); expect(adapter.snapshot().descriptor.periods[1].startMs).toBe(125000);
    const unknown = sourceReaders(); unknown.match.clock!.periods[0].duration_ms=null;
    unknown.events.push(historicalEvent('manual',10000));
    const other = createHistoricalSession(9,'v1',{readers:unknown.readers}); await other.ensure(0,signal());
    expect(other.snapshot().descriptor.durationMs).toBeNull();
    await other.loadEvents(1,0,60000,signal()); expect(other.snapshot().events[0].refs[0]).toBe('manual');
    expect(other.snapshot().panels.players?.players[0].name).toBe('Recorded player'); adapter.dispose(); other.dispose();
  });
  it('keeps ending-period facts, source intervals, panel/player cutoffs and resumes the next period at the same time', async () => {
    const f=sourceReaders();f.match.clock!.periods.push({...f.match.clock!.periods[0],period:2,duration_ms:12345,observed_end_ms:12345,playback_start_ms:125000});
    f.manifest.segments.push({...f.manifest.segments[0],period:2,index:0,from_ms:0,to_ms:12345});
    const stats=vi.fn(f.readers.statistics);
    const adapter=createHistoricalSession(9,'v1',{readers:{...f.readers,statistics:stats}});
    await adapter.ensure(125000,signal(),{playback:'paused',endingPeriod:1});
    expect(adapter.snapshot().presentedCursor).toEqual({elapsedMs:125000,period:1,periodMs:125000});
    expect(adapter.snapshot().interval?.before.period).toBe(1);
    await adapter.loadPanel('players',125000,false,signal(),{playback:'paused',endingPeriod:1});
    expect(stats.mock.calls.at(-1)?.slice(1,3)).toEqual([1,125000]);
    expect(adapter.snapshot().panels.players?.cutoff).toMatchObject({period:1,periodMs:125000});
    await adapter.loadPlayer('historical:statsbomb:10',signal());
    expect(adapter.snapshot().panels.players?.cutoff?.period).toBe(1);
    await adapter.ensure(125000,signal(),{playback:'playing',explicitSeek:true});
    expect(adapter.snapshot().presentedCursor).toEqual({elapsedMs:125000,period:2,periodMs:0});
    await adapter.ensure(124999,signal(),{playback:'paused',endingPeriod:1});
    expect(adapter.snapshot().loadState).toBe('unavailable');adapter.dispose();
  });
  it('uses authoritative cumulative goals/own-goal pairing, orders equal-time events, and exposes no future action', async () => {
    const f=sourceReaders(); f.events.push(historicalEvent('regular',1000,'Shot',1),historicalEvent('own-against',1000,'Own Goal Against',2),historicalEvent('own-for',1000,'Own Goal For',3),historicalEvent('later',2000,'Shot',4));
    f.readers.statistics=async (_id,period,ms)=>({ ...await sourceReaders().readers.statistics(_id,period,ms),
      goals:[{at:{period:1,period_ms:1000},team_key:'statsbomb:1',kind:'regular',player_key:'statsbomb:10',event_ids:['regular']},
        {at:{period:1,period_ms:1000},team_key:'statsbomb:2',kind:'own_goal',own_goal_player_key:'statsbomb:10',event_ids:['own-against','own-for']}],score:{home:1,away:1} });
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers}); await adapter.ensure(999,signal());
    expect(adapter.snapshot().facts.score.value).toEqual({home:0,away:0}); expect(adapter.snapshot().events).toHaveLength(0);
    await adapter.ensure(1000,signal()); expect(adapter.snapshot().facts.score.value).toEqual({home:1,away:1});
    expect(adapter.snapshot().events.map(e=>e.refs[0])).toEqual(['regular','own-against','own-for']);
    expect(adapter.snapshot().milestones).toHaveLength(2);
    expect(adapter.snapshot().cue?.participants[0]).toBe('historical:statsbomb:10'); adapter.dispose();
  });
  it('keeps partial membership/null ball and entity cuts, without inventing players/carrier/roles', async () => {
    const f=sourceReaders(); f.manifest.roster.push({index:1,key:'statsbomb:missing',team_key:'statsbomb:2'});
    f.readers.segment=async (_id,period,index)=>{const s=f.segment(period,index); s.cuts=[{id:'cut',period,from_ms:0,to_ms:100,entity_key:'statsbomb:10',reason:'conflict'}]; return s;};
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers}); await adapter.ensure(50,signal()); const s=adapter.snapshot();
    expect(s.interval!.before.players).toHaveLength(1); expect(s.interval!.continuousPlayers.size).toBe(0);
    expect(sampleInterval(s.interval!,50).ball).toBeNull(); expect(s.facts.carrierId.value).toBeNull();
    expect(s.panels.players?.players[0].role.value).toBeNull(); expect(s.layers?.cuts[0].id).toBe('cut'); adapter.dispose();
  });
  it('reverse-order windows cannot paint another cursor, even if an old reader ignores abort', async () => {
    const f=sourceReaders(), old=deferred<ReconstructionSegment>(), newer=deferred<ReconstructionSegment>();
    f.readers.segment=async (_id,_period,index)=>index===0?old.promise:newer.promise;
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers}); const a=adapter.ensure(50,signal()); await Promise.resolve();
    const b=adapter.ensure(60050,signal()); await Promise.resolve(); newer.resolve(f.segment(1,1)); await b;
    expect(adapter.snapshot().presentedCursor.elapsedMs).toBe(60050);
    old.resolve(f.segment(1,0)); await a; expect(adapter.snapshot().presentedCursor.elapsedMs).toBe(60050); adapter.dispose();
  });
  it('100 same-window demands deduplicate network reads and cached seek does no segment GET', async () => {
    const f=sourceReaders(); const segments=vi.spyOn(f.readers,'segment'),events=vi.spyOn(f.readers,'events');
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers});
    await Promise.all(Array.from({length:100},(_,i)=>adapter.ensure(i,signal(),{playback:'playing'})));
    expect(segments).toHaveBeenCalledOnce(); expect(events).toHaveBeenCalledOnce();
    await adapter.ensure(50,signal()); expect(segments).toHaveBeenCalledOnce(); adapter.dispose();
  });
  it('LRU keeps three segments, checks identity and rejects payloads larger than4MiB', async () => {
    const f=sourceReaders(); f.match.clock!.periods[0].duration_ms=300000;
    f.manifest.segments=Array.from({length:5},(_,index)=>({...f.manifest.segments[0],index,from_ms:index*60000,to_ms:(index+1)*60000}));
    const segments=vi.spyOn(f.readers,'segment'); const adapter=createHistoricalSession(9,'v1',{readers:f.readers});
    vi.useFakeTimers();
    for (const ms of [0,60000,120000,180000,60000]) { const run=adapter.ensure(ms,signal()); await vi.runAllTimersAsync(); await run; }
    expect(segments).toHaveBeenCalledTimes(4);
    const run=adapter.ensure(0,signal()); await vi.runAllTimersAsync(); await run; expect(segments).toHaveBeenCalledTimes(5);
    expect(adapter.cacheUsage().segments).toBeLessThanOrEqual(3); expect(adapter.cacheUsage().segmentBytes).toBeLessThanOrEqual(12*1024*1024); adapter.dispose();
    const bad=sourceReaders(); bad.readers.segment=async()=>({...bad.segment(1,0),reconstruction_id:'other'});
    const other=createHistoricalSession(9,'v1',{readers:bad.readers}); await other.ensure(0,signal()); expect(other.snapshot().loadState).toBe('facts_only'); other.dispose();
    const huge=sourceReaders(); huge.readers.segment=async()=>({...huge.segment(1,0),anchors:[],padding:'x'.repeat(4*1024*1024)}) as ReconstructionSegment;
    const large=createHistoricalSession(9,'v1',{readers:huge.readers}); await large.ensure(0,signal()); expect(large.snapshot().loadState).toBe('facts_only'); large.dispose();
  });
  it('missing/corrupt motion is facts-only, event failure distinct, failed reads do not auto-retry', async () => {
    const f=sourceReaders(); const segments=vi.spyOn(f.readers,'segment').mockRejectedValue(new Error('corrupt'));
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers}); await adapter.ensure(0,signal()); await adapter.ensure(50,signal());
    expect(adapter.snapshot().loadState).toBe('facts_only'); expect(adapter.snapshot().facts.score.value).toEqual({home:0,away:0}); expect(segments).toHaveBeenCalledOnce();
    segments.mockImplementation(async(_id,period,index)=>f.segment(period,index)); await adapter.retry(50,signal()); expect(adapter.snapshot().loadState).toBe('ready'); adapter.dispose();
    const failed=sourceReaders(); failed.readers.events=async()=>{throw new Error('unavailable');};
    const other=createHistoricalSession(9,'v1',{readers:failed.readers}); await other.ensure(0,signal());
    expect(other.snapshot().loadState).toBe('unavailable'); expect(other.snapshot().reason).toContain('events'); other.dispose();
  });
  it('coalesces5s playing stats with at most one read and4 starts/sec; exact paused seek excludes future snapshots', async () => {
    vi.useFakeTimers(); const f=sourceReaders(); const starts:number[]=[]; let inFlight=0,peak=0;
    f.readers.statistics=vi.fn(async(_id,period,ms)=>{ starts.push(Date.now()); inFlight++; peak=Math.max(peak,inFlight);
      await new Promise(r=>setTimeout(r,40)); inFlight--; return {...await sourceReaders().readers.statistics(_id,period,ms)}; });
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers,now:()=>Date.now()});
    const init=adapter.ensure(0,signal()); await vi.runAllTimersAsync(); await init;
    const demands=Array.from({length:100},(_,i)=>adapter.loadPanel('summary',i*60,false,signal(),{playback:'playing'}));
    await vi.runAllTimersAsync(); await Promise.all(demands); expect(peak).toBe(1);
    for (let i=0;i<starts.length;i++) expect(starts.filter(t=>t>=starts[i]&&t<starts[i]+1000).length).toBeLessThanOrEqual(4);
    expect(adapter.snapshot().panels.summary?.cutoff?.periodMs).toBe(5000);
    const back=adapter.ensure(1234,signal(),{playback:'paused',explicitSeek:true}); await vi.runAllTimersAsync(); await back;
    const stats=adapter.loadPanel('summary',1234,false,signal(),{playback:'paused'}); await vi.runAllTimersAsync(); await stats;
    expect(adapter.snapshot().panels.summary?.cutoff?.periodMs).toBe(1234); expect(adapter.snapshot().panels.summary?.metrics.some(m=>m.value===null)).toBe(true); adapter.dispose();
  });
  it('aborted stats and a disposed dataset identity never publish late results', async () => {
    vi.useFakeTimers(); const f=sourceReaders(), delayed=deferred<HistoricalStatistics>();
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers}); const init=adapter.ensure(0,signal()); await vi.runAllTimersAsync(); await init;
    const callback=vi.fn(); adapter.subscribe(callback); f.readers.statistics=async()=>delayed.promise;
    // Reader identity is captured, but the late transport is abort-insensitive by design.
    const control=new AbortController(); const old=adapter.loadPanel('summary',5000,false,control.signal);
    await vi.advanceTimersByTimeAsync(250); control.abort(); adapter.dispose(); callback.mockClear();
    delayed.resolve({...await sourceReaders().readers.statistics(9,1,5000),dataset_version:'other'}); await old.catch(()=>{});
    expect(callback).not.toHaveBeenCalled();
  });
  it('uses source membership for substitutions and dismissals, and retains source event participant IDs',async()=>{
    const f=sourceReaders();f.match.lineups![0].players.push({key:'statsbomb:20',source_id:20,name:'Replacement',positions:[],cards:[]});
    f.manifest.roster.push({index:1,key:'statsbomb:20',team_key:'statsbomb:1'});
    const sub=historicalEvent('sub',100,'Substitution',2);sub.details={substitution:{replacement:{id:20,name:'Replacement'}}};
    f.events.push(sub,historicalEvent('red',1000,'Bad Behaviour',3));
    f.readers.segment=async(_id,p,i)=>{const s=f.segment(p,i);s.frames=[{...s.frames[0],period_ms:0,players:[[0,20,30]]},
      {...s.frames[0],period_ms:100,players:[[1,25,30]]},{...s.frames[0],period_ms:1000,players:[]}];return s;};
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers});await adapter.ensure(50,signal());
    expect(adapter.snapshot().interval!.continuousPlayers.size).toBe(0);
    await adapter.ensure(100,signal());expect(adapter.snapshot().interval!.before.players[0].key).toBe('historical:statsbomb:20');
    expect(adapter.snapshot().events[0].participantIds).toEqual(['historical:statsbomb:10','historical:statsbomb:20']);
    await adapter.ensure(1000,signal());expect(adapter.snapshot().interval!.before.players).toHaveLength(0);adapter.dispose();
  });
  it('unknown source start/period gaps do not manufacture a playable extent',async()=>{
    const f=sourceReaders();f.match.clock!.periods[0].playback_start_ms=null;
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers});await adapter.ensure(0,signal());
    expect(adapter.snapshot().descriptor.durationMs).toBeNull();expect(adapter.snapshot().descriptor.periods[0].startMs).toBeNull();
    expect(adapter.snapshot().panels.players?.players).toHaveLength(1);adapter.dispose();
  });
  it('an automatic source-window request invalidates an older manual event browser response',async()=>{
    const f=sourceReaders(),late=deferred<import('../../historical/api').HistoricalEvent[]>();
    f.events.push(historicalEvent('current',10));const original=f.readers.events;
    f.readers.events=async(id,p,from,to)=>from===60000?late.promise:original(id,p,from,to);
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers});await adapter.ensure(50,signal());
    const manual=adapter.loadEvents(1,60000,120000,signal());await Promise.resolve();
    await adapter.ensure(60,signal());late.resolve([historicalEvent('obsolete',60010)]);await manual;
    expect(adapter.snapshot().eventWindow?.mode).toBe('cursor');expect(adapter.snapshot().events.map(e=>e.refs[0])).toEqual(['current']);adapter.dispose();
  });
  it('real elapsed120× demands crossing windows remain bounded and keep at most one statistics transport',async()=>{
    vi.useFakeTimers();const f=sourceReaders(),events=vi.spyOn(f.readers,'events'),segments=vi.spyOn(f.readers,'segment');
    const starts:number[]=[];let active=0,peak=0;const read=f.readers.statistics;
    f.readers.statistics=async(id,p,ms)=>{starts.push(Date.now());peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,20));active--;return read(id,p,ms);};
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers,now:()=>Date.now()});const first=adapter.ensure(0,signal());await vi.runAllTimersAsync();await first;
    const tasks:Promise<void>[]=[];
    for(let i=1;i<=100;i++){tasks.push(adapter.ensure(i*16*120,signal(),{playback:'playing'}),adapter.loadPanel('summary',i*16*120,false,signal(),{playback:'playing'}));await vi.advanceTimersByTimeAsync(16);}
    await vi.runAllTimersAsync();await Promise.all(tasks);
    expect(events.mock.calls.length).toBeLessThanOrEqual(3);expect(segments.mock.calls.length).toBeLessThanOrEqual(3);expect(peak).toBe(1);expect(starts.length).toBeGreaterThan(2);
    for(const start of starts)expect(starts.filter(t=>t>=start&&t<start+1000).length).toBeLessThanOrEqual(4);
    expect(adapter.snapshot().presentedCursor.elapsedMs).toBe(125000);adapter.dispose();
  });
  it('does not render duplicated roster identities as two different players',async()=>{
    const f=sourceReaders();f.manifest.roster.push({...f.manifest.roster[0],index:1});
    f.readers.segment=async(_id,p,i)=>{const s=f.segment(p,i);s.frames=s.frames.map(frame=>({...frame,players:[[0,20,30],[1,30,30]]}));return s;};
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers});await adapter.ensure(0,signal());expect(adapter.snapshot().interval!.before.players).toHaveLength(0);adapter.dispose();
  });
  it('changing source window releases obsolete segment consumers rather than only hiding their late result',async()=>{
    const f=sourceReaders(),old=deferred<ReconstructionSegment>();let oldSignal:AbortSignal|undefined;
    const segment=vi.fn(async(_id:number,p:number,index:number,s:AbortSignal)=>{if(index===0){oldSignal=s;return old.promise;}return f.segment(p,index);});
    const adapter=createHistoricalSession(9,'v1',{readers:{...f.readers,segment}});
    const first=adapter.ensure(50,signal());await vi.waitFor(()=>expect(segment).toHaveBeenCalledOnce());
    await adapter.ensure(60050,signal());expect(oldSignal!.aborted).toBe(true);
    old.resolve(f.segment(1,0));await first;expect(adapter.snapshot().presentedCursor.elapsedMs).toBe(60050);adapter.dispose();
  });
  it('verifies active dataset identity before accepting unversioned match metadata',async()=>{
    const f=sourceReaders(),match=vi.spyOn(f.readers,'match');f.readers.capabilities=async()=>({...await sourceReaders().readers.capabilities(),dataset_version:'other'});
    const adapter=createHistoricalSession(9,'v1',{readers:f.readers});await adapter.ensure(0,signal());
    expect(adapter.snapshot().loadState).toBe('unavailable');expect(match).not.toHaveBeenCalled();adapter.dispose();
  });
});
