import {it,expect} from 'vitest';
import {loadSummarySpeechAudio} from './summary-speech';
import sealed from './fixtures/summary-cache.json';
import type {ReplayAudioSource} from './ReplayAudio';
const fsModule='node:fs';
const {readFileSync,existsSync}=await import(/* @vite-ignore */ fsModule) as {existsSync:(p:string)=>boolean;readFileSync:{(p:string,encoding:'utf8'):string;(p:string):Uint8Array<ArrayBuffer>}};
const available=existsSync('../.local/speech-tp301/preview-manifest.json');
const manifest=available?JSON.parse(readFileSync('../.local/speech-tp301/preview-manifest.json','utf8')):null;
const source={manifestUrl:'/speech-summary-preview/manifest.json',expectedSource:sealed.source} as ReplayAudioSource;
const fetcher=async(url:string)=>url.endsWith('manifest.json')?new Response(JSON.stringify(manifest)):
  new Response(readFileSync('../.local/'+(url.includes('/parent/')?'speech-tp296-run/':'speech-tp299-run/')+url.split('/').at(-1)),{headers:{'Content-Type':'audio/mpeg'}});
it.skipIf(!available)('loads twenty-one action clips and four presentation clips per language',async()=>{
  for(const locale of ['en','es'] as const){const result=await loadSummarySpeechAudio(source,locale,new AbortController().signal,fetcher,()=> 'blob:verified',()=>{});expect(result.clips).toHaveLength(21);expect(result.presentationClips).toHaveLength(4);expect(result.clips.filter(c=>c.cue.kind==='goal'||c.cue.kind==='own_goal')).toHaveLength(7);expect(result.timing).toBe('native-deadline');expect(result.schedule).toBe('verified-cues');result.release();}
});
it.skipIf(!available)('rejects spoofed source, edited cue, reused rejected clip and MP3 corruption',async()=>{
  for(const edit of [(m:any)=>m.source.seed=99,(m:any)=>m.items[0].cue.text='False goal',(m:any)=>m.items[0].asset.receiptSha256='a'.repeat(64),(m:any)=>m.items[0].asset.durationMs=999999,(m:any)=>m.items[0].origin.artifactSha256='a'.repeat(64),(m:any)=>m.items[0].slot.clock='replay',(m:any)=>m.items[0].asset.file='/speech-summary-preview/parent/011-en-en-goal.mp3']){
    const changed=structuredClone(manifest);edit(changed);
    await expect(loadSummarySpeechAudio(source,'en',new AbortController().signal,async()=>new Response(JSON.stringify(changed)))).rejects.toThrow();
  }
  await expect(loadSummarySpeechAudio(source,'en',new AbortController().signal,async(url)=>url.endsWith('manifest.json')?new Response(JSON.stringify(manifest)):new Response('corrupt',{headers:{'Content-Type':'audio/mpeg'}}))).rejects.toThrow();
});

it.skipIf(!available)('releases every created URL after a later saved MP3 fails and honors cancellation',async()=>{
  const created:string[]=[],revoked:string[]=[];let reads=0;
  await expect(loadSummarySpeechAudio(source,'es',new AbortController().signal,async url=>{
    if(url.endsWith('manifest.json'))return fetcher(url);
    reads++;return reads===3?new Response('broken',{headers:{'Content-Type':'audio/mpeg'}}):fetcher(url);
  },()=>{const url=`blob:verified-${created.length}`;created.push(url);return url;},url=>revoked.push(url))).rejects.toThrow();
  expect(created).toHaveLength(2);expect(revoked).toEqual(created);
  const abort=new AbortController();abort.abort();let fetched=false;
  await expect(loadSummarySpeechAudio(source,'en',abort.signal,async()=>{fetched=true;return new Response();})).rejects.toThrow();expect(fetched).toBe(false);
});
