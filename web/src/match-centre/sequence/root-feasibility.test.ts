import { expect,it } from 'vitest';
import { inspectRootFeasibility,RootWorkLedger,rootIntervalMath } from './root-feasibility';
import type { RootFeasibilityInput,RootRegion } from './root-feasibility';

// Literal extracted TP162 regions, no solver/source compiler or generated trajectory.
const saved = {
  "Montero": {
    "actorId": "historical:statsbomb:7063",
    "regions": [
      {
        "id": "0",
        "actorId": "historical:statsbomb:7063",
        "atMs": 1692171,
        "region": {
          "kind": "capsule",
          "id": "effector-target",
          "a": {
            "x": 7.726011200155036,
            "y": 56.860543795135335
          },
          "b": {
            "x": 7.726011200155036,
            "y": 56.860543795135335
          },
          "radiusM": 0.08
        },
        "refs": [
          "d1d446ec-f47c-4809-9f73-f2c5b2b4d881"
        ],
        "provenance": "contact_surface",
        "policyKey": "saved-fixed-pose-1"
      },
      {
        "id": "1",
        "actorId": "historical:statsbomb:7063",
        "atMs": 1693655,
        "region": {
          "kind": "capsule",
          "id": "trunk",
          "a": {
            "x": 2.1875,
            "y": 53.295
          },
          "b": {
            "x": 2.1875,
            "y": 53.295
          },
          "radiusM": 0.25
        },
        "refs": [
          "9a0921e9-2ef6-42fd-9eed-52bc7ac69a4d"
        ],
        "provenance": "recorded_snapshot",
        "policyKey": "saved-fixed-pose-1"
      },
      {
        "id": "2",
        "actorId": "historical:statsbomb:7063",
        "atMs": 1695068,
        "region": {
          "kind": "capsule",
          "id": "trunk",
          "a": {
            "x": 4.724999999999994,
            "y": 54.655
          },
          "b": {
            "x": 4.724999999999994,
            "y": 54.655
          },
          "radiusM": 0.25
        },
        "refs": [
          "43aa4774-0851-4e64-a1b8-2ed198f8d75f"
        ],
        "provenance": "recorded_snapshot",
        "policyKey": "saved-fixed-pose-1"
      }
    ]
  },
  "Gomis": {
    "actorId": "historical:statsbomb:20521",
    "regions": [
      {
        "id": "0",
        "actorId": "historical:statsbomb:20521",
        "atMs": 1693494,
        "region": {
          "kind": "capsule",
          "id": "trunk",
          "a": {
            "x": 9.1875,
            "y": 30.854999999999997
          },
          "b": {
            "x": 9.1875,
            "y": 30.854999999999997
          },
          "radiusM": 0.25
        },
        "refs": [
          "ca6118f6-10dd-4997-a6a1-86a5fa71c707"
        ],
        "provenance": "recorded_event",
        "policyKey": "saved-fixed-pose-1"
      },
      {
        "id": "1",
        "actorId": "historical:statsbomb:20521",
        "atMs": 1693655,
        "region": {
          "kind": "capsule",
          "id": "effector-target",
          "a": {
            "x": 8.400000000000006,
            "y": 31.450000000000003
          },
          "b": {
            "x": 8.400000000000006,
            "y": 31.450000000000003
          },
          "radiusM": 0.08
        },
        "refs": [
          "9a0921e9-2ef6-42fd-9eed-52bc7ac69a4d"
        ],
        "provenance": "contact_surface",
        "policyKey": "saved-fixed-pose-1"
      },
      {
        "id": "2",
        "actorId": "historical:statsbomb:20521",
        "atMs": 1695068,
        "region": {
          "kind": "capsule",
          "id": "trunk",
          "a": {
            "x": 6.5625,
            "y": 27.795
          },
          "b": {
            "x": 6.5625,
            "y": 27.795
          },
          "radiusM": 0.25
        },
        "refs": [
          "43aa4774-0851-4e64-a1b8-2ed198f8d75f"
        ],
        "provenance": "recorded_snapshot",
        "policyKey": "saved-fixed-pose-1"
      }
    ]
  },
  "Cahill": {
    "actorId": "historical:statsbomb:3645",
    "regions": [
      {
        "id": "0",
        "actorId": "historical:statsbomb:3645",
        "atMs": 1693655,
        "region": {
          "kind": "capsule",
          "id": "trunk",
          "a": {
            "x": 4.200000000000003,
            "y": 41.989999999999995
          },
          "b": {
            "x": 4.200000000000003,
            "y": 41.989999999999995
          },
          "radiusM": 0.25
        },
        "refs": [
          "9a0921e9-2ef6-42fd-9eed-52bc7ac69a4d"
        ],
        "provenance": "recorded_snapshot",
        "policyKey": "saved-fixed-pose-1"
      },
      {
        "id": "1",
        "actorId": "historical:statsbomb:3645",
        "atMs": 1695068,
        "region": {
          "kind": "capsule",
          "id": "trunk",
          "a": {
            "x": 3.1500000000000057,
            "y": 36.04
          },
          "b": {
            "x": 3.1500000000000057,
            "y": 36.04
          },
          "radiusM": 0.25
        },
        "refs": [
          "43aa4774-0851-4e64-a1b8-2ed198f8d75f"
        ],
        "provenance": "recorded_snapshot",
        "policyKey": "saved-fixed-pose-1"
      },
      {
        "id": "2",
        "actorId": "historical:statsbomb:3645",
        "atMs": 1695328,
        "region": {
          "kind": "capsule",
          "id": "effector-target",
          "a": {
            "x": 3.857237276543838,
            "y": 35.504918647541245
          },
          "b": {
            "x": 3.857237276543838,
            "y": 35.504918647541245
          },
          "radiusM": 0.08
        },
        "refs": [
          "36556d53-6eaa-49da-95fb-78015de01fa2"
        ],
        "provenance": "contact_surface",
        "policyKey": "saved-fixed-pose-1"
      }
    ]
  }
} as const;


