import {it,expect} from 'vitest';
import {SUMMARY_CORRECTIONS,applySummaryCorrections,summaryScope} from './summary-corrections';
import type {NarrationLine} from './narration';

const lines=()=>SUMMARY_CORRECTIONS.map(e=>({id:e.cueId.replace(/:en-goal$/,''),source:{id:e.eventId},atMs:e.atMs,text:e.originalText,kind:'goal'}) as NarrationLine);
it('projects exactly six approved factual goal lines, retaining IDs, timestamps and original inputs',()=>{
  const input=lines(),result=applySummaryCorrections(input,SUMMARY_CORRECTIONS);
  expect(result.map(x=>x.text)).toEqual(['GOAL! Josh Newbury! One–one!','GOAL! Scott Crane! Two–one!','GOAL! Nico Warburton! Three–one!','GOAL! Nico Warburton! Four–one!','GOAL! Albie Greaves! Five–one!','GOAL! Jude Norris! Six–one!']);
  expect(input[0].text).toContain('shoots');expect(result.map(x=>[x.id,x.atMs])).toEqual(input.map(x=>[x.id,x.atMs]));
  expect(applySummaryCorrections([],SUMMARY_CORRECTIONS)).toEqual([]);
});
it('rejects unapproved edits, changed original text, time or source',()=>{
  expect(()=>applySummaryCorrections(lines(),[{...SUMMARY_CORRECTIONS[0],replacementText:'Other'}])).toThrow();
  for(const change of [{text:'Other'},{atMs:1}])expect(()=>applySummaryCorrections([{...lines()[0],...change}],SUMMARY_CORRECTIONS)).toThrow();
  expect(summaryScope({...summaryScope.source,seed:0},'en')).toEqual([]);
  expect(summaryScope(summaryScope.source,'es')).toEqual([]);
  expect(summaryScope(summaryScope.source,'en')).toEqual(SUMMARY_CORRECTIONS);
});
