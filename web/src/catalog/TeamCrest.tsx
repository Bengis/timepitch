import {useState} from 'react';
import {useLanguage} from '../i18n';
import {resolveHistoricalCrest} from './crests';
import {crestChain} from './crest-resolver';
import type {CrestRef} from '../presentation/types';
export {resolveHistoricalCrest} from './crests';

function sourceLabel(crest:CrestRef){
  if(crest.kind==='hd'&&crest.source?.title)return `Wikipedia · ${crest.source.title} · ${crest.source.licence}`;
  return crest.source?.url?.startsWith('https://news.adidas.com/')?'Arsenal / adidas':'Historical Football Kits';
}

export function TeamCrest({teamKey,compact=false}:{teamKey:string;compact?:boolean}){
  const {locale}=useLanguage();
  const [failed,setFailed]=useState<readonly string[]>([]);
  const crest=crestChain(teamKey).find(c=>!failed.includes(c.src))??null;
  const year=Number(teamKey.split(':')[1]);
  const label=locale==='es'?'Referencia del escudo histórico de camiseta':'Historical shirt crest reference';
  const unavailable=locale==='es'?'Escudo histórico no disponible':'Historical crest unavailable';
  const cannon=crest?.kind==='hfk'&&resolveHistoricalCrest(teamKey)?.id==='arsenal-2024';
  return <span className={`team-crest${compact?' team-crest--compact':''}${crest?'':' team-crest--missing'}${cannon?' team-crest--cannon':''}`}
    title={crest?`${label} · ${year}/${String(year+1).slice(-2)} · ${sourceLabel(crest)}`:unavailable} aria-hidden="true">
    {crest?<img key={crest.src} src={crest.src} alt="" width="48" height="48" decoding="async" onError={()=>setFailed(f=>[...f,crest.src])}/>:<span>—</span>}
  </span>;
}
export function MatchCrests({homeKey,awayKey}:{homeKey:string;awayKey:string}){
  return <span className="match-crests"><TeamCrest teamKey={homeKey} compact/><TeamCrest teamKey={awayKey} compact/></span>;
}
