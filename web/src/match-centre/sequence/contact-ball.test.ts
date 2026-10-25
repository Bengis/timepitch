import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { privateSequence } from './private-fixture';
import { createDiagnosticBodyGeometry } from './body-geometry';
import { compileContactBall } from './contact-ball';
import type { SequenceSource } from './types';
let source:SequenceSource;beforeEach(async()=>{source=(await privateSequence()).source;});afterEach(()=>vi.unstubAllGlobals());
it('ball_xy_anchors_aliases_and_cuts_unchanged',()=>{
  const p=compileContactBall(source,createDiagnosticBodyGeometry());
  expect(p.anchors).toHaveLength(8);expect(p.aliases).toHaveLength(5);
  for(const a of p.anchors){const e=source.events.find(e=>e.id===a.eventId)!;expect(a.start).toEqual(e.start);expect(a.end).toEqual(e.end);expect(a.sourceEndMs).toBe(e.elapsedMs+e.durationMs!);}
  const cut={id:'contract-cut',fromMs:1693000,toMs:1693100,entityIds:['ball'],reason:'unknown source gap',refs:['cut']};
  const c=compileContactBall({...source,cuts:[...source.cuts,cut]},createDiagnosticBodyGeometry());
  expect(c.sample(1693050)).toBeNull();expect(c.sample(1693200)).not.toBeNull();
});
it('unverified_height_never_becomes_metres',()=>{
  const p=compileContactBall(source,createDiagnosticBodyGeometry());
  expect(p.rawHeights).toEqual(source.performanceEvidence!.actions.filter(a=>a.shot).map(a=>({eventId:a.eventId,value:a.shot!.rawEndHeight,unit:'unverified'})));
  expect(p.sample(1693655)).not.toHaveProperty('z');
});
it('carry_ball_not_permanently_pelvis_and_no_goal_flight_extension',()=>{
  const p=compileContactBall(source,createDiagnosticBodyGeometry()),carry=p.anchors.find(a=>a.kind==='Carry')!;
  expect(p.anchors.length).toBeGreaterThan(0);
  expect(p.sample(carry.fromMs)).toEqual(carry.start);
  expect(p.sample((carry.fromMs+carry.presentationEndMs)/2)).not.toBeNull();
  expect(p.anchors.at(-1)!.sourceEndMs).toBeCloseTo(1697850.325,6);
  expect(p.sample(1697850)).not.toBeNull();expect(p.sample(1697850.1)).toBeNull();
});
