import type { BodyGeometry } from './contact-types';
export function createDiagnosticBodyGeometry():BodyGeometry {
  return validateBodyGeometry({version:'diagnostic-body-1',key:'unvalidated',revision:'authored-metric-1',units:'metres-radians',ballRadiusM:.11,
    provenance:'Authored diagnostic proxy. Link lengths/offsets from unscaled three-art.ts; finite limits, capsules and templates authored before solving. Not measured anatomy.',
    joints:{upperArm:.27,forearm:.25,thigh:.43,shin:.43,shoulderY:.31,shoulderZ:1.48,hipY:.13,pelvisZ:.91,headZ:1.83},
    jointLimits:{bodyPitch:[-.45,.45],bodyRoll:[-Math.PI/2,Math.PI/2],headPitch:[-.6,.6],
      leftArmPitch:[-Math.PI,Math.PI],rightArmPitch:[-Math.PI,Math.PI],leftArmSpread:[-Math.PI/2,Math.PI/2],rightArmSpread:[-Math.PI/2,Math.PI/2],
      leftElbow:[0,2.6],rightElbow:[0,2.6],leftHip:[-1.2,1.2],rightHip:[-1.2,1.2],leftKnee:[0,2.5],rightKnee:[0,2.5]},
    bodyVolumes:{trunk:.25,head:.18,upperArm:.075,forearm:.065,thigh:.10,shin:.09,foot:.05,hand:.07},
    localisationPolicy:{revision:'trunk-and-planted-feet-1',components:['trunk','support_feet'],diveProjection:'trunk_ground_projection',airborneProjection:null},
    actionTemplates:{idle:{supportMode:'grounded',supportingFeet:['leftFoot','rightFoot'],angles:{},illustrative:true},
      leftFoot:{supportMode:'grounded',supportingFeet:['rightFoot'],angles:{leftHip:.35,leftKnee:.7},illustrative:true},
      rightFoot:{supportMode:'grounded',supportingFeet:['leftFoot'],angles:{rightHip:.35,rightKnee:.7},illustrative:true},
      header:{supportMode:'grounded',supportingFeet:['leftFoot','rightFoot'],angles:{},illustrative:true},
      rightHandSave:{supportMode:'dive',supportingFeet:[],angles:{bodyRoll:Math.PI/2,rightArmPitch:Math.PI},illustrative:true},
      leftHandSave:{supportMode:'dive',supportingFeet:[],angles:{bodyRoll:-Math.PI/2,leftArmPitch:Math.PI},illustrative:true}}});
}
const validated=new WeakSet<object>();
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const angleNames=['bodyPitch','bodyRoll','headPitch','leftArmPitch','rightArmPitch','leftArmSpread','rightArmSpread',
  'leftElbow','rightElbow','leftHip','rightHip','leftKnee','rightKnee'];
const lengths=['upperArm','forearm','thigh','shin','shoulderY','shoulderZ','hipY','pelvisZ','headZ'];
const radii=['trunk','head','upperArm','forearm','thigh','shin','foot','hand'];
function freeze<T>(v:T):T {if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
export function validateBodyGeometry(value:unknown):BodyGeometry {
  if(value&&typeof value==='object'&&validated.has(value))return value as BodyGeometry;
  const g=object(value),j=object(g.joints),limits=object(g.jointLimits),volumes=object(g.bodyVolumes),policy=object(g.localisationPolicy),templates=object(g.actionTemplates);
  const bad=()=>{throw new Error('Invalid finite diagnostic body manifest');};
  if(g.version!=='diagnostic-body-1'||g.units!=='metres-radians'||typeof g.revision!=='string'||!g.revision
    ||typeof g.provenance!=='string'||!g.provenance||!finite(g.ballRadiusM)||g.ballRadiusM<=0||g.ballRadiusM>.15)bad();
  if(lengths.some(k=>!finite(j[k])||j[k]<=0||j[k]>3)||Object.keys(j).length!==lengths.length)bad();
  if(radii.some(k=>!finite(volumes[k])||volumes[k]<=0||volumes[k]>.35)||Object.keys(volumes).length!==radii.length)bad();
  if(Object.keys(limits).length!==angleNames.length||angleNames.some(k=>{
    const range=limits[k];return !Array.isArray(range)||range.length!==2||!range.every(finite)||range[0]>0||range[1]<0||range[0]>=range[1]||range.some(v=>Math.abs(v)>Math.PI);
  }))bad();
  if(policy.revision!=='trunk-and-planted-feet-1'||JSON.stringify(policy.components)!=='["trunk","support_feet"]'
    ||policy.diveProjection!=='trunk_ground_projection'||policy.airborneProjection!==null)bad();
  for(const name of ['idle','leftFoot','rightFoot','header','rightHandSave','leftHandSave']){
    const t=object(templates[name]),angles=object(t.angles);
    if(t.illustrative!==true||t.angles===null||typeof t.angles!=='object'||Array.isArray(t.angles)
      ||!['grounded','dive'].includes(String(t.supportMode))||!Array.isArray(t.supportingFeet)
      ||new Set(t.supportingFeet).size!==t.supportingFeet.length||t.supportingFeet.some(f=>!['leftFoot','rightFoot'].includes(String(f)))
      ||t.supportMode==='dive'&&t.supportingFeet.length!==0||t.supportMode==='grounded'&&t.supportingFeet.length===0
      ||Object.entries(angles).some(([k,v])=>!angleNames.includes(k)||!finite(v)||v<(limits[k] as number[])[0]||v>(limits[k] as number[])[1]))bad();
  }
  if(object(templates.rightHandSave).supportMode!=='dive'||object(templates.leftHandSave).supportMode!=='dive'
    ||Number(object(object(templates.rightHandSave).angles).bodyRoll)!==Math.PI/2
    ||Number(object(object(templates.leftHandSave).angles).bodyRoll)!==-Math.PI/2)bad();
  const {key:_oldKey,...content}=g;
  const owned=JSON.parse(JSON.stringify(content));
  const result=freeze({...owned,key:JSON.stringify(content)}) as BodyGeometry;
  validated.add(result);return result;
}
