import { afterEach,expect,it,vi } from 'vitest';
import * as curves from './curves';
import { projectRootActor,isRefinedRootStopSatisfied } from './root-projection';
import type { RootProjectionInput,RootProjectionPolicy,RootResidualFamilies } from './root-projection';
import { RootWorkLedger } from './root-feasibility';
import { inspectSpan } from './curves';
afterEach(()=>vi.restoreAllMocks());
vi.mock('./root-diagnostic',()=>{throw new Error('Full saved diagnostic forbidden in projection unit tests');});

// Hand-derived reversal: acceleration -a, velocities [a*h,0,-a*h],
// roots [50,50+a*h*h/2,50]. No saved whole-clip solve in this file.
function reversal(a=3.9999995,h=1):RootProjectionInput {
  const points=[{x:50,y:34},{x:50+a*h*h/2,y:34},{x:50,y:34}];
  const nodes=points.map((root,i)=>({atMs:i*h*1000,pose:{root,heading:0,angles:{},supportMode:'grounded' as const,supportingFeet:['leftFoot','rightFoot'] as const}}));
  return {actorId:'fixture',fromMs:0,toMs:2*h*1000,entry:points[0],exitPrior:points[2],nodes,
    constraints:points.map((p,i)=>({atMs:nodes[i].atMs,provenance:'fixed-test-point',region:{kind:'capsule' as const,id:String(i),a:p,b:p,radiusM:0}})),postCheckReserve:0};
}
it('physical_boundary_fixture_distinguishes_inner_target_from_physical_cap',()=>{
  const old=projectRootActor(reversal(),new RootWorkLedger(),'legacy-inner-1');
  const physical=projectRootActor(reversal(),new RootWorkLedger(),'physical-1');
  expect(old.status).toBe('not_converged');expect(old).not.toHaveProperty('track');
  expect(physical.status).toBe('proposed');
  expect(physical.searchTargets).toEqual({speedMps:9,accelerationMps2:4});
  expect(old.searchTargets).toEqual({speedMps:9-1e-6,accelerationMps2:4-1e-6});
  expect(physical.physicalLimits).toEqual({speedMps:9,accelerationMps2:4});
  expect(old.metrics.targetMaxResidual).toBeGreaterThan(1e-7);
  expect(old.metrics.physicalMaxResidual).toBeLessThan(old.metrics.targetMaxResidual!);
  if(physical.status==='proposed')for(const span of physical.track.spans)expect(inspectSpan(span).reasons).toEqual([]);
});
it('saved_cahill_scalar_report_is_not_a_new_vector_or_a_certificate',()=>{
  const saved={actorId:'historical:statsbomb:3645',maxResidual:1.5269325814480397e-7,maxChange:5.5330378372645476e-11};
  expect(3.999999+saved.maxResidual).toBeLessThan(4);
  const r=projectRootActor(saved as unknown as RootProjectionInput,new RootWorkLedger(),'physical-1');
  expect(r.status).toBe('invalid_input');expect(r).not.toHaveProperty('track');
});
it('physical_curve_violation_is_rejected_even_when_iteration_residual_is_small',()=>{
  const r=projectRootActor(reversal(4+5e-8),new RootWorkLedger(),'physical-1');
  expect(r.status).toBe('not_converged');expect(r.reason).toBe('root_curve_postcheck');
  expect(r.metrics.targetMaxResidual).toBeLessThanOrEqual(1e-7);
  expect(r.metrics.physicalMaxResidual).toBeGreaterThan(1e-8);expect(r).not.toHaveProperty('track');
});
it('original_unit_residual_and_step_limits_survive_time_and_variable_scales',()=>{
  const scales=new Set<number>();
  for(const h of [.1,.161,.5,1])for(const a of [1,3.5]){
    const r=projectRootActor(reversal(a,h),new RootWorkLedger(),'physical-1');
    if(a===1)expect(r.status).toBe('proposed');
    if(r.status==='not_converged'){
      expect(r.reason).toBe('root_curve_postcheck');expect(r).not.toHaveProperty('track');
      expect(r.metrics.physicalMaxResidual).toBeGreaterThan(1e-8);
    }else expect(r.status).toBe('proposed');
    expect(r.report.maxResidual).toBeLessThanOrEqual(1e-7);
    expect(r.report.maxChange).toBeLessThanOrEqual(1e-9);scales.add(r.report.positionScaleM);
    expect(r.metrics.targetMaxResidual).toBe(r.report.maxResidual);
    expect(r.metrics.physicalMaxResidual).toBeCloseTo(r.metrics.targetMaxResidual!,10);
  }
  expect(scales.size).toBeGreaterThan(1);
});
it('shared_ledger_reserves_verification_and_later_checks_without_reset',()=>{
  const ledger=new RootWorkLedger();ledger.charge('preparation',10);
  const r=projectRootActor({...reversal(0),postCheckReserve:20},ledger,'physical-1');
  expect(r.status).toBe('proposed');expect(ledger.byStage.preparation).toBe(10);
  expect(ledger.byStage.verification).toBe(1);expect(r.report.sweepsUsed).toBe(ledger.consumed);
  expect(ledger.cap-ledger.consumed).toBeGreaterThanOrEqual(20);
  const full=new RootWorkLedger();full.charge('fk',9999);
  const exhausted=projectRootActor(reversal(0),full,'physical-1');
  expect(exhausted.status).toBe('exhausted');expect(exhausted).not.toHaveProperty('track');
  expect(full.consumed).toBe(9999);
});
it('failed_vector_is_bounded_diagnostic_metadata_and_never_a_track',()=>{
  const r=projectRootActor(reversal(),new RootWorkLedger(),'legacy-inner-1');
  expect(r.status).toBe('not_converged');expect(r).not.toHaveProperty('track');
  expect(r.diagnostics.finalNodes).toHaveLength(3);
  expect(r.diagnostics.lastSweeps).toHaveLength(8);
  expect(r.diagnostics.finalNodes![0].velocity.x).toBeTypeOf('number');
  expect(r.diagnostics.lastSweeps.at(-1)!.maxChange).toBe(r.report.maxChange);
});
it('bounded_convex_polygon_bindings_use_the_shared_projection_core',()=>{
  const a=reversal(0),point={x:50,y:34};
  const constraints=[a.constraints[0],{atMs:1000,provenance:'polygon-test',region:{kind:'polygon' as const,
    vertices:[{x:49,y:33},{x:51,y:33},{x:51,y:35},{x:49,y:35}]}},
    {atMs:2000,provenance:'capsule-test',region:{kind:'capsule' as const,id:'end',a:point,b:{x:51,y:34},radiusM:.1}}];
  const r=projectRootActor({...a,constraints},new RootWorkLedger(),'physical-1');expect(r.status).toBe('proposed');
});
it('unsupported_policy_and_oversized_reserve_fail_without_spending',()=>{
  const l=new RootWorkLedger();
  expect(projectRootActor(reversal(),l,'foreign' as RootProjectionPolicy).status).toBe('invalid_input');
  expect(projectRootActor({...reversal(),postCheckReserve:-1},l,'physical-1').status).toBe('invalid_input');
  expect(l.consumed).toBe(0);
});
it('speed_projection_target_is_separate_from_the_physical_nine_limit',()=>{
  const a=reversal(0),end={x:59-5e-7,y:34};
  const input:RootProjectionInput={...a,toMs:1000,exitPrior:end,nodes:[a.nodes[0],{...a.nodes[1],pose:{...a.nodes[1].pose,root:end}}],
    constraints:[a.constraints[0],{atMs:1000,provenance:'fixed-end',region:{kind:'capsule',id:'end',a:end,b:end,radiusM:0}}]};
  expect(projectRootActor(input,new RootWorkLedger(),'legacy-inner-1').status).toBe('not_converged');
  const physical=projectRootActor(input,new RootWorkLedger(),'physical-1');expect(physical.status).toBe('proposed');
  if(physical.status==='proposed')expect(inspectSpan(physical.track.spans[0]).maxSpeed).toBeLessThan(9);
});
it('uncertain_capsule_projection_cannot_silently_drop_a_region',()=>{
  const a=reversal(0),constraints=[...a.constraints.slice(0,2),{atMs:2000,provenance:'far-capsule',
    region:{kind:'capsule' as const,id:'huge',a:{x:1e170,y:1e170},b:{x:1e170+1e154,y:1e170-1e154},radiusM:0}}];
  const ledger=new RootWorkLedger(),r=projectRootActor({...a,constraints},ledger,'physical-1');
  expect(r.status).toBe('invalid_input');expect(r).not.toHaveProperty('track');expect(ledger.consumed).toBe(0);
});
it('old_policy_toy_corpus_remains_byte_identical',async()=>{
  const cryptoName='node:crypto';
  const crypto=await import(/* @vite-ignore */ cryptoName) as {createHash:(n:string)=>{update:(s:string)=>{digest:(e:string)=>string}}};
  const fingerprints=(['legacy-inner-1','physical-1'] as const).map(policy=>{
    const results=[0,3.9999995,4+5e-8].flatMap(a=>[.161,1].map(h=>projectRootActor(reversal(a,h),new RootWorkLedger(),policy)));
    return {policy,sha256:crypto.createHash('sha256').update(JSON.stringify(results)).digest('hex')};
  });
  expect(fingerprints).toEqual([
    {policy:'legacy-inner-1',sha256:'55a7d29cf6dfd46c12609711b946bc9de326e2c9528d10f937b3455b93a7465e'},
    {policy:'physical-1',sha256:'085dda4c881bd916484137123cb551c858480e94d7a0ddff6339d42ba4ba0cc4'},
  ]);
});
const REFINED:RootProjectionPolicy='physical-refined-1';
const families=(patch:Partial<RootResidualFamilies>={}):RootResidualFamilies=>({speedMps:0,accelerationMps2:0,fieldM:0,bindingM:0,...patch});
it('refined_family_gate_is_stricter_than_the_physical_postcheck_without_changing_binding_tolerance',()=>{
  expect(isRefinedRootStopSatisfied(families({accelerationMps2:5e-8}),1e-10)).toBe(false);
  expect(isRefinedRootStopSatisfied(families({speedMps:5e-8}),1e-10)).toBe(false);
  expect(isRefinedRootStopSatisfied(families({fieldM:5e-8}),1e-10)).toBe(false);
  expect(isRefinedRootStopSatisfied(families({bindingM:2e-7}),0)).toBe(false);
  expect(isRefinedRootStopSatisfied(families({accelerationMps2:5e-10,bindingM:5e-8}),5e-10)).toBe(true);
  expect(isRefinedRootStopSatisfied(families({speedMps:1e-9,accelerationMps2:1e-9,fieldM:1e-9,bindingM:1e-7}),1e-9)).toBe(true);
});
it('refined_family_gate_fails_closed_on_invalid_values_and_does_not_accept_a_large_step',()=>{
  for(const value of [NaN,Infinity,-1])for(const name of ['speedMps','accelerationMps2','fieldM','bindingM'] as const)
    expect(isRefinedRootStopSatisfied(families({[name]:value}),0)).toBe(false);
  for(const change of [NaN,Infinity,-1,2e-9])expect(isRefinedRootStopSatisfied(families(),change)).toBe(false);
  for(const value of [null,{}, {speedMps:0}])expect(isRefinedRootStopSatisfied(value as RootResidualFamilies,0)).toBe(false);
});
it('refined_policy_does_not_promote_an_infeasible_boundary_from_a_small_scalar_residual',()=>{
  const ledger=new RootWorkLedger(),result=projectRootActor(reversal(4+5e-8),ledger,REFINED);
  expect(result.status).toBe('not_converged');expect(result).not.toHaveProperty('track');expect(result.reason).toBe('iteration_limit');
  expect(result.searchTargets).toEqual({speedMps:9,accelerationMps2:4});
  expect(result.diagnostics.residualFamilies!.accelerationMps2).toBeGreaterThan(1e-9);
  expect(result.report.witnesses.some(w=>w.kind.startsWith('acceleration_')&&w.residual>1e-9)).toBe(true);
  expect(result.diagnostics.curveCheckStatus).toBe('not_run');expect(result.diagnostics.curveIssues).toEqual([]);
  expect(ledger.byStage.verification).toBeUndefined();expect(ledger.consumed).toBeLessThanOrEqual(9999);
});
it('refined_binding_residual_keeps_its_units_even_with_kinematic_provenance',()=>{
  const base=reversal(0);
  const regions=[
    {kind:'capsule' as const,id:'binding',a:{x:50+5e-8,y:33},b:{x:50+5e-8,y:35},radiusM:0},
    {kind:'polygon' as const,vertices:[{x:50+5e-8,y:33},{x:51,y:33},{x:51,y:35},{x:50+5e-8,y:35}]},
  ];
  for(const region of regions){
    const input={...base,constraints:[...base.constraints,{atMs:0,provenance:'acceleration_start',region}]};
    const result=projectRootActor(input,new RootWorkLedger(),REFINED);
    expect(result.status,result.reason).toBe('proposed');expect(result.report.solverSweeps).toBe(1);
    expect(result.diagnostics.residualFamilies!.bindingM).toBeCloseTo(5e-8,13);
    expect(result.diagnostics.residualFamilies!.accelerationMps2).toBe(0);
    expect(result.diagnostics.residualFamilies!.fieldM).toBe(0);expect(result.diagnostics.curveCheckStatus).toBe('passed');
  }
});
it('refined_controlled_curves_pass_actual_span_checks_at_multiple_time_scales',()=>{
  for(const h of [.1,.161,.5,1]){
    const result=projectRootActor(reversal(1,h),new RootWorkLedger(),REFINED);
    expect(result.status,result.reason).toBe('proposed');expect(result.diagnostics.curveCheckStatus).toBe('passed');expect(result.diagnostics.curveIssues).toEqual([]);
    expect(isRefinedRootStopSatisfied(result.diagnostics.residualFamilies!,result.report.maxChange!)).toBe(true);
    if(result.status==='proposed')for(const span of result.track.spans)expect(inspectSpan(span).reasons).toEqual([]);
  }
  const base=reversal(.5),nodes=base.nodes.map((n,i)=>({...n,pose:{...n.pose,root:{...n.pose.root,y:n.pose.root.y+i*.1}}}));
  const input={...base,nodes,exitPrior:nodes.at(-1)!.pose.root,constraints:base.constraints.map((c,i)=>({...c,
    region:{kind:'capsule' as const,id:String(i),a:nodes[i].pose.root,b:nodes[i].pose.root,radiusM:0}}))};
  const turn=projectRootActor(input,new RootWorkLedger(),REFINED);expect(turn.status,turn.reason).toBe('proposed');
  if(turn.status==='proposed')for(const span of turn.track.spans)expect(inspectSpan(span).reasons).toEqual([]);
});
it('refined_rejection_retains_exact_bounded_curve_reasons_and_never_resumes_after_postcheck',()=>{
  const proof={maxSpeed:9.01,maxAcceleration:4.02,reasons:['speed_limit','acceleration_limit']};
  const checker=vi.spyOn(curves,'inspectSpan').mockReturnValue(proof),base=reversal(0),ledger=new RootWorkLedger();ledger.charge('preparation',7);
  const input={...base,toMs:63000,postCheckReserve:20,nodes:Array.from({length:64},(_,i)=>({...base.nodes[0],atMs:i*1000})),constraints:[base.constraints[0]]};
  const result=projectRootActor(input,ledger,REFINED);expect(result.status).toBe('not_converged');expect(result.reason).toBe('root_curve_postcheck');expect(result).not.toHaveProperty('track');
  expect(result.diagnostics.curveCheckStatus).toBe('failed');expect(result.diagnostics.curveIssues).toHaveLength(63);expect(checker).toHaveBeenCalledTimes(63);
  expect(result.diagnostics.curveIssues![0]).toEqual({fromMs:0,toMs:1000,...proof});
  expect(result.report.solverSweeps).toBe(1);expect(ledger.consumed).toBe(9);expect(ledger.byStage).toEqual({preparation:7,solver:1,verification:1});
  expect(result.diagnostics.finalNodes).toHaveLength(64);expect(result.diagnostics.lastSweeps).toHaveLength(1);
});
it('refined_policy_preserves_shared_reserve_and_reports_missing_work_without_false_zero_metrics',()=>{
  const ledger=new RootWorkLedger();ledger.charge('preparation',10);
  const result=projectRootActor({...reversal(0),postCheckReserve:20},ledger,REFINED);
  expect(result.status).toBe('proposed');expect(ledger.byStage).toEqual({preparation:10,solver:1,verification:1});expect(result.report.sweepsUsed).toBe(ledger.consumed);
  const full=new RootWorkLedger();full.charge('fk',9999);const exhausted=projectRootActor(reversal(0),full,REFINED);
  expect(exhausted.status).toBe('exhausted');expect(exhausted).not.toHaveProperty('track');expect(full.consumed).toBe(9999);
  expect(exhausted.diagnostics.residualFamilies).toBeNull();expect(exhausted.diagnostics.curveCheckStatus).toBe('not_run');
});
