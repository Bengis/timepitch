import {afterEach,expect,it,vi} from 'vitest';
import {renderHook,act,waitFor} from '@testing-library/react';
import {preparationFor,readComparisonLink,writeComparisonLink,clearComparisonLink} from './matchup';
import {useTeam} from '../match/useTeam';
import {getTeam,type TeamSeason} from '../api';
import type {components} from '../generated/api';
vi.mock('../api',async()=>({...await vi.importActual('../api'),getTeam:vi.fn()}));
type Prefill=components['schemas']['MatchupPrefill'];
const side=(key:string)=>({source_team_key:'statsbomb:1',catalog_key:key,source_formation:'4-2-3-1',source_players:['unverified'],player_keys:null,supported_formations:['4-4-2'],differences:['unsupported_source_formation','unverified_player_identities']});
const fixture=():Prefill=>({historical_match_id:9,historical_dataset_version:'h1',catalog_dataset_version:'c1',crosswalk_version:'x1',available:true,exact_xi_available:false,home:side('chelsea:2015'),away:side('arsenal:2015')});
afterEach(()=>{sessionStorage.clear();vi.restoreAllMocks();});
it('prefills only club/season selection, refusing unsupported or unverified XI',()=>{
  const value=preparationFor(fixture(),false);
  expect(value.home).toEqual({key:'chelsea:2015',datasetVersion:'c1'});
  expect(JSON.stringify(value)).not.toMatch(/goals|score|tracking|events|seed/);
  expect(()=>preparationFor(fixture(),true)).toThrow();
});
it('stores only a validated private comparison pointer, without authentication data',()=>{
  writeComparisonLink({historicalMatchId:9,engine:'grf',simulationId:'saved'});
  expect(readComparisonLink()).toEqual({historicalMatchId:9,engine:'grf',simulationId:'saved'});
  clearComparisonLink();expect(readComparisonLink()).toBeNull();
  sessionStorage.setItem('timepitch:comparison',JSON.stringify({historicalMatchId:9,engine:'other',simulationId:'saved',token:'never-authority'}));
  expect(readComparisonLink()).toBeNull();
});
it('does not apply a late prepared team after a user selects a different identity',async()=>{
  let resolve!:(team:TeamSeason)=>void;
  vi.mocked(getTeam).mockImplementation(key=>key==='chelsea:2015'?new Promise(r=>resolve=r):Promise.reject(new Error('Fixture unavailable')));
  const {result}=renderHook(()=>useTeam('initial:2000'));
  act(()=>result.current.prepare({key:'chelsea:2015',datasetVersion:'c1'}));
  await waitFor(()=>expect(getTeam).toHaveBeenCalledWith('chelsea:2015',expect.anything()));
  act(()=>result.current.setKey('arsenal:2015'));
  await act(async()=>resolve({key:'chelsea:2015',dataset_version:'c1',available_formations:['4-4-2'],players:[]} as unknown as TeamSeason));
  expect(result.current.key).toBe('arsenal:2015');
  expect(result.current.team).toBeNull();
});
it('does not reload and overwrite a manual formation edit after club preparation',async()=>{
  vi.mocked(getTeam).mockResolvedValue({key:'chelsea:2015',dataset_version:'c1',available_formations:['4-4-2','3-5-2'],players:[]} as unknown as TeamSeason);
  const {result}=renderHook(()=>useTeam('chelsea:2015'));
  await waitFor(()=>expect(result.current.team).not.toBeNull());
  act(()=>result.current.prepare({key:'chelsea:2015',datasetVersion:'c1'}));
  await waitFor(()=>expect(result.current.preparationStatus).toBe('clubs_only'));
  await act(async()=>result.current.setFormation('3-5-2'));
  await waitFor(()=>expect(result.current.formation).toBe('3-5-2'));
  expect(result.current.preparationStatus).toBe('edited');
});
