import { describe, expect, it } from 'vitest';
import { makeSpeechCue, prepareRecordedSpeech, speechPreset, SPEECH_FORMAT } from './azure-cues';
import type { NarrationLine } from './narration';
import { bytesOf, entryFor, eventsEntryFor, rawRecording } from '../adapters/recorded-fixtures';

const identity={replayId:'saved-grf',engine:'grf' as const,engineVersion:'recorded-1',calibration:'cal1',datasetVersion:'saved-1',seed:42,homeKey:'home',awayKey:'away',traceHash:'a'.repeat(64),recordingSha256:'b'.repeat(64),eventsSha256:null,narratorVersion:'narration-tp278-1',namesVersion:'names-1',namesMode:'fictional' as const};
const line={id:'goal:1',atMs:1000,kind:'goal',text:'A & B <GOL> "sí"',source:{id:'goal:1',elapsedMs:1000}} as NarrationLine;
const window={fromMs:0,toMs:10000};

describe('offline Azure speech preparation',()=>{
  it('escapes SSML and binds text, source, voice, timing and absent audio deterministically',async()=>{
    const a=await makeSpeechCue(line,identity,speechPreset('es-goal'),window);
    expect(a).toMatchObject({eventId:'goal:1',atMs:1000,playUntilMs:10000,maxDurationMs:8750,locale:'es',voice:'es-ES-AlvaroNeural',style:null,format:SPEECH_FORMAT,treatment:'More energetic prosody',audio:{state:'not_generated',assetSha256:null,durationMs:null}});
    expect(a.binding.preset).toMatchObject({id:'es-goal-prosody-2',rate:'+5%',pitch:'+3%'});
    expect(speechPreset('es-goal-prosody-2')).toEqual(speechPreset('es-goal'));
    expect(a.ssml).toContain('<prosody rate="+5%" pitch="+3%">');
    expect(a.ssml).not.toContain('express-as');
    expect(a.ssml).toContain('A &amp; B &lt;GOL&gt; &quot;sí&quot;');
    expect(a.ssml).not.toContain('<GOL>');expect(a.bytes).toBe(new TextEncoder().encode(a.ssml).byteLength);
    expect(a).toEqual(await makeSpeechCue(line,identity,speechPreset('es-goal'),window));
    expect(a.cacheKey).toMatch(/^[a-f0-9]{64}$/);
  });
  it('changes cache identity when source, names, text, voice, style or window changes',async()=>{
    const cue=await makeSpeechCue(line,identity,speechPreset('en-goal'),window);
    const variants=await Promise.all([
      makeSpeechCue(line,{...identity,seed:43},speechPreset('en-goal'),window),
      makeSpeechCue(line,{...identity,namesMode:'real'},speechPreset('en-goal'),window),
      makeSpeechCue(line,{...identity,eventsSha256:'c'.repeat(64)},speechPreset('en-goal'),window),
      makeSpeechCue({...line,text:'Another fact'},identity,speechPreset('en-goal'),window),
      makeSpeechCue(line,identity,speechPreset('en-neutral'),window),
      makeSpeechCue(line,identity,speechPreset('es-goal'),window),
      makeSpeechCue(line,identity,speechPreset('en-goal'),{...window,toMs:9000}),
    ]);expect(new Set([cue,...variants].map(x=>x.cacheKey)).size).toBe(8);
  });
  it('rejects arbitrary presets, XML control characters and cues outside their source window',async()=>{
    expect(()=>speechPreset('https://voice')).toThrow();
    expect(()=>speechPreset('es-excited')).toThrow();
    await expect(makeSpeechCue(line,identity,{...speechPreset('en-neutral'),voice:'https://arbitrary-voice'},window)).rejects.toThrow();
    await expect(makeSpeechCue({...line,text:'Bad\u0000'},identity,speechPreset('en-neutral'),window)).rejects.toThrow();
    for(const text of ['Bad\ufffe','Bad\uffff'])await expect(makeSpeechCue({...line,text},identity,speechPreset('en-neutral'),window)).rejects.toThrow();
    await expect(makeSpeechCue(line,identity,speechPreset('en-neutral'),{fromMs:2000,toMs:3000})).rejects.toThrow();
    await expect(makeSpeechCue(line,identity,speechPreset('en-neutral'),{fromMs:0,toMs:1100})).rejects.toThrow();
  });
  it('uses the verified reader and recorded narrator and never grants synthesis',async()=>{
    const raw=rawRecording('grf'),entry=await entryFor('grf',raw),bytes=bytesOf(raw);
    const read=async()=>bytes.slice().buffer;
    const manifest=await prepareRecordedSpeech(entry,read,{namesMode:'real'});
    expect(manifest.authorized).toBe(false);expect(manifest.synthesisRequests).toBe(0);
    expect(manifest.source.traceHash).toBe(entry.trace_hash);
    expect(manifest.pilot.cues).toHaveLength(4);expect(manifest.pilot.bytes).toBeLessThanOrEqual(4000);
    expect(manifest.pilot.cues.map(c=>c.style)).toEqual([null,'excited',null,null]);
    expect(manifest.pilot.cues.every(c=>c.eventId===manifest.pilot.cues[0].eventId)).toBe(true);
    await expect(prepareRecordedSpeech({...entry,sha256:'0'.repeat(64)},read,{namesMode:'real'})).rejects.toThrow(/SHA-256/);
  });
  it('filters events before narration when preparing an earlier cutoff, without announcing the future goal',async()=>{
    const raw=rawRecording('grf'),entry=await entryFor('grf',raw),bytes=bytesOf(raw);
    const manifest=await prepareRecordedSpeech(entry,async()=>bytes.slice().buffer,{namesMode:'real',throughMs:100});
    expect(manifest.pilot.cues).toHaveLength(0);
    expect(manifest.cues.every(c=>c.atMs<=100)).toBe(true);
    expect(manifest.cues.map(c=>c.text).join(' ')).not.toContain('1–0');
  });
  it('requires the indexed sidecar to verify instead of silently dropping its scorers',async()=>{
    const {entry,bytes}=await eventsEntryFor('grf'),replay=bytesOf(rawRecording('grf'));
    const read=async(file:string)=>file===entry.file?replay.slice().buffer:bytes.slice().buffer;
    const ready=await prepareRecordedSpeech(entry,read,{namesMode:'real'});
    expect(ready.source.eventsSha256).toBe(entry.events.sha256);
    await expect(prepareRecordedSpeech({...entry,events:{...entry.events,sha256:'0'.repeat(64)}},read,{namesMode:'real'})).rejects.toThrow(/SHA-256/);
  });
  it('treats source property order as immaterial but preserves XML Unicode and source immutability',async()=>{
    const before=JSON.stringify(identity),cue=await makeSpeechCue({...line,text:'Gol de A, 1–0 ⚽'},identity,speechPreset('es-goal'),window);
    const shuffled=Object.fromEntries(Object.entries(identity).reverse()) as typeof identity;
    expect((await makeSpeechCue({...line,text:'Gol de A, 1–0 ⚽'},shuffled,speechPreset('es-goal'),window)).cacheKey).toBe(cue.cacheKey);
    const parsed=new DOMParser().parseFromString(cue.ssml,'application/xml');expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.documentElement.textContent).toBe('Gol de A, 1–0 ⚽');expect(JSON.stringify(identity)).toBe(before);
  });
});
