import {expect,type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {legacyRecord,bundle,modernGrf,sourceReaders,historicalEvent} from '../src/match-centre/adapters/test-fixtures';
import {summaryFixture} from '../src/grf/statistics/test-fixtures';

// Recorded-contract fixtures only. No native job, import, model, or source build.
export async function unifiedFixture(page:Page){
  const history=sourceReaders(),tp=legacyRecord(),grf=modernGrf();
  history.match.home_team.name=tp.home_name='Home club';history.match.away_team.name=tp.away_name='Away club';
  history.events.push(historicalEvent('fixture-pass',1000));
  grf.input.home_name='Home club';grf.input.away_name='Away club';
  grf.duration_ms=30000;grf.halftime_sample_index=150;
  const samples=grf.samples;
  grf.samples=Array.from({length:301},(_,index)=>({...samples[index<150?0:index<200?2:3],index,engine_step:index,phase:index<150?1:2,match_time_ms:index*18000,actual_time_ms:index*100,score:index<200?[0,0]:[1,0]}));
  grf.telemetry.events=grf.telemetry.events.map((e,i)=>({...e,sample_index:i?200:10,phase:i?2:1,match_time_ms:i?3600000:180000,team:0,actor_team:i?1:0,score:i?[1,0]:[0,0]}));
  const hashes=[history.match,tp,grf].map(value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'));
  const forbidden:string[]=[],unexpected:string[]=[],segments=new Map<string,number>(),statsStarts:number[]=[];
  const cap=await history.readers.capabilities();
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()!=='GET'){forbidden.push(`${request.method()} ${path}`);return route.fulfill({status:403,json:{detail:'Read-only fixture gate'}});}
    const job=(engine:string)=>({id:`fixture-${engine}`,state:'ready',config:engine==='grf'?grf.input.config:tp.config,summary:{home_name:'Home club',away_name:'Away club',score:[1,0],metrics:{home:{goals:1},away:{goals:0}}}});
    let value:unknown;
    if(path==='/api/catalog/teams'||path==='/api/engines'||path==='/api/historical/seasons')value=[];
    // TP213: the match header asks for the clubs' head-to-head and records; the fixture has no catalogue.
    else if(path==='/api/catalog/head-to-head'||/^\/api\/catalog\/teams\/[^/]+\/record$/.test(path))return route.fulfill({status:404,json:{detail:'No fixture catalogue'}});
    else if(path.startsWith('/api/catalog/teams/'))return route.fulfill({status:404,json:{detail:'No fixture catalogue'}});
    else if(path==='/api/historical/capabilities')value=cap;
    else if(path==='/api/chronicles/v2/status')value={profile:'azure-chronicle-1',mode:'off',worker:'off',generation_allowed:false,supported_engines:['timepitch','grf'],reason:'Read-only browser fixture'};
    else if(path==='/api/chronicles/v2')return route.fulfill({status:204,body:''});
    else if(path==='/api/matches')value=[job('timepitch')];
    else if(path==='/api/grf/matches')value=[job('grf')];
    else if(path==='/api/matches/fixture-timepitch')value=job('timepitch');
    else if(path==='/api/grf/matches/fixture-grf')value=job('grf');
    else if(path.endsWith('/fixture-timepitch/replay'))value=tp;
    else if(path.endsWith('/fixture-grf/replay'))value=grf;
    else if(path.endsWith('/fixture-timepitch/windows'))value=[];
    else if(path.endsWith('/fixture-timepitch/statistics'))value=bundle(Number(url.searchParams.get('end_ms')));
    else if(path.endsWith('/fixture-grf/statistics'))value=summaryFixture();
    else if(path==='/api/historical/matches/9')value=history.match;
    else if(path.endsWith('/9/reconstruction'))value=history.manifest;
    else if(path.includes('/9/reconstruction/segments/')){
      segments.set(path,(segments.get(path)??0)+1);const parts=path.split('/'),period=Number(parts.at(-2)),index=Number(parts.at(-1));
      const data=history.segment(period,index);
      if(index===2)data.frames.push({...data.frames[0],period_ms:125000});
      value=data;
    }else if(path.endsWith('/9/events')){
      const items=await history.readers.events(9,Number(url.searchParams.get('period')),Number(url.searchParams.get('from_ms')),Number(url.searchParams.get('to_ms')));
      expect(Number(url.searchParams.get('to_ms'))-Number(url.searchParams.get('from_ms'))).toBeLessThanOrEqual(60000);
      value={match_id:9,dataset_version:'v1',items,total:items.length};
    }else if(path.endsWith('/9/statistics')){statsStarts.push(Date.now());value=await history.readers.statistics(9,Number(url.searchParams.get('period')),Number(url.searchParams.get('at_ms')));}
    else {unexpected.push(path);return route.fulfill({status:404,json:{detail:'Unexpected fixture read'}});}
    return route.fulfill({json:value});
  });
  return {forbidden,unexpected,segments,statsStarts,assertImmutable(){expect([history.match,tp,grf].map(value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'))).toEqual(hashes);}};
}

export async function openUnified(page:Page,source:string){
  await page.goto('/#/reconstruction/9');
  if(source!=='historical'){
    await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:/Library|Biblioteca/,exact:true}).click();
    await page.locator(source==='grf'?'.grf-history':'.history:not(.grf-history)').getByRole('button',{name:/Home club.*Away club/}).click();
  }
  const centre=page.locator(`[data-unified-match-centre][data-source=${source}]`);
  await expect(centre).toBeVisible();
  const pitch=centre.locator('.pitch-section');
  await expect(pitch).toHaveAttribute('data-renderer-status',/^(ready|fallback)$/);
  await expect(centre.locator('canvas')).toBeVisible();
  if(await pitch.getAttribute('data-effective-renderer')==='retro-1')await expect(centre.locator('canvas')).toHaveAttribute('data-sprite-status',/^(ready|fallback)$/);
  await expect(centre.getByRole('slider')).toBeEnabled();await expect(centre.locator('[data-unified-transport] p[role=status]')).toHaveCount(0);
  return centre;
}
