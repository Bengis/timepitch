import {expect,it} from 'vitest';
import {composeSpeechSummary} from './speech-summary';
import type {EventView} from '../session';
import type {NarrationContext} from './narration';

const event=(id:string,kind:string,at:number,period=2,details:Record<string,unknown>={}):EventView=>({id,kind,elapsedMs:at,period,periodMs:0,sourceIndex:at/100,side:null,actorId:null,participantIds:[],outcome:null,provenance:'native_observed',refs:[id],details});
const periods=[{period:1,startMs:0,durationMs:2925900},{period:2,startMs:2925900,durationMs:2885800}];
const ctx:NarrationContext={locale:'en',name:()=>null,keepers:new Set(),teams:{home:'Home',away:'Away'}};
const native=[event('grf:kickoff:863','kickoff',2925800,2,{period_start:true,native:'decision:kickoff:prepared'}),
  event('grf:halftime:2','halftime',2925900),event('grf:halftime:864','halftime',2925900),
  event('grf:fulltime','fulltime',5811700),event('grf:fulltime:1597','fulltime',5811700)];

it('has one ordered opening/half/start/end with raw evidence untouched',()=>{
  const before=JSON.stringify(native),summary=composeSpeechSummary(native,periods,5811700,ctx);
  expect(summary.markers.map(m=>m.phase)).toEqual(['opening','halftime','second-half','fulltime']);
  expect(summary.markers.map(m=>m.line.atMs)).toEqual([0,2925900,2925900,5811700]);
  expect(summary.markers[1].sourceIds).toEqual(['grf:halftime:2','grf:halftime:864']);
  expect(summary.markers[2].originalTimes).toEqual([2925800]);
  expect(summary.markers[2].sourceIds).toEqual(['grf:kickoff:863']);
  expect(summary.markers[3].sourceIds).toEqual(['grf:fulltime','grf:fulltime:1597']);
  expect(JSON.stringify(native)).toBe(before);
});

it('does not call a first-half restart the opening or change non-marker narration',()=>{
  const goal={...event('goal','goal',409500,1),side:'home' as const};
  const restart={...event('restart','kickoff',420000,1,{period_start:false}),side:'away' as const};
  const summary=composeSpeechSummary([goal,restart,...native],periods,5811700,ctx);
  expect(summary.markers[0].line.atMs).toBe(0);
  expect(summary.markers[0].line.text).toContain("We're under way");
  expect(summary.markers[1].line.text).toContain('1–0');
  expect(summary.actionLines.find(l=>l.source.id==='goal')?.atMs).toBe(409500);
  expect(summary.markers[3].line.text).toContain('1–0');
});

it('rejects an ambiguous boundary goal and unsupported period anchors',()=>{
  expect(()=>composeSpeechSummary([...native,event('ambiguous','goal',2925900)],periods,5811700,ctx)).toThrow(/boundary/i);
  expect(()=>composeSpeechSummary(native,[periods[0]],5811700,ctx)).toThrow(/period/i);
});
