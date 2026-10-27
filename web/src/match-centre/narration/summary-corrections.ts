import definition from './fixtures/summary-corrections.json';
import type {NarrationLine} from './narration';
import type {SpeechIdentity} from './azure-cues';
export type SummaryCorrection=Readonly<{cueId:string;eventId:string;atMs:number;originalText:string;replacementText:string;locale:string}>;
export const SUMMARY_CORRECTIONS:readonly SummaryCorrection[]=definition.edits;
const canonical=(x:unknown):string=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function summaryScope(source:SpeechIdentity,locale:string):readonly SummaryCorrection[]{
  return locale==='en'&&canonical(source)===canonical(definition.source)?SUMMARY_CORRECTIONS:[];
}
summaryScope.source=definition.source as SpeechIdentity;
export function applySummaryCorrections(lines:readonly NarrationLine[],edits:readonly SummaryCorrection[]):NarrationLine[]{
  if(edits.some(e=>!SUMMARY_CORRECTIONS.some(allowed=>canonical(e)===canonical(allowed)))||new Set(edits.map(e=>e.eventId)).size!==edits.length)throw new Error('Unapproved summary correction');
  return lines.map(line=>{
    const e=edits.find(e=>e.eventId===line.source.id);if(!e)return line;
    if(line.text!==e.originalText||line.atMs!==e.atMs||line.kind!=='goal')throw new Error('Summary correction fact mismatch');
    return{...line,text:e.replacementText};
  });
}
