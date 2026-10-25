import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {LanguageProvider} from '../i18n';
import {fullFixture} from './test-fixtures';
import {GrfMatchEvents} from './GrfMatchEvents';
import type {GrfReplay} from '../api';
afterEach(cleanup);

it('reveals native goal identity only when its recorded playback sample is reached',()=>{
  const base=fullFixture();
  const record={...base,schema_version:'grf-experimental-3',telemetry:{events:[{
    type:'goal',seq:0,sample_index:2,actor_team:0,team:1,player:1,match_time_ms:2701800,own_goal:true,
  }]}} as unknown as GrfReplay;
  const view=render(<LanguageProvider><GrfMatchEvents record={record} playbackMs={100} onSeek={()=>{}}/></LanguageProvider>);
  expect(screen.queryByText(/Player 2/)).not.toBeInTheDocument();
  view.rerender(<LanguageProvider><GrfMatchEvents record={record} playbackMs={200} onSeek={()=>{}}/></LanguageProvider>);
  expect(screen.getByText(/Player 2/)).toBeVisible();
  expect(screen.getByText(/Own goal/)).toBeVisible();
  expect(screen.getByRole('complementary').textContent!.indexOf('Second half')).toBeLessThan(screen.getByRole('complementary').textContent!.indexOf('Player 2'));
});
