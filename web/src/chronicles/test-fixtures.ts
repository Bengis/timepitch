// Hand-built HTTP/UI fixtures. No model, match generation or sporting-quality claim.
import type { components } from '../generated/api';
import type { SessionIdentity } from '../match-centre/session';
export const identity: SessionIdentity = { source:'grf',id:'fixture-grf',revision:'a'.repeat(64) };
export function status(changes:Partial<components['schemas']['AzureStatus']>={}):components['schemas']['AzureStatus'] {
  return {mode:'acceptance',worker:'unknown',generation_allowed:true,supported_engines:['grf','timepitch'],reason:null,profile:'azure-chronicle-1',...changes};
}
export function ready(source:SessionIdentity=identity,locale:'en'|'es'='en'):components['schemas']['AzureJobView'] {
  const sentence={text:locale==='en'?'Home club finished 1–0 against Away club.':'Home club terminó 1–0 ante Away club.',fact_ids:['result']};
  const goal={text:locale==='en'?'A recorded goal decided the score.':'Un gol registrado decidió el marcador.',fact_ids:['goal']};
  const coverage={text:locale==='en'?'The recorded coverage is partial.':'La cobertura registrada es parcial.',fact_ids:['coverage']};
  return {id:'saved-report',engine:source.source==='timepitch'?'timepitch':'grf',match_id:source.id,trace_hash:source.revision,locale,
    fact_hash:'b'.repeat(64),state:'ready',error:null,profile:'azure-chronicle-1',checked:{
      draft:{headline:sentence,paragraphs:[{sentences:[goal]},{sentences:[coverage]}]},
      header:{home_name:'Home club',away_name:'Away club',score:[1,0],dataset_version:'synthetic-only',scope:'final',simulated:true},
      coverage:{events_complete:false,native_clock:true,notes:['Some events omitted'],omitted_events:1},coverage_notes:['Some events omitted'],
      evidence:[{fact_ids:['result'],event_refs:[],facts:[{id:'result',kind:'result',unit:'none',availability:'measured',own_goal:false}]},
        {fact_ids:['goal'],event_refs:[source.source==='grf'?'grf:1':'goal'],facts:[{id:'goal',kind:'goal',unit:'count',availability:'measured',own_goal:false,value:1,event_refs:[source.source==='grf'?'grf:1':'goal']}]},
        {fact_ids:['coverage'],event_refs:[],facts:[{id:'coverage',kind:'coverage',unit:'none',availability:'derived',own_goal:false}]}],
      locale,fact_hash:'b'.repeat(64),validator_version:'azure-prose-checks-1',provenance:'azure_ai_draft_checked',semantic_verified:false}};
}
