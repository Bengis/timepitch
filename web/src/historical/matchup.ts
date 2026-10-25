import type {components} from '../generated/api';
import type {Formation} from '../match/lineup';
export type MatchupPrefill=components['schemas']['MatchupPrefill'];
export type PreparedTeam={key:string;datasetVersion:string;formation?:Formation;players?:string[]};
export type ComparisonLink={historicalMatchId:number;engine:'timepitch'|'grf';simulationId:string};
export function preparationFor(value:MatchupPrefill,exact:boolean):{home:PreparedTeam;away:PreparedTeam}{
  if(!value.available||!value.home.catalog_key||!value.away.catalog_key||exact&&!value.exact_xi_available)throw new Error('Historical preparation unavailable');
  const side=(team:MatchupPrefill['home']):PreparedTeam=>{
    if(!exact)return {key:team.catalog_key!,datasetVersion:value.catalog_dataset_version};
    if(!team.player_keys||team.player_keys.length!==11||new Set(team.player_keys).size!==11||!['4-4-2','4-3-3','3-5-2','4-5-1'].includes(team.source_formation??'')||!team.supported_formations.includes(team.source_formation!))throw new Error('Exact historical XI unavailable');
    return {key:team.catalog_key!,datasetVersion:value.catalog_dataset_version,formation:team.source_formation as Formation,players:[...team.player_keys]};
  };
  return {home:side(value.home),away:side(value.away)};
}
export function writeComparisonLink(value:ComparisonLink){
  const safe={historicalMatchId:value.historicalMatchId,engine:value.engine,simulationId:value.simulationId};
  try{sessionStorage.setItem('timepitch:comparison',JSON.stringify(safe));window.dispatchEvent(new Event('timepitch:comparison-change'));}catch{/* A session pointer is optional, never authority. */}
}
export function readComparisonLink():ComparisonLink|null{
  try{
    const value=JSON.parse(sessionStorage.getItem('timepitch:comparison')??'null');
    if(!value||!Number.isSafeInteger(value.historicalMatchId)||value.historicalMatchId<=0||!['timepitch','grf'].includes(value.engine)||typeof value.simulationId!=='string'||!value.simulationId||value.simulationId.length>100)return null;
    return {historicalMatchId:value.historicalMatchId,engine:value.engine,simulationId:value.simulationId};
  }catch{return null;}
}
export function clearComparisonLink(){
  try{sessionStorage.removeItem('timepitch:comparison');window.dispatchEvent(new Event('timepitch:comparison-change'));}catch{/* Optional storage. */}
}
