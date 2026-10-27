import {render,screen} from '@testing-library/react';
import {it,expect} from 'vitest';
import {NarrationPanel} from './NarrationPanel';
import {SUMMARY_CORRECTIONS} from './summary-corrections';
import type {EventView} from '../session';
import type {TimelineContext} from '../analysis/RecordedAnalysisViews';
it('shows the exact short spoken text only after the saved equaliser, preserving normal narration otherwise',()=>{
  const e=SUMMARY_CORRECTIONS[0];
  const events=[{id:'first',side:'home',actorId:'jude',elapsedMs:409500},{id:e.eventId,side:'away',actorId:'josh',elapsedMs:e.atMs}].map(g=>({...g,kind:'goal',period:1,periodMs:g.elapsedMs,sourceIndex:0,participantIds:[g.actorId],outcome:'scored',provenance:'simulated',refs:[],details:{}})) as EventView[];
  const ctx={source:'recorded',engineLabel:'GRF',teams:{home:{name:'North London Reds'},away:{name:'Mancunian Sky'}},player:(id:string)=>({name:id==='jude'?'Jude Norris':'Josh Newbury'})} as unknown as TimelineContext;
  const props={ctx,events,keepers:new Set<string>(),onSeek:()=>{}};
  const view=render(<NarrationPanel {...props} untilMs={e.atMs-1} speechCorrections={SUMMARY_CORRECTIONS}/>);
  expect(screen.queryByText(e.replacementText)).toBeNull();
  view.rerender(<NarrationPanel {...props} untilMs={e.atMs} speechCorrections={SUMMARY_CORRECTIONS}/>);
  expect(screen.getByText(e.replacementText)).toBeInTheDocument();
  view.rerender(<NarrationPanel {...props} untilMs={e.atMs}/>);
  expect(screen.getByText(e.originalText)).toBeInTheDocument();
});
