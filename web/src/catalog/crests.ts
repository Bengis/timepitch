import manifest from './historical-crests.json';
import { fictional } from './fictional';
export type HistoricalCrest={id:string;src:string;source:string};
const seasons:Record<string,string>=manifest.seasons;
const assets:Record<string,HistoricalCrest>=manifest.assets;
export function resolveHistoricalCrest(teamKey:string):HistoricalCrest|null{
  if(fictional())return null; // TP259: la liga ficticia no lleva escudos reales
  return Object.hasOwn(seasons,teamKey)?assets[seasons[teamKey]]??null:null;
}
