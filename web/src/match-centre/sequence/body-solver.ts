import { projectLegacyBodyActor } from './root-projection';
import type { PreparedBodyConstraints,BodySolveResult,BodySolverReport,BodyRootTrack,BodyIssue } from './contact-types';
/** One bounded solve, with eliminated fixed positions and separate position/velocity scales.
 * Norm/capsule/field predicates are evaluated in their original units. Proposed != certified.
 */
export function solveBodyConstraints(input:PreparedBodyConstraints):BodySolveResult {
  const reports:BodySolverReport[]=[],tracks:BodyRootTrack[]=[],issues:BodyIssue[]=[...input.issues];
  if(issues.length||input.actors.length===0||input.actors.length>22)return {status:'unavailable',tracks:[],reports,issues:[...issues,{code:'invalid_body_input',actorId:null,eventId:null,atMs:null,refs:[]}]};
  for(const actor of input.actors){
    const result=projectLegacyBodyActor(actor);reports.push(result.report);
    if(result.track)tracks.push(result.track);
    else issues.push({code:result.reason,actorId:actor.actorId,eventId:null,atMs:null,refs:[],detail:JSON.stringify(result.report.witnesses)});
  }
  return {status:issues.length?'unavailable':'proposed',tracks:issues.length?[]:tracks,reports,issues};
}
