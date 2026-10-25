import { expect,it } from 'vitest';
import { createDiagnosticBodyGeometry,validateBodyGeometry } from './body-geometry';

it('missing_manifest_and_infinite_reach_are_unavailable',()=>{
  expect(()=>validateBodyGeometry({})).toThrow();
  const g=createDiagnosticBodyGeometry();
  expect(()=>validateBodyGeometry({...g,ballRadiusM:Infinity})).toThrow();
  expect(()=>validateBodyGeometry({...g,joints:{...g.joints,upperArm:Infinity}})).toThrow();
  const limits={...g.jointLimits} as any;delete limits.leftKnee;
  expect(()=>validateBodyGeometry({...g,jointLimits:limits})).toThrow();
});
it('arms_and_pick_volumes_cannot_expand_localisation',()=>{
  const g=createDiagnosticBodyGeometry();
  expect(()=>validateBodyGeometry({...g,localisationPolicy:{...g.localisationPolicy,components:['trunk','arms','pick-volume']}})).toThrow();
});
it('geometry_revision_changes_key_and_owns_its_finite_assumptions',async()=>{
  const g=createDiagnosticBodyGeometry(),raw=JSON.parse(JSON.stringify(g));
  const changed=validateBodyGeometry({...raw,revision:'diagnostic-test-2'});
  expect(changed.key).not.toBe(g.key);
  expect(changed.ballRadiusM).toBe(.11);
  expect(Object.isFrozen(raw.joints)).toBe(false);
  expect(Object.isFrozen(changed.jointLimits.leftHip)).toBe(true);
  const env=(globalThis as typeof globalThis&{process?:{env:Record<string,string|undefined>}}).process?.env;
  if(env?.TIMEPITCH_BODY_GEOMETRY_RECEIPT){
    const fsName='node:fs';const fs=await import(/* @vite-ignore */ fsName) as {writeFileSync:(p:string,t:string)=>void};
    fs.writeFileSync(env.TIMEPITCH_BODY_GEOMETRY_RECEIPT,JSON.stringify({case:'TP161',kind:'authored_diagnostic_geometry_before_solve',geometry:g,nativeMatches:0,modelCalls:0,published:false},null,2)+'\n');
  }
});
it('rejects_missing_joint_parameters_and_a_dive_template_with_no_body_roll',()=>{
  const g=createDiagnosticBodyGeometry();
  for(const template of [{...g.actionTemplates.header,angles:null},{...g.actionTemplates.rightHandSave,angles:{}}]){
    const name=template.supportMode==='dive'?'rightHandSave':'header';
    expect(()=>validateBodyGeometry({...g,actionTemplates:{...g.actionTemplates,[name]:template}})).toThrow();
  }
});
