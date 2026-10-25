import {expect,it} from 'vitest';
import {render,screen} from '@testing-library/react';
import {LanguageProvider} from '../i18n';
import {HistoricalAnalysis} from './HistoricalAnalysis';
import {historicalFixture,statisticsFixture} from './test-fixtures';
it('shows recorded action types, event zones and a schematic source-ID pass network',()=>{
  const statistics=statisticsFixture();
  statistics.action_map=[{event_id:'shot',type:'Shot',team_key:'statsbomb:1',player_key:'statsbomb:10',location:{x:100,y:34},end_location:null,provenance:'derived_from_events'}];
  statistics.pass_network=[{team_key:'statsbomb:1',player_key:'statsbomb:10',recipient_key:'statsbomb:11',count:2,event_ids:['pass1','pass2']}];
  render(<LanguageProvider><HistoricalAnalysis match={historicalFixture()} statistics={statistics}/></LanguageProvider>);
  expect(screen.getByRole('img',{name:'Schematic pass connections'})).toBeVisible();
  expect(screen.getByText('Recorded actions by x-coordinate band')).toBeVisible();
  expect(screen.getByLabelText('Action map filter')).toBeVisible();
  expect(screen.getByText('Not player tracking or average player positions.')).toBeVisible();
});
