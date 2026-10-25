import { expect, it } from 'vitest';
import { AYEW_SEQUENCE, PILOT_REVISION, halftimePolicy, validatePilot } from './pilot';
import { sequenceDescriptor } from './test-fixtures';

it('enables only the pinned historical source and its recorded contiguous boundary', () => {
  const d=sequenceDescriptor();d.identity={...d.identity,revision:PILOT_REVISION};
  expect(()=>validatePilot(d,AYEW_SEQUENCE)).not.toThrow();
  expect(halftimePolicy(d)).toMatchObject({fromMs:2878495,toMs:2882495,pauseAt:[{atMs:2880495,endingPeriod:1}]});
  for(const identity of [{...d.identity,source:'grf' as const},{...d.identity,revision:'foreign'},{...d.identity,id:'9'}]){
    expect(()=>validatePilot({...d,identity},AYEW_SEQUENCE)).toThrow();
  }
  for(const periods of [[{period:1,startMs:0,durationMs:null}],d.periods.map(p=>p.period===2?{...p,startMs:null}:p)]){
    expect(()=>halftimePolicy({...d,periods})).toThrow();
  }
});
