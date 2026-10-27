import {expect,it,vi} from 'vitest';
import {ReplayAudio,type PreparedReplayAudio,type ReplayAudioEvent,type ReplayAudioFrame} from './ReplayAudio';
import type {SpeechPhase} from './speech-summary';
import type {NarrationLine} from './narration';
import {savedSummaryAvailable as available,savedSummaryFixture as fixture,savedSummaryReadText as readText} from './summary-speech.test-support';
const frame:ReplayAudioFrame={cursorMs:0,active:true,enabled:true,speed:1,seek:0,cut:0,volume:.45};
const missingIds=new Set(['grf:shot:279','grf:shot:695','grf:shot:799','grf:pass:959','grf:shot:1031','grf:shot:1150','grf:shot:1241','grf:pass:1463','grf:shot:1515']);
function media(prepared:PreparedReplayAudio){
  const clips=[...prepared.clips,...prepared.presentationClips??[]];
  return{src:'',currentTime:0,duration:0,ended:false,volume:1,readyState:4,playing:false,
    play:vi.fn(async function(this:{playing:boolean}){this.playing=true;}),
    pause(){this.playing=false;},load(){this.duration=(clips.find(c=>c.url===this.src)?.durationMs??0)/1000;this.ended=false;this.currentTime=0;}};
}

it.skipIf(!available).each(['en','es'] as const)('schedules all nine previously omitted %s phrases despite the actual delayed snapshot',async locale=>{
  const f=await fixture(locale);
  try{
    const clips=f.prepared.clips.filter(c=>missingIds.has(c.cue.eventId));expect(clips).toHaveLength(9);
    for(const clip of clips){
      const cached=Math.floor(clip.cue.atMs/f.track.intervalMs)*f.track.intervalMs+1;
      const oldLines=f.linesAt(cached),laterLines=f.linesAt(cached+f.track.intervalMs);
      expect(oldLines.some(l=>l.source.id===clip.cue.eventId&&l.atMs===clip.cue.atMs)).toBe(false);
      expect(laterLines.some(l=>l.source.id===clip.cue.eventId&&l.atMs===clip.cue.atMs)).toBe(true);
      const audio=media(f.prepared),events:ReplayAudioEvent[]=[],controller=new ReplayAudio(audio,f.prepared,e=>events.push(e),()=>0);
      controller.update({...frame,cursorMs:cached},oldLines);
      controller.update({...frame,cursorMs:clip.cue.atMs-1},oldLines);expect(audio.play).not.toHaveBeenCalled();
      controller.update({...frame,cursorMs:clip.cue.atMs+1},oldLines);await Promise.resolve();
      expect(events).toContainEqual(expect.objectContaining({kind:'started',cueId:clip.cue.id,startLagMs:1}));
      controller.update({...frame,cursorMs:cached+f.track.intervalMs},laterLines);expect(audio.play).toHaveBeenCalledOnce();
      audio.currentTime=audio.duration;audio.ended=true;expect(controller.ended()).toBe(true);
      expect(events).toContainEqual(expect.objectContaining({cueId:clip.cue.id,audioEnded:true,audioTimeMs:clip.durationMs}));controller.dispose();
    }
  }finally{f.adapter.dispose();f.prepared.release();}
});

it.skipIf(!available).each(['en','es'] as const)('schedules all 25 %s clips over the saved 300-second montage with delayed facts and simulated media',async locale=>{
  const f=await fixture(locale);
  const proposal=JSON.parse(readText('../.local/speech-tp298/proposal.json'));
  const windows:readonly {fromMs:number;toMs:number}[]=proposal.replay.windows;
  expect(windows.reduce((n,w)=>n+w.toMs-w.fromMs,0)).toBe(300000);
  const audio=media(f.prepared),events:ReplayAudioEvent[]=[],controller=new ReplayAudio(audio,f.prepared,e=>events.push(e),()=>0);
  const halftime=f.periods[1].startMs;if(halftime===null)throw new Error('Missing saved halftime');
  let cut=0,cachedUntil=-1,lines:readonly NarrationLine[]=[];
  const update=async(cursorMs:number,advance=0,active=true)=>{
    if(audio.playing){audio.currentTime=Math.min(audio.duration,audio.currentTime+advance/1000);if(audio.currentTime===audio.duration){audio.ended=true;audio.playing=false;controller.ended();}}
    if(cursorMs>=cachedUntil){lines=f.linesAt(cursorMs);cachedUntil=(Math.floor(cursorMs/f.track.intervalMs)+1)*f.track.intervalMs;}
    controller.update({...frame,cursorMs,cut,active},lines);await Promise.resolve();
  };
  const present=async(phase:SpeechPhase,anchor:number)=>{
    await update(anchor,0,false);const result=controller.playPresentation(phase);await Promise.resolve();
    audio.currentTime=audio.duration;audio.ended=true;audio.playing=false;controller.ended();expect(await result).toBe('ended');
  };
  try{
    await present('opening',0);
    for(const w of windows){
      cut++;await update(w.fromMs);
      const ends:readonly number[]=w.fromMs<halftime&&halftime<w.toMs?[halftime,w.toMs]:[w.toMs];let current=w.fromMs;
      for(const end of ends){
        while(current<end){const next=Math.min(end,current+32);await update(next,next-current);current=next;}
        if(end===halftime){await present('halftime',halftime);await present('second-half',halftime);await update(halftime);}
      }
    }
    await present('fulltime',f.track.durationMs);
    const expected=[...f.prepared.clips,...f.prepared.presentationClips??[]];
    expect(events.filter(e=>e.kind==='started').map(e=>e.cueId).sort()).toEqual(expected.map(c=>c.cue.id).sort());
    expect(events.filter(e=>e.audioEnded).map(e=>e.cueId).sort()).toEqual(expected.map(c=>c.cue.id).sort());
    expect(events.filter(e=>e.kind==='skip'||e.kind==='error')).toEqual([]);
    expect(events.filter(e=>e.kind==='started').every(e=>e.startLagMs!<=e.deadlineMs!)).toBe(true);
    for(const clip of expected)expect(events.find(e=>e.cueId===clip.cue.id&&e.audioEnded)?.audioTimeMs).toBeCloseTo(clip.durationMs,5);
    let playing:string|undefined;
    for(const e of events){if(e.kind==='play'){expect(playing).toBeUndefined();playing=e.cueId;}else if(e.kind==='stop'&&e.cueId===playing)playing=undefined;}
    expect(playing).toBeUndefined();
  }finally{controller.dispose();f.adapter.dispose();f.prepared.release();}
},20000);
