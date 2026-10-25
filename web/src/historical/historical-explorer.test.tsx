import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {LanguageProvider} from '../i18n';
import {HistoricalExplorer} from './HistoricalExplorer';
import {historicalFixture} from './test-fixtures';
import * as api from './api';
vi.mock('./api',async()=>({...await vi.importActual('./api'),readSeasons:vi.fn(),readMatches:vi.fn()}));
it('resets archive pagination when browser history restores a narrower team filter',async()=>{
  const matches=Array.from({length:72},(_,i)=>{const match=historicalFixture();return {...match,id:i+1,home_team:{...match.home_team,source_id:i%10===0?1:3}};});
  vi.mocked(api.readSeasons).mockResolvedValue([{season_id:27,label:'2015/16',matches_total:72,facts_ready:72,coverage_scope:'full_season',calendar_complete:true}]);
  vi.mocked(api.readMatches).mockImplementation(async(_season,_team,offset)=>({dataset_version:'v1',total:72,offset,limit:24,items:matches.slice(offset,offset+24)}));
  const view=render(<LanguageProvider><HistoricalExplorer route={{mode:'reconstruction'}} datasetVersion="v1" onNavigate={vi.fn()}/></LanguageProvider>);
  await screen.findAllByRole('button',{name:/Open reconstruction/});
  fireEvent.click(screen.getByRole('button',{name:'Next'}));fireEvent.click(screen.getByRole('button',{name:'Next'}));
  expect(screen.getByText('3 / 3')).toBeVisible();
  view.rerender(<LanguageProvider><HistoricalExplorer route={{mode:'reconstruction',teamId:1}} datasetVersion="v1" onNavigate={vi.fn()}/></LanguageProvider>);
  await waitFor(()=>expect(screen.getByText('1 / 1')).toBeVisible());
  expect(screen.getAllByRole('button',{name:/Open reconstruction/})).toHaveLength(8);
});
