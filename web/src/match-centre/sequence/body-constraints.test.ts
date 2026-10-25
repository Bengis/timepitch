import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { privateSequence } from './private-fixture';
import { createDiagnosticBodyGeometry } from './body-geometry';
import { classifyContacts } from './contact-semantics';
import { prepareBodyConstraints } from './body-constraints';
import type { SequenceSource } from './types';
let s:SequenceSource;beforeEach(async()=>{s=(await privateSequence()).source;});afterEach(()=>vi.unstubAllGlobals());
const prepare=()=>prepareBodyConstraints(s,classifyContacts(s),createDiagnosticBodyGeometry());
it('event_point_is_not_an_exact_pelvis_and_all_26_markers_remain_bound',()=>{
  const p=prepare();expect(p.actors).toHaveLength(22);
  expect(p.constraints.filter(c=>c.provenance==='recorded_snapshot')).toHaveLength(26);
  expect(p.excludedSnapshots).toHaveLength(1);
  expect(p.excludedSnapshots[0]).toMatchObject({actorId:'historical:statsbomb:3957',reason:'simultaneous_event_position_conflict'});
  const events=p.constraints.filter(c=>c.provenance==='recorded_event');expect(events).toHaveLength(17);
  expect(events.every(c=>c.region.radiusM>0)).toBe(true);
});
it('block_unknown_surface_and_right_hand_save_target_ball_not_keeper_origin',()=>{
  const p=prepare();expect(p.contacts).toHaveLength(7);
  const save=p.contacts.find(c=>c.observation.role==='save')!,block=p.contacts.find(c=>c.observation.role==='block')!;
  expect(save.surface).toBe('rightHand');expect(save.ball.x).not.toBe(save.observation.sourcePoint!.x);
  const shot=s.events.find(e=>e.id==='historical:9a0921e9-2ef6-42fd-9eed-52bc7ac69a4d')!;
  expect(Math.hypot(shot.end!.x-save.observation.sourcePoint!.x,shot.end!.y-save.observation.sourcePoint!.y)).toBeCloseTo(1.0521555,6);
  expect(block.observation.effector).toBe('unknownSurface');expect(block.surfaceProvenance).toBe('illustrative_unknown_surface');
  expect(p.contacts.some(c=>c.observation.role==='no_touch'||c.observation.role==='shot_context')).toBe(false);
});
it('fixed_entry_full_domain_and_short_receipt_header_nodes_not_merged',()=>{
  const p=prepare();expect(p.actors.length).toBeGreaterThan(0);
  for(const a of p.actors){expect(a.nodes[0].atMs).toBe(1684024);expect(a.nodes.at(-1)!.atMs).toBe(1697850);expect(a.constraints[0].provenance).toBe('synthetic_entry');expect(a.constraints[0].region.radiusM).toBe(0);}
  const times=p.actors.find(a=>a.actorId==='historical:statsbomb:20521')!.nodes.map(n=>n.atMs);
  expect(times).toContain(1693494);expect(times).toContain(1693655);
});
it('changed_observations_cannot_reuse_an_unchanged_semantic_key',()=>{
  const semantics=classifyContacts(s),changed={...semantics,observations:semantics.observations.map(o=>o.role==='save'?{...o,physicalContactRequired:false}:o)};
  expect(prepareBodyConstraints(s,changed,createDiagnosticBodyGeometry()).issues)
    .toContainEqual(expect.objectContaining({code:'invalid_semantic_binding'}));
});
it('duplicate_exit_identity_cannot_produce_a_partial_actor_set',()=>{
  const changed={...s,frames:s.frames.map(f=>f.clock_ms===s.request.toMs?{...f,players:[f.players[0],f.players[0],...f.players.slice(2)]}:f)};
  expect(prepareBodyConstraints(changed,classifyContacts(changed),createDiagnosticBodyGeometry()).issues)
    .toContainEqual(expect.objectContaining({code:'invalid_body_boundary'}));
});
