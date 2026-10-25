import manifest from './historical-crests.json';
export type HistoricalCrest={id:string;src:string;source:string};
const seasons:Record<string,string>=manifest.seasons;
const assets:Record<string,HistoricalCrest>=manifest.assets;
export function resolveHistoricalCrest(teamKey:string):HistoricalCrest|null{
  return Object.hasOwn(seasons,teamKey)?assets[seasons[teamKey]]??null:null;
}