function input(name:keyof typeof saved):RootFeasibilityInput {
  return {actorId:saved[name].actorId,domainKey:'saved-fixed-pose-1',scope:'TP162 fixed-pose root regions only',
    physicalAccelerationMps2:4,regions:saved[name].regions};
}
function circle(x:number,y=0,r=0):RootRegion {
  return {kind:'capsule',id:'disk',a:{x,y},b:{x,y},radiusM:r};
}
function fixture(regions:readonly RootRegion[],times=regions.map((_,i)=>i*1000)):RootFeasibilityInput {
  return {actorId:'a',domainKey:'fixture-1',scope:'test subset only',physicalAccelerationMps2:4,
    regions:regions.map((region,i)=>({id:String(i),actorId:'a',atMs:times[i],region,refs:[`source-${i}`],provenance:'test',policyKey:'fixture-1'}))};
}
function inspect(value:RootFeasibilityInput){return inspectRootFeasibility(value,new RootWorkLedger());}
it('montero_fixed_branch_requires_above_four',()=>{
  const result=inspect(input('Montero'));
  expect(result.status).toBe('necessary_conflict');
  expect(result.witness!.accelerationLowerBoundMps2).toBeGreaterThanOrEqual(4.0700);
  expect(result.witness!.accelerationLowerBoundMps2).toBeLessThan(4.070044);
  expect(result.witness!.timesMs).toEqual([1692171,1693655,1695068]);
});
it('gomis_receipt_header_branch_requires_above_six',()=>{
  const result=inspect(input('Gomis'));
  expect(result.status).toBe('necessary_conflict');
  expect(result.witness!.accelerationLowerBoundMps2).toBeGreaterThanOrEqual(6.2934);
  expect(result.witness!.accelerationLowerBoundMps2).toBeLessThan(6.293451);
});
it('cahill_is_not_excluded_not_feasible',()=>{
  const result=inspect(input('Cahill'));
  expect(result.status).toBe('not_excluded');expect(result.witness!.accelerationLowerBoundMps2).toBeLessThan(4);
  expect(result).not.toHaveProperty('tracks');expect(result).not.toHaveProperty('feasible');
});
it('straight_line_is_not_excluded_and_reversal_has_hand_derived_bound',()=>{
  expect(inspect(fixture([circle(0),circle(2),circle(4)])).status).toBe('not_excluded');
  const reversal=inspect(fixture([circle(0),circle(3),circle(0)]));
  expect(reversal.status).toBe('necessary_conflict');
  expect(reversal.witness!.accelerationLowerBoundMps2).toBeCloseTo(6,10);
});
it('capsule_support_includes_segment_and_radius_not_only_centres',()=>{
  const wide=fixture([circle(0,0,3),circle(3,0,3),circle(0,0,3)]);
  expect(inspect(wide).status).toBe('not_excluded');
  const segment:RootRegion={kind:'capsule',id:'segment',a:{x:0,y:0},b:{x:6,y:0},radiusM:0};
  expect(inspect(fixture([circle(0),segment,circle(0)])).status).toBe('not_excluded');
});
it('convex_polygon_support_is_equivalent_to_bounding_square_support_on_axes',()=>{
  const square=(x:number):RootRegion=>({kind:'polygon',vertices:[{x:x-.1,y:-.1},{x:x+.1,y:-.1},{x:x+.1,y:.1},{x:x-.1,y:.1}]});
  const r=inspect(fixture([square(0),square(3),square(0)]));
  expect(r.status).toBe('necessary_conflict');expect(r.witness!.accelerationLowerBoundMps2).toBeCloseTo(5.6,10);
});
it('four_boundary_and_one_ulp_neighbour_are_inconclusive_not_conflicts',()=>{
  for(const b of [2,2+Number.EPSILON*2])expect(inspect(fixture([circle(0),circle(b),circle(0)])).status).toBe('not_excluded');
  expect(inspect(fixture([circle(0),circle(2.000001),circle(0)])).status).toBe('necessary_conflict');
});
it('same_time_bindings_remain_separate_and_can_supply_a_later_witness',()=>{
  const v=fixture([circle(0),circle(0,0,10),circle(3),circle(0)],[0,1000,1000,2000]);
  const ledger=new RootWorkLedger();const result=inspectRootFeasibility(v,ledger);
  expect(result.status).toBe('necessary_conflict');expect(result.inspectedTriples).toBe(2);
  expect(result.witness!.bindingIds).toEqual(['0','2','3']);expect(ledger.consumed).toBe(2);
});
it('duplicate_binding_ids_and_unordered_times_are_invalid_not_merged',()=>{
  const v=fixture([circle(0),circle(3),circle(0)]);
  expect(inspect({...v,regions:[v.regions[1],v.regions[0],v.regions[2]]}).status).toBe('invalid_input');
  expect(inspect({...v,regions:[v.regions[0],{...v.regions[1],id:'0'},v.regions[2]]}).status).toBe('invalid_input');
});
it('witness_scope_refs_and_policy_are_exact_and_foreign_binding_is_invalid',()=>{
  const v=input('Montero'),result=inspect(v);
  expect(result.domainKey).toBe(v.domainKey);expect(result.scope).toBe(v.scope);
  expect(result.witness!.domainKey).toBe(v.domainKey);expect(result.witness!.actorId).toBe(v.actorId);
  expect(result.witness!.refs).toEqual(v.regions.map(r=>r.refs));
  const changed={...v,regions:v.regions.map((r,i)=>i===1?{...r,policyKey:'foreign'}:r)};
  expect(inspect(changed).status).toBe('invalid_input');
  expect(inspect({...v,actorId:'foreign'}).status).toBe('invalid_input');
});
it('invalid_nonfinite_empty_concave_clockwise_and_over_node_inputs_fail_closed',()=>{
  const bad:RootRegion[]=[circle(0,0,-1),circle(Infinity),{kind:'polygon',vertices:[]},
    {kind:'polygon',vertices:[{x:0,y:0},{x:0,y:1},{x:1,y:0}]},
    {kind:'polygon',vertices:[{x:0,y:0},{x:2,y:0},{x:1,y:.1},{x:2,y:2},{x:0,y:2}]}];
  for(const region of bad)expect(inspect(fixture([circle(0),region,circle(0)])).status).toBe('invalid_input');
  expect(inspect(fixture(Array.from({length:65},()=>circle(0)))).status).toBe('invalid_input');
  expect(inspect({...fixture([circle(0)]),physicalAccelerationMps2:5} as unknown as RootFeasibilityInput).status).toBe('invalid_input');
});
it('shared_ledger_preserves_previous_work_and_exhaustion_never_certifies',()=>{
  const v=fixture([circle(0),circle(0,0,10),circle(3),circle(0)],[0,1000,1000,2000]);
  const ledger=new RootWorkLedger();expect(ledger.charge('fk',9999)).toBe(true);
  const result=inspectRootFeasibility(v,ledger);
  expect(result.status).toBe('exhausted');expect(result.witness).toBeUndefined();
  expect(ledger.consumed).toBe(10000);expect(ledger.byStage).toEqual({fk:9999,preflight:1});
  expect(ledger.charge('solver',1)).toBe(false);expect(ledger.charge('solver',-1)).toBe(false);
  expect(ledger.charge('solver',.5)).toBe(false);expect(ledger.charge('solver',NaN)).toBe(false);
  expect(ledger.consumed).toBe(10000);expect(ledger.cap).toBe(10000);
});
it('interval_arithmetic_encloses_cancellation_subnormals_and_division',()=>{
  const m=rootIntervalMath,p=m.point;
  const third=m.divide(p(1),p(3));expect(third.lo).toBeLessThan(1/3);expect(third.hi).toBeGreaterThan(1/3);
  const cancelled=m.subtract(m.add(p(1e16),p(1)),p(1e16));expect(cancelled.lo).toBeLessThanOrEqual(1);expect(cancelled.hi).toBeGreaterThanOrEqual(1);
  const tiny=m.multiply(p(Number.MIN_VALUE),p(.5));expect(tiny.lo).toBeLessThanOrEqual(0);expect(tiny.hi).toBeGreaterThanOrEqual(Number.MIN_VALUE);
  const norm=m.sqrt(m.add(m.multiply(p(3),p(3)),m.multiply(p(4),p(4))));expect(norm.lo).toBeLessThanOrEqual(5);expect(norm.hi).toBeGreaterThanOrEqual(5);
  expect(()=>m.divide(p(1),{lo:-1,hi:1})).toThrow();
});
it('input_and_source_regions_are_never_mutated_and_report_is_deterministic',()=>{
  const v=input('Montero'),before=JSON.stringify(v);
  expect(inspect(v)).toEqual(inspect(v));expect(JSON.stringify(v)).toBe(before);
  expect(inspect(fixture([circle(0),circle(0)])).status).toBe('not_excluded');
});
it('known_quadratic_paths_with_admissible_acceleration_are_never_excluded',()=>{
  for(const [ax,ay] of [[0,0],[2,2],[2.4,3.2],[-3.2,2.4]])for(const base of [0,1000,1e8])
    for(const times of [[0,161,1574],[1692171,1693655,1695068]]){
      const regions=times.map(ms=>{
        const t=(ms-times[0])/1000;
        return circle(base+1.2*t+.5*ax*t*t,base-2*t+.5*ay*t*t,.001);
      });
      expect(inspect(fixture(regions,times)).status).toBe('not_excluded');
    }
});
it('overflowing_support_arithmetic_remains_explicitly_inconclusive',()=>{
  const result=inspect(fixture([circle(Number.MAX_VALUE),circle(Number.MAX_VALUE),circle(Number.MAX_VALUE)]));
  expect(result.status).toBe('not_excluded');expect(result.reason).toBe('arithmetic_inconclusive');
  expect(result.inconclusiveTriples).toBe(1);
});
it('full_64_node_preflight_stops_at_the_same_10000_unit_cap',()=>{
  const ledger=new RootWorkLedger(),result=inspectRootFeasibility(fixture(Array.from({length:64},()=>circle(0))),ledger);
  expect(result.status).toBe('exhausted');expect(result.inspectedTriples).toBe(10000);
  expect(ledger.consumed).toBe(10000);expect(result.witness).toBeUndefined();
});
