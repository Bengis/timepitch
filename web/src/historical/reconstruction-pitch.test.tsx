import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {LanguageProvider} from '../i18n';
import {ReconstructionPitch,reconstructionSceneFrame} from './ReconstructionPitch';
import {segmentFixture} from './test-fixtures';
import {Pitch} from '../match/Pitch';
import {drawRetro} from '../match/retroCanvas';
vi.mock('../match/retroCanvas',()=>({atlasUrl:'/test-atlas.svg',drawRetro:vi.fn()}));
it('retains recorded anchors while synthetic motion is hidden and labels the missing ball',()=>{
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  const segment=segmentFixture();
  render(<LanguageProvider><ReconstructionPitch frame={segment.frames[0]} previous={segment.frames[0]} anchors={segment.anchors} showSynthetic={false}/></LanguageProvider>);
  expect(screen.getByText('Ball unavailable · no continuous tracking')).toBeVisible();
  expect(screen.getByRole('img',{name:'Recorded event anchors'})).toBeVisible();
  screen.getByText('Recorded event anchors (1)').click();
  expect(screen.getByRole('listitem')).toHaveTextContent('e1');
});
it('does not turn an unknown cursor score into a nil-nil score on the canvas',()=>{
  expect(reconstructionSceneFrame(segmentFixture().frames[0],new Map(),true,null).score).toBeNull();
});
it('does not present a rendering placeholder as a historical player position',()=>{
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  const frame=segmentFixture().frames[0],people=new Map([[0,{key:'statsbomb:10',name:'Recorded player',side:'home' as const,role:'MID' as const}]]);
  const view=render(<LanguageProvider><ReconstructionPitch frame={frame} previous={frame} people={people} anchors={[]} showSynthetic home="Chelsea"/></LanguageProvider>);
  fireEvent.change(screen.getByRole('combobox',{name:'Inspect player'}),{target:{value:'statsbomb:10'}});
  expect(view.container.querySelector('.pitch-inspector p')).toHaveTextContent(/^Recorded player · Chelsea$/);
});
it('retains the simulation player position in the shared inspector',()=>{
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  const frame=segmentFixture().frames[0],people=new Map([[0,{key:'statsbomb:10',name:'Recorded player',side:'home' as const,role:'MID' as const}]]);
  const view=render(<LanguageProvider><Pitch frame={reconstructionSceneFrame(frame,people,true)} home="Chelsea" away="Swansea City"/></LanguageProvider>);
  fireEvent.change(screen.getByRole('combobox',{name:'Inspect player'}),{target:{value:'statsbomb:10'}});
  expect(view.container.querySelector('.pitch-inspector p')).toHaveTextContent(/^Recorded player · Midfielder · Chelsea$/);
});
it('uses the simulation camera, scene scale and club HUD for the same presentation frame',()=>{
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  const frame=segmentFixture().frames[0],people=new Map([[0,{key:'statsbomb:10',name:'Recorded player',side:'home' as const,role:'MID' as const}]]),score={home:2,away:2};
  const direct=render(<LanguageProvider><Pitch frame={reconstructionSceneFrame(frame,people,true,score)} home="Chelsea" away="Swansea City"/></LanguageProvider>);
  const expected=vi.mocked(drawRetro).mock.calls.at(-1)!;
  direct.unmount();
  render(<LanguageProvider><ReconstructionPitch frame={frame} previous={frame} people={people} score={score} anchors={[]} showSynthetic home="Chelsea" away="Swansea City" clock="00:00"/></LanguageProvider>);
  const actual=vi.mocked(drawRetro).mock.calls.at(-1)!;
  expect(actual[1]).toEqual(expected[1]);
  expect(actual[2]).toEqual(expected[2]);
  expect(actual[5]).toEqual(expected[5]);
  expect(screen.getByRole('combobox',{name:'Camera'})).toHaveValue('follow');
  expect(screen.getByRole('img',{name:'Reconstructed football pitch'})).toHaveAttribute('data-renderer','retro-1');
});
it('projects recorded anchors through the shared selected camera while preserving unavailable data',()=>{
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  const segment=segmentFixture();
  render(<LanguageProvider><ReconstructionPitch frame={segment.frames[0]} previous={segment.frames[0]} anchors={segment.anchors} showSynthetic score={null}/></LanguageProvider>);
  const camera=screen.getByRole('combobox',{name:'Camera'});
  const before=screen.getByRole('img',{name:'Recorded event anchors'}).querySelector('circle')!.getAttribute('cx');
  fireEvent.change(camera,{target:{value:'overview'}});
  const after=screen.getByRole('img',{name:'Recorded event anchors'}).querySelector('circle')!.getAttribute('cx');
  expect(after).not.toBe(before);
  const call=vi.mocked(drawRetro).mock.calls.at(-1)!;
  expect(call[1].ball).toBeNull();expect(call[1].score).toBeNull();
  expect(screen.getByText('Ball unavailable · no continuous tracking')).toBeVisible();
});
