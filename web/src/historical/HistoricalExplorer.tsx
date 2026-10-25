import {useEffect,useState} from 'react';
import {readMatches,readSeasons,type HistoricalMatch,type HistoricalSeason} from './api';
import {useHistoricalText} from './messages';
import {ProvenanceBadge} from './provenance';
import type {WorkspaceRoute} from '../match-centre/navigation';
type Route=Extract<WorkspaceRoute,{mode:'reconstruction'}>;
export function HistoricalExplorer({route,datasetVersion,onNavigate}:{route:Route;datasetVersion:string;onNavigate:(route:WorkspaceRoute)=>void}){
  const h=useHistoricalText();
  const [data,setData]=useState<{season:number;version:string;seasons:HistoricalSeason[];matches:HistoricalMatch[]}|null>(null);
  const [error,setError]=useState(false),[attempt,setAttempt]=useState(0),[page,setPage]=useState(0);
  const season=route.seasonId??27;
  useEffect(()=>setPage(0),[route.teamId]);
  useEffect(()=>{
    const controller=new AbortController();setError(false);setPage(0);
    void (async()=>{
      const seasons=await readSeasons(controller.signal),matches:HistoricalMatch[]=[];
      let total=1;
      while(matches.length<total){
        const part=await readMatches(season,undefined,matches.length,controller.signal);
        if(part.dataset_version!==datasetVersion)throw new Error('Dataset changed');
        total=part.total;if(!part.items.length&&matches.length<total)throw new Error('Incomplete archive');matches.push(...part.items);
      }
      if(!controller.signal.aborted)setData({season,version:datasetVersion,seasons,matches});
    })().catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();
  },[season,datasetVersion,attempt]);
  const current=data?.season===season&&data.version===datasetVersion?data:null;
  const teams=[...new Map(current?.matches.flatMap(m=>[m.home_team,m.away_team]).map(team=>[team.source_id,team])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  const matches=current?.matches.filter(m=>!route.teamId||m.home_team.source_id===route.teamId||m.away_team.source_id===route.teamId)??[];
  const selectedSeason=current?.seasons.find(s=>s.season_id===season);
  return <section className="historical-workspace historical-explorer"><header className="archive-intro"><p className="eyebrow">{h.archive}</p><h1>{h.title}</h1><p>{h.intro}</p><ProvenanceBadge kind="source_recorded"/></header>
    <p className="local-research-note">{h.localOnly}</p>
    {error?<div role="alert">{h.unavailable} <button onClick={()=>setAttempt(v=>v+1)}>{h.retry}</button></div>:!current?<p role="status">{h.loading}</p>:<>
      <div className="archive-filters"><label>{h.season}<select value={season} onChange={e=>onNavigate({mode:'reconstruction',seasonId:Number(e.target.value)})}>{current.seasons.map(s=><option key={s.season_id} value={s.season_id}>{s.label}</option>)}</select></label>
        <label>{h.allTeams}<select value={route.teamId??''} onChange={e=>{setPage(0);onNavigate({mode:'reconstruction',seasonId:season,...(e.target.value?{teamId:Number(e.target.value)}:{})});}}><option value="">{h.allTeams}</option>{teams.map(team=><option key={team.source_id} value={team.source_id}>{team.name}</option>)}</select></label>
        <p>{h.coverage}: <strong>{selectedSeason?.coverage_scope==='arsenal_only'?h.arsenalOnly:h.fullSeason}</strong><br/>{matches.length} {h.events==='Eventos'?'partidos':'matches'}</p>
      </div>
      <div className="archive-list">{matches.slice(page*24,(page+1)*24).map(match=><button key={match.id} className="archive-row" onClick={()=>onNavigate({...route,matchId:match.id,tab:'overview'})}>
        <time dateTime={match.date}>{match.date}</time><span className="archive-clubs"><strong>{match.home_team.name}</strong><span>{match.away_team.name}</span></span><strong className="archive-result">{match.final_score.home} – {match.final_score.away}</strong><span className="archive-coverage">{match.status==='facts_ready'?h.sourceRecorded:h.partial}</span><span className="archive-open">{h.open} →</span>
      </button>)}</div>
      <div className="archive-pagination"><button disabled={page===0} onClick={()=>setPage(v=>v-1)}>{h.previous}</button><span>{page+1} / {Math.max(1,Math.ceil(matches.length/24))}</span><button disabled={(page+1)*24>=matches.length} onClick={()=>setPage(v=>v+1)}>{h.next}</button></div>
    </>}
  </section>;
}
