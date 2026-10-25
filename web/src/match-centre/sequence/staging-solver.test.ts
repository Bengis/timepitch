import { expect, it } from 'vitest';
import { solveStagingActor } from './staging-solver';
import type { StagingConstraint } from './performance-types';

it('proves an acceleration conflict even after allowing the full contact disk',()=>{
  const nodes:StagingConstraint[]=[
    {actorId:'montero',atMs:1692171,point:{x:7.7,y:56.865},radiusM:.65,provenance:'recorded_action_envelope',refs:['cross']},
    {actorId:'montero',atMs:1693655,point:{x:2.1875,y:53.295},radiusM:0,provenance:'recorded_snapshot',refs:['header-snapshot']},
    {actorId:'montero',atMs:1695068,point:{x:4.725,y:54.655},radiusM:0,provenance:'recorded_snapshot',refs:['blocked-shot-snapshot']},
  ];
  const solved=solveStagingActor('montero',nodes,{atMs:1697850,target:{x:5,y:55}});
  expect(solved.spans).toEqual([]);expect(solved.report.status).toBe('constraint_conflict');
  expect(solved.report.iterations).toBe(0);expect(solved.report.analyticCertificate).toBeTruthy();
  expect(solved.report.reachabilityWitness).toMatchObject({fromMs:1692171,viaMs:1693655,toMs:1695068,
    minRequiredAcceleration:expect.closeTo(4.1562179572325295,9),limit:4});
});
