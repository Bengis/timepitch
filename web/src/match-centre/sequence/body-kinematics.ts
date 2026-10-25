import { validateBodyGeometry } from './body-geometry';
import type { BodyGeometry,BodyPoseInput,BodyGeometrySample,MetricPoint,MetricCapsule,GroundCapsule } from './contact-types';
const add=(a:MetricPoint,b:MetricPoint):MetricPoint=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const pitch=(v:MetricPoint,a:number):MetricPoint=>({x:v.x*Math.cos(a)-v.z*Math.sin(a),y:v.y,z:v.x*Math.sin(a)+v.z*Math.cos(a)});
const roll=(v:MetricPoint,a:number):MetricPoint=>({x:v.x,y:v.y*Math.cos(a)-v.z*Math.sin(a),z:v.y*Math.sin(a)+v.z*Math.cos(a)});
export function sampleBodyGeometry(geometry:BodyGeometry,input:BodyPoseInput):BodyGeometrySample {
  const fail=(reason:string):BodyGeometrySample=>({status:'unsupported',reason});
  let g:BodyGeometry;try{g=validateBodyGeometry(geometry);}catch{return fail('invalid_geometry');}
  if(input.supportMode==='airborne')return fail('unsupported_airborne_projection');
  if(!['grounded','dive'].includes(input.supportMode)||![input.root.x,input.root.y,input.heading].every(Number.isFinite)
    ||new Set(input.supportingFeet).size!==input.supportingFeet.length
    ||input.supportingFeet.some(f=>f!=='leftFoot'&&f!=='rightFoot')
    ||input.supportMode==='grounded'&&input.supportingFeet.length===0||input.supportMode==='dive'&&input.supportingFeet.length!==0)return fail('invalid_pose');
  if(Object.entries(input.angles).some(([k,v])=>!g.jointLimits[k as keyof typeof g.jointLimits]||!Number.isFinite(v)
    ||v!<g.jointLimits[k as keyof typeof g.jointLimits][0]||v!>g.jointLimits[k as keyof typeof g.jointLimits][1]))return fail('joint_limit');
  const angle=(name:keyof typeof g.jointLimits)=>input.angles[name]??0,j=g.joints;
  const local:Record<string,MetricPoint>={pelvis:{x:0,y:0,z:j.pelvisZ},shoulders:{x:0,y:0,z:j.shoulderZ},
    head:add({x:0,y:0,z:j.shoulderZ},pitch({x:0,y:0,z:j.headZ-j.shoulderZ},angle('headPitch')))};
  for(const [side,sign] of [['left',1],['right',-1]] as const){
    const shoulder=local[side+'Shoulder']={x:0,y:sign*j.shoulderY,z:j.shoulderZ};
    const armPitch=angle(`${side}ArmPitch`),spread=angle(`${side}ArmSpread`),elbow=angle(`${side}Elbow`);
    const upper=pitch(roll({x:0,y:0,z:-j.upperArm},spread),armPitch);
    const arm=local[side+'Elbow']=add(shoulder,upper);
    local[side+'Hand']=add(arm,pitch(roll({x:0,y:0,z:-j.forearm},spread),armPitch-elbow));
    const hip=local[side+'Hip']={x:0,y:sign*j.hipY,z:j.pelvisZ},hipAngle=angle(`${side}Hip`);
    const knee=local[side+'Knee']=add(hip,pitch({x:0,y:0,z:-j.thigh},hipAngle));
    local[side+'Ankle']=add(knee,pitch({x:0,y:0,z:-j.shin},hipAngle-angle(`${side}Knee`)));
    local[side+'Heel']=add(local[side+'Ankle'],{x:-.06,y:0,z:0});
    local[side+'Toe']=add(local[side+'Ankle'],{x:.12,y:0,z:0});
  }
  const world=(p:MetricPoint):MetricPoint=>{
    const v=pitch(roll({x:p.x,y:p.y,z:p.z-j.pelvisZ},angle('bodyRoll')),angle('bodyPitch'));
    return {x:input.root.x+v.x*Math.cos(input.heading)-v.y*Math.sin(input.heading),
      y:input.root.y+v.x*Math.sin(input.heading)+v.y*Math.cos(input.heading),z:v.z+j.pelvisZ};
  };
  const joints=Object.fromEntries(Object.entries(local).map(([id,p])=>[id,world(p)]));
  const capsule=(id:string,a:string,b:string,radiusM:number):MetricCapsule=>({id,a:joints[a],b:joints[b],radiusM});
  const v=g.bodyVolumes,volumes:MetricCapsule[]=[capsule('trunk','pelvis','shoulders',v.trunk),capsule('head','head','head',v.head)];
  for(const side of ['left','right'])volumes.push(capsule(side+'UpperArm',side+'Shoulder',side+'Elbow',v.upperArm),
    capsule(side+'Forearm',side+'Elbow',side+'Hand',v.forearm),capsule(side+'Thigh',side+'Hip',side+'Knee',v.thigh),
    capsule(side+'Shin',side+'Knee',side+'Ankle',v.shin),capsule(side+'Foot',side+'Heel',side+'Toe',v.foot),capsule(side+'Hand',side+'Hand',side+'Hand',v.hand));
  const effectors={leftFoot:volumes.find(c=>c.id==='leftFoot')!,rightFoot:volumes.find(c=>c.id==='rightFoot')!,
    leftHand:volumes.find(c=>c.id==='leftHand')!,rightHand:volumes.find(c=>c.id==='rightHand')!,head:volumes[1]};
  for(const foot of input.supportingFeet){const c=effectors[foot];if(Math.max(Math.abs(c.a.z-c.radiusM),Math.abs(c.b.z-c.radiusM))>.03)return fail('unplanted_support_foot');}
  const ground=(c:MetricCapsule):GroundCapsule=>({id:c.id,a:{x:c.a.x,y:c.a.y},b:{x:c.b.x,y:c.b.y},radiusM:c.radiusM});
  const footprint=[ground(volumes[0]),...input.supportingFeet.map(f=>ground(effectors[f]))];
  return {status:'available',pose:{root:{...input.root},heading:input.heading,angles:{...input.angles},supportMode:input.supportMode,
    supportingFeet:[...input.supportingFeet],joints,illustrative:true},effectors,footprint,volumes};
}
