import { memo } from 'react';
import type { MetricDefinition,MetricValue } from '../../api';
import { useLanguage } from '../../i18n';
import { metricLabel,metricHelp,reasonText,useStatsText,unitLabel } from './messages';

export const MetricTable=memo(function MetricTable({ids,definitions,columns,onInspect}:{
  ids:readonly string[];definitions:Record<string,MetricDefinition>;
  columns:{name:string;metrics:Record<string,MetricValue>}[];onInspect?:(id:string)=>void;
}){
  const {locale}=useLanguage(),t=useStatsText();
  const format=(value:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
  return <div className="table-scroll metric-table" role="region" aria-label={t.title} tabIndex={0}><table>
    <thead><tr><th>{t.metric}</th>{columns.map((c,i)=><th key={i}>{c.name}</th>)}</tr></thead>
    <tbody>{ids.filter(id=>columns.some(c=>id in c.metrics)).map(id=><tr key={id}><th scope="row">{metricLabel(id,locale)}<small>{unitLabel(definitions[id]?.unit??'',locale)}</small></th>
      {columns.map((column,i)=>{const value=column.metrics[id];return <td key={i}>
        <span className={`stat ${value?.status??'unavailable'}`}>{value?.value==null?'—':format(value.value)}</span>
        <details><summary>{t.definition}</summary><p>{metricHelp(id,locale)}</p>
          <p>{value?t[value.origin]:'—'} · {value?t[value.status]:t.unavailable}</p>
          {value?.reason&&<p>{reasonText(value.reason,locale)}</p>}
          {value&&<><p>{t.source}: {value.source.startsWith('timepitch:')?'TimePitch':value.source} · {value.definition_version}</p>
            {value.denominator!=null&&<p>{t.denominator}: {format(value.denominator)}</p>}
            {value.covered_minutes!=null&&<p>{t.coverage}: {format(value.covered_minutes)}</p>}
            {Boolean(value.event_ids?.length)&&<p>{t.events}: {value.event_ids!.length} {value.event_ids!.slice(0,4).map(event=><button key={event} className="secondary" onClick={()=>onInspect?.(event)}>{t.inspectEvent} {event}</button>)}</p>}
            {Boolean(value.sample_ranges?.length)&&<p>{t.samples}: {value.sample_ranges!.length}</p>}
          </>}
        </details>
      </td>;})}</tr>)}</tbody></table></div>;
});
