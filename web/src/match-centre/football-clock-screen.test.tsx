import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { expect,it,vi } from 'vitest';
import { MatchCentre } from './MatchCentre';
import { syntheticAdapter,syntheticSnapshot,syntheticFrame } from './unified-fixtures';
import { sequenceDescriptor } from './sequence/test-fixtures';
import { cursorAt,type MatchSource } from './session';

vi.mock('../match/Pitch',()=>({Pitch:({displayClockLabel}:{displayClockLabel:string})=><div data-testid="pitch-clock">{displayClockLabel}</div>}));

function clockScreen(source:MatchSource='historical'){
  const snapshot=syntheticSnapshot();snapshot.descriptor=sequenceDescriptor();
  snapshot.descriptor.identity={...snapshot.descriptor.identity,source};
  snapshot.clockMs=0;snapshot.interval=null;snapshot.horizonMs=snapshot.descriptor.durationMs!;
  const store=syntheticAdapter(snapshot);
  store.adapter.ensure=async elapsedMs=>{
    const current=store.adapter.snapshot(),cursor=cursorAt(current.descriptor,elapsedMs);
    const clockMs=source==='historical'?cursor.periodMs:5414000;
    store.publish({...current,requestedCursor:cursor,presentedCursor:cursor,clockMs,
      interval:{fromMs:elapsedMs,toMs:elapsedMs,before:syntheticFrame({clock_ms:clockMs,period:cursor.period}),after:null,
        continuousPlayers:new Set(),continuousBall:false}});
  };
  const view=render(<MatchCentre adapter={store.adapter} visible onBack={()=>{}}/>);
  return {...store,...view};
}
it('ordinary historical scoreboard and pitch use the same football clock through final and rewind',async()=>{
  const {container}=clockScreen();
  for(const [ms,text] of [[2880000,'45+03:00'],[2880495,'45:00'],[5851968,'90+04:31'],[1695328,'28:15']] as const){
    fireEvent.change(screen.getByRole('slider'),{target:{value:String(ms)}});
    await waitFor(()=>expect(container.querySelector('[data-unified-scoreboard] .tp-sb-t')).toHaveTextContent(text));
    expect(screen.getByTestId('pitch-clock')).toHaveTextContent(text);
    expect(container.querySelector('[data-unified-scoreboard]')).not.toHaveTextContent('Playback elapsed');
  }
});
it('GRF retains its recorded native clock rather than historical second-half arithmetic',async()=>{
  const {container}=clockScreen('grf');
  fireEvent.change(screen.getByRole('slider'),{target:{value:'5851968'}});
  await waitFor(()=>expect(container.querySelector('[data-unified-scoreboard] .tp-sb-t')).toHaveTextContent('90:14'));
  expect(container.querySelector('[data-unified-scoreboard] .tp-sb-half')).toHaveTextContent('2nd half');
  expect(screen.getByTestId('pitch-clock')).toHaveTextContent('90:14');
  expect(container.querySelector('.unified-score-source summary')).toHaveTextContent('Source · GRF simulation');
});
