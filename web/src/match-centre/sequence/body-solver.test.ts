import { expect,it } from 'vitest';
import { createDiagnosticBodyGeometry } from './body-geometry';
import { solveBodyConstraints } from './body-solver';
import type { BodyActorInput,PreparedBodyConstraints } from './contact-types';
function actor():BodyActorInput {
  const pose={root:{x:10,y:10},heading:0,angles:{},supportMode:'grounded' as const,supportingFeet:['leftFoot','rightFoot'] as const};
  return {actorId:'a',fromMs:0,toMs:1000,entry:pose.root,exitPrior:{x:11,y:10},nodes:[{atMs:0,pose},{atMs:1000,pose:{...pose,root:{x:11,y:10}}}],
    constraints:[{actorId:'a',atMs:0,region:{id:'entry',a:pose.root,b:pose.root,radiusM:0},sourcePoint:pose.root,eventId:null,refs:['entry'],provenance:'synthetic_entry'}],budget:{maxNodes:64,maxSweeps:10000,sweepsUsed:2}};
}
function prepared(a=actor()):PreparedBodyConstraints{return {key:'fixture',sourceKey:'fixture',semanticKey:'fixture',geometry:createDiagnosticBodyGeometry(),fromMs:0,toMs:1000,actors:[a],constraints:a.constraints,contacts:[],aliases:[],excludedSnapshots:[],issues:[],ball:null as any};}
it('fixed_variable_elimination_preserves_feasible_set_and_original_units',()=>{
  const a=actor(),p=prepared({...a,constraints:[...a.constraints,{...a.constraints[0],refs:['duplicate']}]});
  const r=solveBodyConstraints(p);expect(r.status).toBe('proposed');
  expect(r.reports[0].fixedPositionCount).toBe(1);expect(r.reports[0].maxResidual).toBeLessThanOrEqual(1e-7);
  expect(r.reports[0].maxChange).toBeLessThanOrEqual(1e-9);
  expect(r.reports[0].velocityScaleMps).not.toBe(r.reports[0].positionScaleM);
  expect(r.tracks[0].spans[0].x[0]).toBeCloseTo(10,10);
});
it('sweeps_and_nodes_do_not_reset_between_subsolves',()=>{
  const a=actor(),r=solveBodyConstraints(prepared({...a,budget:{...a.budget,sweepsUsed:10000}}));
  expect(r.status).toBe('unavailable');expect(r.tracks).toEqual([]);
  expect(r.reports[0]).toMatchObject({status:'not_converged',sweepsUsed:10000,solverSweeps:0});
});
it('conflicting_fixed_nodes_do_not_expose_failed_iterates',()=>{
  const a=actor(),bad={...a.constraints[0],region:{...a.constraints[0].region,a:{x:20,y:10},b:{x:20,y:10}}};
  const r=solveBodyConstraints(prepared({...a,constraints:[...a.constraints,bad]}));
  expect(r.status).toBe('unavailable');expect(r.tracks).toEqual([]);expect(r.issues.length).toBeGreaterThan(0);
});
it('legacy_reports_and_coefficients_are_frozen_before_projection_extraction',()=>{
  const a=actor(),bad={...a.constraints[0],region:{...a.constraints[0].region,a:{x:20,y:10},b:{x:20,y:10}}};
  expect([
    solveBodyConstraints(prepared(a)),
    solveBodyConstraints(prepared({...a,budget:{...a.budget,sweepsUsed:10000}})),
    solveBodyConstraints(prepared({...a,constraints:[...a.constraints,bad]})),
  ]).toMatchInlineSnapshot(`
    [
      {
        "issues": [],
        "reports": [
          {
            "actorId": "a",
            "fixedPositionCount": 1,
            "maxChange": 0,
            "maxResidual": 0,
            "nodes": 2,
            "positionScaleM": 4.5,
            "solverSweeps": 1,
            "status": "proposed",
            "sweepsUsed": 4,
            "velocityScaleMps": 9,
            "witnesses": [],
          },
        ],
        "status": "proposed",
        "tracks": [
          {
            "actorId": "a",
            "poseNodes": [
              {
                "atMs": 0,
                "pose": {
                  "angles": {},
                  "heading": 0,
                  "root": {
                    "x": 10,
                    "y": 10,
                  },
                  "supportMode": "grounded",
                  "supportingFeet": [
                    "leftFoot",
                    "rightFoot",
                  ],
                },
              },
              {
                "atMs": 1000,
                "pose": {
                  "angles": {},
                  "heading": 0,
                  "root": {
                    "x": 11,
                    "y": 10,
                  },
                  "supportMode": "grounded",
                  "supportingFeet": [
                    "leftFoot",
                    "rightFoot",
                  ],
                },
              },
            ],
            "spans": [
              {
                "fromMs": 0,
                "refs": [],
                "toMs": 1000,
                "x": [
                  10,
                  1,
                  0,
                  0,
                ],
                "y": [
                  10,
                  0,
                  0,
                  0,
                ],
              },
            ],
          },
        ],
      },
      {
        "issues": [
          {
            "actorId": "a",
            "atMs": null,
            "code": "iteration_limit",
            "detail": "[]",
            "eventId": null,
            "refs": [],
          },
        ],
        "reports": [
          {
            "actorId": "a",
            "fixedPositionCount": 0,
            "maxChange": null,
            "maxResidual": null,
            "nodes": 2,
            "positionScaleM": 4.5,
            "solverSweeps": 0,
            "status": "not_converged",
            "sweepsUsed": 10000,
            "velocityScaleMps": 9,
            "witnesses": [],
          },
        ],
        "status": "unavailable",
        "tracks": [],
      },
      {
        "issues": [
          {
            "actorId": "a",
            "atMs": null,
            "code": "conflicting_fixed_nodes",
            "detail": "[]",
            "eventId": null,
            "refs": [],
          },
        ],
        "reports": [
          {
            "actorId": "a",
            "fixedPositionCount": 1,
            "maxChange": null,
            "maxResidual": null,
            "nodes": 2,
            "positionScaleM": 4.5,
            "solverSweeps": 0,
            "status": "invalid_input",
            "sweepsUsed": 2,
            "velocityScaleMps": 9,
            "witnesses": [],
          },
        ],
        "status": "unavailable",
        "tracks": [],
      },
    ]
  `);
});
