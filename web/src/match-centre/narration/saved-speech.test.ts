import {expect,it,vi} from 'vitest';
import {loadSavedSpeechAudio} from './saved-speech';
import {makeSpeechCue,speechPreset,type SpeechIdentity} from './azure-cues';
import {sha256Hex} from '../adapters/recorded-bytes';
import type {NarrationLine} from './narration';
import sealed from './fixtures/saved-canary.json';
const fsModule='node:fs';
const {existsSync,readFileSync}=await import(/* @vite-ignore */ fsModule) as {existsSync:(p:string)=>boolean;readFileSync:(p:string)=>Uint8Array<ArrayBuffer>};

const source=sealed.source as SpeechIdentity;
const sample='../.local/speech-tp291-run/02-en-excited.mp3';
const hasAudio=existsSync(sample);
async function fixture(){
  const line={id:'goal:grf:goal:0',source:{id:'grf:goal:0'},atMs:409500,text:sealed.items[0].cue.text,kind:'goal'} as NarrationLine;
  const cue=await makeSpeechCue(line,source,speechPreset('en-goal'),{fromMs:395500,toMs:417500});
  const bytes=hasAudio?new Uint8Array(readFileSync(sample)):new Uint8Array(256);
  const manifest={version:'saved-speech-preview-1',kind:'azure-canary',source,items:[{cue,asset:{...sealed.items[0].asset}}]};
  const fetcher=vi.fn(async(url:string)=>url.endsWith('.json')?new Response(JSON.stringify(manifest)):new Response(bytes,{headers:{'Content-Type':'audio/mpeg'}}));
  const config={manifestUrl:'/speech-preview/manifest.json',expectedSource:source};const revoke=vi.fn();
  const load=()=>loadSavedSpeechAudio(config,'en',new AbortController().signal,fetcher,()=> 'blob:verified',revoke);
  return{line,cue,bytes,manifest,fetcher,config,revoke,load};
}
it.skipIf(!hasAudio)('loads verified MP3 into a distinct native-deadline provider, never test tones',async()=>{
  const f=await fixture(),p=await f.load();expect(p.timing).toBe('native-deadline');expect(p.clips[0].durationMs).toBe(7704);
  expect(await sha256Hex(f.bytes)).toBe(sealed.items[0].asset.sha256);p.release();expect(f.revoke).toHaveBeenCalledWith('blob:verified');
});
it('rejects wrong source, cue, format, external URL or corrupted bytes without fallback',async()=>{
  for(const change of [(f:Awaited<ReturnType<typeof fixture>>)=>{f.manifest.source={...source,seed:44};},
    (f:Awaited<ReturnType<typeof fixture>>)=>{f.manifest.items[0].cue.text='Different fact';},
    (f:Awaited<ReturnType<typeof fixture>>)=>{f.manifest.items[0].asset.file='https://example.com/audio.mp3';},
    (f:Awaited<ReturnType<typeof fixture>>)=>{f.bytes[40]=1;},
    (f:Awaited<ReturnType<typeof fixture>>)=>{f.manifest.items[0].asset.bitRate=96000;}]){
    const f=await fixture();change(f);await expect(f.load()).rejects.toThrow();
  }
});
it('rejects a self-consistent new narrator/text bound to the old canary bytes',async()=>{
  const original=sealed.items[0],newSource={...sealed.source,narratorVersion:'new-narrator'} as SpeechIdentity;
  const cue=await makeSpeechCue({id:'goal:grf:goal:0',source:{id:original.cue.eventId},kind:'goal',atMs:original.cue.atMs,text:'A different goal.'} as NarrationLine,
    newSource,speechPreset('en-goal'),original.cue.binding.window);
  const manifest={...sealed,source:newSource,items:[{...original,cue}]};
  let binaryRequested=false;
  const fetcher=async(url:string)=>{if(url.endsWith('.json'))return new Response(JSON.stringify(manifest));binaryRequested=true;return new Response(hasAudio?new Uint8Array(readFileSync(sample)):new Uint8Array(256),{headers:{'Content-Type':'audio/mpeg'}});};
  await expect(loadSavedSpeechAudio({manifestUrl:'/speech-preview/manifest.json',expectedSource:manifest.source as SpeechIdentity},'en',new AbortController().signal,fetcher)).rejects.toThrow(/canary binding/i);
  expect(binaryRequested).toBe(false);
});
it('keeps missing or aborted MP3 loads unavailable without creating an audio URL',async()=>{
  const f=await fixture(),url=vi.fn(),controller=new AbortController();
  const missing=async(path:string)=>path.endsWith('.json')?new Response(JSON.stringify(f.manifest)):new Response('',{status:404});
  await expect(loadSavedSpeechAudio(f.config,'en',controller.signal,missing,url)).rejects.toThrow(/unavailable/i);
  const aborted=async(path:string)=>{if(path.endsWith('.json'))return new Response(JSON.stringify(f.manifest));controller.abort();return new Response(f.bytes,{headers:{'Content-Type':'audio/mpeg'}});};
  await expect(loadSavedSpeechAudio(f.config,'en',controller.signal,aborted,url)).rejects.toThrow();expect(url).not.toHaveBeenCalled();
});
