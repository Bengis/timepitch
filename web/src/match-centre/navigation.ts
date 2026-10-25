import type {MatchSection} from './session';
export type HistoricalTab=MatchSection|'overview'|'lineups'|'events'|'analysis'|'sources';
export const historicalTabs:HistoricalTab[]=['match','summary','players','maps','effort','data'];
const legacyTabs:HistoricalTab[]=['overview','lineups','events','analysis','sources'];
export function sectionForTab(tab?:HistoricalTab):MatchSection {
  const legacy:Partial<Record<HistoricalTab,MatchSection>>={overview:'summary',lineups:'players',events:'match',analysis:'maps',sources:'data'};
  return tab ? legacy[tab]??(historicalTabs.includes(tab)?tab as MatchSection:'match') : 'match';
}
/** Armazón de emisión (maqueta v1-2d, solo partidos grabados con análisis): tres pestañas principales y un grupo
 *  secundario «Análisis» con las secciones que la maqueta no tiene (pendiente de confirmar; no se borra nada). */
export type BroadcastTab='broadcast'|'card'|'lineups';
export type AnalysisView='summary'|'maps'|'effort'|'data';
export type BroadcastView=BroadcastTab|AnalysisView;
export const broadcastTabs:readonly BroadcastTab[]=['broadcast','card','lineups'];
export const analysisViews:readonly AnalysisView[]=['summary','maps','effort','data'];
/** Panel que carga el adaptador para cada vista: la ficha y las alineaciones leen el panel de jugadores. */
export function panelSectionFor(view:BroadcastView):MatchSection{
  return view==='broadcast'?'match':view==='card'||view==='lineups'?'players':view;
}
export function broadcastViewFor(section:MatchSection):BroadcastView{
  return section==='match'?'broadcast':section==='players'?'lineups':section;
}
export type SequenceProfile='ayew-equaliser-1'|'halftime-check-1'|'unavailable';
export type WorkspaceRoute={mode:'reconstruction';matchId?:number;seasonId?:number;teamId?:number;tab?:HistoricalTab;sequence?:SequenceProfile}
  |{mode:'simulation';view:'setup'|'centre';tab?:MatchSection}|{mode:'library'}|{mode:'demo'};
/** Pantalla principal (TP217): VERSUS + «Opciones avanzadas» (TP236). */
export const HOME_ROUTE:WorkspaceRoute={mode:'simulation',view:'setup'};
const positive=(value:string|null)=>value&&/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):undefined;
export function parseWorkspaceHash(hash:string):WorkspaceRoute{
  const [path,query]=hash.replace(/^#/,'').split('?');
  if(path==='/library')return {mode:'library'};
  if(path==='/demo')return {mode:'demo'};
  if(path==='/simulation/setup'||path==='/simulation/centre') {const tab=new URLSearchParams(query).get('tab') as MatchSection;return {mode:'simulation',view:path.endsWith('/centre')?'centre':'setup',...(historicalTabs.includes(tab)?{tab}:{})};}
  // TP217: la pantalla principal es VERSUS (simulación); «/» y cualquier ruta desconocida abren ahí. La reconstrucción
  // solo con su ruta explícita (#/reconstruction…), así que sus enlaces siguen funcionando.
  if(!/^\/reconstruction(?:\/[1-9]\d*)?$/.test(path))return {...HOME_ROUTE};
  const params=new URLSearchParams(query),matchId=positive(path.split('/')[2]??null),seasonId=positive(params.get('season')),teamId=positive(params.get('team'));
  const tab=params.get('tab') as HistoricalTab|null;
  const requested=params.get('sequence'),sequence:SequenceProfile|undefined=requested!==null?
    matchId===3754078&&(requested==='ayew-equaliser-1'||requested==='halftime-check-1')?requested:'unavailable':undefined;
  return {mode:'reconstruction',...(matchId?{matchId}:{}),...(seasonId?{seasonId}:{}),...(teamId?{teamId}:{}),...(tab&&[...historicalTabs,...legacyTabs].includes(tab)?{tab}:{}),...(sequence?{sequence}:{})};
}
export function formatWorkspaceHash(route:WorkspaceRoute):string{
  if(route.mode==='library')return '#/library';
  if(route.mode==='demo')return '#/demo';
  if(route.mode==='simulation')return `#/simulation/${route.view}${route.tab?`?tab=${route.tab}`:''}`;
  const params=new URLSearchParams();
  if(route.seasonId)params.set('season',String(route.seasonId));
  if(route.teamId)params.set('team',String(route.teamId));
  if(route.tab)params.set('tab',route.tab);
  if(route.sequence)params.set('sequence',route.sequence);
  return `#/reconstruction${route.matchId?`/${route.matchId}`:''}${params.size?`?${params}`:''}`;
}
