import {expect,it} from 'vitest';
import {createTimePitchSession} from './timepitch';
import {createGrfSession} from './grf';
import {sampleInterval} from '../sampling';
import type {MatchRecord,GrfReplay} from '../../api';
const input=(globalThis as typeof globalThis & {process?:{env:Record<string,string|undefined>}}).process?.env.TIMEPITCH_UNIFIED_ACCEPTANCE_DIR;
// Private accepted records only; browser bundles never contain these files.
it.runIf(Boolean(input))('real saved source frame boundaries have an independent raw-record oracle',async()=>{
 const moduleName='node:fs';const fs=await import(/* @vite-ignore */ moduleName) as {readFileSync:(p:string,e:'utf8')=>string};
 const read=(file:string)=>JSON.parse(fs.readFileSync(`${input}/${file}`,'utf8')),auth=read('browser-auth.json');
 const digest=(v:unknown)=>JSON.stringify(v);
 for(const item of Object.values(auth.saved) as {id:string;engine:string;schema:string}[]){
  const entry=(read('integrity-private.json').selected as {engine:string;schema:string;file:string}[]).find(e=>e.engine===item.engine&&e.schema===item.schema)!;
  const raw=read(`inputs/${entry.file}`),before=digest(raw);
  const adapter=item.engine==='timepitch'?createTimePitchSession(item.id,raw as MatchRecord):createGrfSession(item.id,raw as GrfReplay);
  try{
   if(item.engine==='timepitch'&&raw.format_version!==2){
    const times=[0,...raw.events.filter((e:{type:string})=>['goal','halftime','fulltime'].includes(e.type)).map((e:{t1_ms:number})=>e.t1_ms)];
    for(const ms of times){const frame=sampleInterval(adapter.resolveFrame(ms).interval!,ms),expected=raw.events.filter((e:{t1_ms:number})=>e.t1_ms<=ms).at(-1)?.frame_after??raw.initial_frame;expect(frame.score).toEqual(expected.score);expect(frame.ball).toEqual(expected.ball);expect(frame.period).toBe(expected.period);}
   }else if(item.engine==='timepitch'){
    for(const index of [0,1,Math.floor(raw.motion.length/2),raw.motion.length-1]){
     const ms=raw.motion[index][0],s=raw.motion.filter((v:number[])=>v[0]<=ms).at(-1),frame=sampleInterval(adapter.resolveFrame(ms).interval!,ms);
     expect(frame.score).toEqual({home:s[2],away:s[3]});expect(frame.period).toBe(s[1]);expect(frame.ball).toEqual({x:s[8]/1000,y:s[9]/1000});
     expect(frame.players.map(p=>[p.x,p.y])).toEqual(raw.initial_frame.players.map((_:unknown,i:number)=>[s[10][2*i]/1000,s[10][2*i+1]/1000]));
    }
   }else{
    for(const index of [0,1,Math.floor(raw.samples.length/2),raw.samples.length-1]){
     const s=raw.samples[index],frame=sampleInterval(adapter.resolveFrame(index*100).interval!,index*100);expect(frame.score).toEqual({home:s.score[0],away:s.score[1]});
     expect(frame.ball).toEqual({x:(s.ball_xyz[0]+1)*52.5,y:(s.ball_xyz[1]+.42)*68/.84});
     const active=raw.input.players.filter((p:{side:string;slot:number})=>!s.home_active||(p.side==='home'?s.home_active[p.slot]:s.away_active[p.slot])!==false);
     expect(frame.players.map(p=>p.key)).toEqual(active.map((p:{id:string})=>'grf:'+p.id));
     for(const p of active){const xy=(p.side==='home'?s.home_xy:s.away_xy)[p.slot],actual=frame.players.find(v=>v.key==='grf:'+p.id)!;expect(actual.x).toBeCloseTo((xy[0]+1)*52.5,10);expect(actual.y).toBeCloseTo((xy[1]+.42)*68/.84,10);}
    }
   }
  }finally{adapter.dispose();}expect(digest(raw)).toBe(before);
 }
});
