import type { ReactNode } from 'react';
import { useLanguage } from '../../i18n';
import { momentsAt } from './analysis';
import { PlayCard } from './PlayCard';
import { SequenceRail } from './SequenceRail';
import { useSequenceText } from './messages';
import type { SequencePresentation } from './types';
export function SequenceExperience({sequence,elapsed,pitch,transport,details,detailsOpen,onDetails,onPlayer,onMoment,ready,times}:{
  sequence:SequencePresentation;elapsed:number;ready:boolean;times:readonly number[];pitch:ReactNode;transport:ReactNode;details:ReactNode;detailsOpen:boolean;
  onDetails:(open:boolean)=>void;onPlayer:(id:string)=>void;onMoment:(ms:number)=>void;
}){
  const {locale}=useLanguage(),t=useSequenceText();
  const reached=sequence.kind==='actions'?momentsAt(sequence.source,elapsed,locale):[];
  return <div className="sequence-experience">
    <div className="sequence-main"><div className="sequence-stage">{pitch}{transport}</div>
      {ready&&sequence.kind==='actions'&&<PlayCard key={`${sequence.source.key}/${reached.at(-1)?.id??'start'}`} source={sequence.source} moment={reached.at(-1)??null} onPlayer={onPlayer}/>}</div>
    {ready&&!!times.length&&<SequenceRail times={times} reached={reached} elapsed={elapsed} onSeek={onMoment}/>}
    <details className="sequence-details" open={detailsOpen} onToggle={e=>onDetails(e.currentTarget.open)}><summary>{t.details}</summary>{detailsOpen&&details}</details>
  </div>;
}
