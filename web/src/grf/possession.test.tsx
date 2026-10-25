import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {LanguageProvider,LanguageSelector} from '../i18n';
import {getGrfStatistics} from '../api';
import {GrfStatisticsPanel} from './statistics/GrfStatisticsPanel';
import {summaryFixture} from './statistics/test-fixtures';

vi.mock('../api',()=>({getGrfStatistics:vi.fn()}));
afterEach(()=>{cleanup();localStorage.clear();});

it('uses the same team split in both bars and reports unassigned exposure separately',async()=>{
  const data=summaryFixture();
  for(const [side,value] of [['home',60],['away',40]] as const){
    data.by_team[side]={...data.by_team[side],team_possession_pct:{...data.by_team[side].possession_pct,
      value,denominator:150,covered_ms:150,definition_id:'team_possession_pct'}};
  }
  vi.mocked(getGrfStatistics).mockResolvedValue(data);
  render(<LanguageProvider><LanguageSelector/><GrfStatisticsPanel id="one" traceHash="fixture" onSeek={()=>{}}/></LanguageProvider>);
  const row=(await screen.findByRole('rowheader',{name:'Team possession'})).closest('tr')!;
  expect(within(row).getAllByRole('cell').map(cell=>cell.textContent)).toEqual(['60 %','40 %']);
  const small=row.querySelectorAll('.comparison-bar i');
  const large=document.querySelectorAll('.grf-possession-bar i');
  expect(large).toHaveLength(2);
  expect([...small].map(el=>(el as HTMLElement).style.width)).toEqual(['60%','40%']);
  expect([...large].map(el=>(el as HTMLElement).style.width)).toEqual(['60%','40%']);
  expect(screen.getByText(/Unassigned in-play time: 25 %/)).toBeVisible();
  fireEvent.click(screen.getByText('Additional team statistics',{selector:'summary'}));
  expect(screen.getByRole('rowheader',{name:'Direct ball control'})).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Language: Español' }));
  expect(screen.getByRole('rowheader',{name:'Posesión de equipo'})).toBeVisible();
});

it('does not relabel old direct control as team possession when events are absent',async()=>{
  const data=summaryFixture();delete data.by_team.home.team_possession_pct;delete data.by_team.away.team_possession_pct;
  vi.mocked(getGrfStatistics).mockResolvedValue(data);
  render(<LanguageProvider><GrfStatisticsPanel id="old" traceHash="fixture" onSeek={()=>{}}/></LanguageProvider>);
  const row=(await screen.findByRole('rowheader',{name:'Team possession'})).closest('tr')!;
  expect(within(row).getAllByRole('cell').every(cell=>cell.textContent==='Not available')).toBe(true);
  expect(document.querySelector('.grf-possession-bar')).toBeNull();
});
