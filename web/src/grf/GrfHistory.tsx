import type {GrfJob} from '../api';
import {useMatchText} from '../match/messages';
import {useGrfText} from './messages';
import {MatchCrests} from '../catalog/TeamCrest';
export function GrfHistory({jobs,busy,onOpen}:{jobs:GrfJob[];busy:boolean;onOpen:(id:string)=>void}){
  const g=useGrfText(),m=useMatchText();
  const season=(key:string)=>{const year=Number(key.split(':').at(-1));return `${year}/${String(year+1).slice(-2)}`;};
  return <section className="history grf-history"><h2>{g.history}</h2><p className="small-note">{g.historyNote}</p><div className="history-list">
    {jobs.map(job=><button className="secondary" key={job.id} disabled={busy||job.state==='failed'} onClick={()=>onOpen(job.id)}>
      <MatchCrests homeKey={job.config.home_key} awayKey={job.config.away_key}/><span>{job.summary?`${job.summary.home_name} — ${job.summary.away_name}`:`${job.config.home_key} — ${job.config.away_key}`}</span><small>GRF · {season(job.config.home_key)} / {season(job.config.away_key)} · {m[job.state]}{job.summary&&` · ${job.summary.score[0]}–${job.summary.score[1]}`}</small>
    </button>)}
  </div></section>;
}
