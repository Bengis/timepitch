import { expect,it } from 'vitest';
import { createDiagnosticBodyGeometry } from './body-geometry';
import { sampleBodyGeometry } from './body-kinematics';
import type { BodyGeometrySample,BodyPoseInput } from './contact-types';
const standing:BodyPoseInput={root:{x:50,y:30},heading:0,angles:{},supportMode:'grounded',supportingFeet:['leftFoot','rightFoot']};
function available(s:BodyGeometrySample){expect(s.status).toBe('available');if(s.status!=='available')throw new Error(s.reason);return s;}
it('display_scale_does_not_change_metric_reach',()=>{
  const g=createDiagnosticBodyGeometry();
  const a=available(sampleBodyGeometry(g,{...standing,visualScale:1} as BodyPoseInput));
  expect(sampleBodyGeometry(g,{...standing,visualScale:1.35} as BodyPoseInput)).toEqual(a);
  expect(a.effectors.head.a.z).toBeCloseTo(1.83,10);
});
it('known_hand_and_head_map_to_distinct_surfaces',()=>{
  const s=available(sampleBodyGeometry(createDiagnosticBodyGeometry(),standing));
  expect(s.effectors.rightHand.a).toEqual({x:50,y:29.69,z:expect.closeTo(.96,10)});
  expect(s.effectors.head.a).toEqual({x:50,y:30,z:expect.closeTo(1.83,10)});
  expect(s.footprint.map(c=>c.id)).toEqual(['trunk','leftFoot','rightFoot']);
  expect(s.volumes.length).toBeGreaterThan(10);
});
it('unsupported_airborne_projection_rejects',()=>{
  expect(sampleBodyGeometry(createDiagnosticBodyGeometry(),{...standing,supportMode:'airborne',supportingFeet:[]}))
    .toMatchObject({status:'unsupported',reason:'unsupported_airborne_projection'});
});
it('dive_has_explicit_trunk_projection_not_a_standing_save',()=>{
  const g=createDiagnosticBodyGeometry(),template=g.actionTemplates.rightHandSave;
  const s=available(sampleBodyGeometry(g,{root:standing.root,heading:0,...template}));
  expect(s.footprint.map(c=>c.id)).toEqual(['trunk']);
  expect(s.pose.angles.bodyRoll).toBeCloseTo(Math.PI/2,12);
  expect(s.effectors.rightHand.a.y).toBeLessThan(29);
});
it('rejects_out_of_range_angles_and_a_false_planted_foot',()=>{
  const g=createDiagnosticBodyGeometry();
  expect(sampleBodyGeometry(g,{...standing,angles:{leftElbow:10}}).status).toBe('unsupported');
  expect(sampleBodyGeometry(g,{...standing,angles:{leftHip:.8,leftKnee:.8}}).status).toBe('unsupported');
});
