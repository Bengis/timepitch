import { afterEach, expect, it, vi } from 'vitest';
import { compileDepiction } from './depiction';
import { sequenceFocus } from './focus';
import { privateSequence, rawView } from './private-fixture';

afterEach(()=>vi.unstubAllGlobals());
it('same_cursor_has_same_focus_after_backwards_seek',async()=>{
  const {source}=await privateSequence(),d=compileDepiction(source);
  const focus=sequenceFocus(d,1687000,null,false);expect(focus).not.toBeNull();
  sequenceFocus(d,1697300,null,false);sequenceFocus(d,1684500,null,false);
  expect(sequenceFocus(d,1687000,null,false)).toEqual(focus);
  const key='historical:statsbomb:7063',selected=sequenceFocus(d,1687000,key,false);
  const actor=d.sample(1687000,rawView(source,1687000)).frame!.players.find(p=>p.key===key)!;
  expect(selected).toEqual({x:actor.x,y:actor.y});
  expect(sequenceFocus(d,1687000,key,true)).toBeNull();
  expect(sequenceFocus(d,1697851,null,false)).toBeNull();
  expect(sequenceFocus(d,1687000,'foreign',false)).toBeNull();
  const other=source.frames[0].players.find(p=>!source.events.some(e=>e.actorId===p.key))!;
  const same=d.sample(1687000,rawView(source,1687000)).frame!.players.find(p=>p.key===other.key)!;
  expect(sequenceFocus(d,1687000,other.key,false)).toEqual({x:same.x,y:same.y});
});
it('holds the last valid action focus for at most a second, then blends a valid return in cursor time',async()=>{
  const {source}=await privateSequence(),start=source.request.fromMs,base=source.events[0];
  const events=[{...base,id:'historical:a',elapsedMs:start,periodMs:start,kind:'Pass',durationMs:100,start:{x:40,y:30},end:{x:41,y:30}},
    {...base,id:'historical:b',sourceIndex:base.sourceIndex+1,elapsedMs:start+2500,periodMs:start+2500,kind:'Pass',durationMs:100,start:{x:45,y:30},end:{x:46,y:30}},
    {...base,id:'historical:c',sourceIndex:base.sourceIndex+2,elapsedMs:start+3100,periodMs:start+3100,kind:'Pass',durationMs:500,start:{x:48,y:30},end:{x:50,y:30}}];
  const d=compileDepiction({...source,events,cuts:[{id:'restart1',fromMs:start+100,toMs:start+2500,entityIds:'all',reason:'restart',refs:[]},
    {id:'restart2',fromMs:start+2600,toMs:start+3100,entityIds:'all',reason:'restart',refs:[]}]});
  expect(sequenceFocus(d,start+600,null,false)).toEqual({x:41,y:30});
  expect(sequenceFocus(d,start+1200,null,false)).toBeNull();
  const atStart=sequenceFocus(d,start+3100,null,false),middle=sequenceFocus(d,start+3200,null,false),later=sequenceFocus(d,start+3300,null,false);
  expect(atStart).toEqual({x:46,y:30});expect(middle!.x).toBeCloseTo(47.2);expect(later!.x).toBeCloseTo(48.8);
});

it('uses certified V2 roots for focus without changing selected background players or reduced-motion policy',async()=>{
  const {source}=await privateSequence(),d=compileDepiction(source,'historical-action-preview-2'),t=1693550,key='historical:statsbomb:20521';
  expect(d.version).toBe('historical-action-preview-2');
  const frame=d.sample(t,rawView(source,t)).frame!,p=frame.players.find(p=>p.key===key)!;
  expect(sequenceFocus(d,t,key,false)).toEqual({x:p.x,y:p.y});
  const initial=sequenceFocus(d,t,null,false);expect(initial).not.toBeNull();sequenceFocus(d,1697116,null,false);sequenceFocus(d,1684500,null,false);
  expect(sequenceFocus(d,t,null,false)).toEqual(initial);expect(sequenceFocus(d,t,key,true)).toBeNull();
  const background=frame.players.find(p=>!source.events.some(e=>e.actorId===p.key))!;
  expect(sequenceFocus(d,t,background.key,false)).toEqual({x:background.x,y:background.y});
  expect(sequenceFocus(d,1697850.325,key,false)).toBeNull();
});

it('does not fall back to raw focus for an actor excluded during V2 preparation',async()=>{
  const {source}=await privateSequence(),key='historical:statsbomb:3347';
  const changed={...source,events:source.events.map(e=>e.actorId===key&&e.kind==='Ball Recovery'&&e.elapsedMs===1694593?{...e,start:{x:-1,y:20}}:e)};
  const d=compileDepiction(changed,'historical-action-preview-2');
  expect(d.version).toBe('historical-action-preview-2');
  expect(d.issues.some(i=>i.entityId===key&&i.reason==='invalid_anchor')).toBe(true);
  expect(sequenceFocus(d,1694800,key,false)).toBeNull();expect(sequenceFocus(d,1687000,key,false)).toBeNull();
});
