import {test,expect,type Page,type Locator} from '@playwright/test';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {expect3D,prefer3D} from './pitch-renderer-checks';

const root=process.env.TIMEPITCH_UNIFIED_ACCEPTANCE_DIR;
const admitted=!!root&&existsSync(join(root,'browser-auth.json'));
test.skip(!admitted,'Explicit private accepted source/saved replays required; this suite never creates matches.');
const read=(file:string)=>JSON.parse(readFileSync(join(root!,file),'utf8'));
const auth=admitted?read('browser-auth.json'):{cookie:'',saved:{}};
const historical=admitted?read('historical-expected.json'):null;
const dataset=process.env.TIMEPITCH_RECONSTRUCTION_DATASET;
// Frozen recorded source boundaries; not obtained from the shared adapter or compatibility wrappers.
const goals=[
 {period:1,ms:1328687,score:'1 : 0',actor:'statsbomb:40122',ids:['d3c140eb-ec80-43d2-9aca-1ae1d25ef65b']},
 {period:1,ms:1697116,score:'1 : 1',actor:'statsbomb:3347',ids:['132624e5-65f2-405e-9842-d26eaa11e939']},
 {period:1,ms:1789682,score:'2 : 1',actor:'statsbomb:3290',ids:['32124451-ae8e-40b0-82fa-a450314b4e0c','c49d8042-3ef1-4a10-acf9-1e0bc3eec027']},
 {period:2,ms:545606,score:'2 : 2',actor:'statsbomb:20521',ids:['c6449f88-065a-4ed9-a5a3-5b66eea49733']},
];
const elapsed=(period:number,ms:number)=>historical.match.clock.periods.find((p:{period:number})=>p.period===period).playback_start_ms+ms;
async function seek(centre:Locator,ms:number){await centre.getByRole('slider').fill(String(ms));await expect(centre.getByRole('slider')).toHaveValue(String(ms));await expect(centre.locator('[data-unified-transport] p[role=status]')).toHaveCount(0);}
async function openSaved(page:Page,id:string,engine:string){
 await page.goto('/#/library');const prefix=engine==='grf'?'/api/grf/matches':'/api/matches';const list=await(await page.request.get(prefix)).json();const index=list.findIndex((j:{id:string})=>j.id===id);expect(index).toBeGreaterThanOrEqual(0);
 const buttons=page.locator(engine==='grf'?'.grf-history .history-list button':'.history:not(.grf-history) .history-list button');await expect(buttons).toHaveCount(list.length);await buttons.nth(index).click();
 const centre=page.locator(`[data-unified-match-centre][data-source=${engine}]`);await expect(centre).toBeVisible();await expect3D(centre);await expect(centre.locator('..')).toHaveAttribute('data-match-id',id);return centre;
}
test.beforeEach(async({page,context})=>{
 await context.addCookies([{name:'timepitch_session',value:auth.cookie,url:'http://127.0.0.1:18079',httpOnly:true,sameSite:'Strict'}]);
 await prefer3D(page);
 await page.route('**/api/**',route=>{if(route.request().method()!=='GET')throw new Error('Read-only acceptance forbids '+route.request().method()+' '+new URL(route.request().url()).pathname);return route.continue();});
});

test('recorded3754078 full playback, exact goals, substitutions and source evidence',async({page},info)=>{
 expect(historical.match.final_score).toEqual({home:2,away:2});expect(historical.statistics.goals.map((g:{event_ids:string[]})=>g.event_ids)).toEqual(goals.map(g=>g.ids));
 for(const g of goals){const rows=historical.goal_events.filter((e:{id:string})=>g.ids.includes(e.id));expect(rows.map((e:{id:string})=>e.id)).toEqual(g.ids);for(const e of rows){expect(e.period).toBe(g.period);expect(e.period_ms).toBe(g.ms);}expect(rows.some((e:{player_key:string})=>e.player_key===g.actor)).toBe(true);}
 const errors:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/historical/'))requests.push(r.url());});
 await page.goto('/#/reconstruction/3754078');const centre=page.locator('[data-source=historical][data-unified-match-centre]'),score=centre.locator('[data-unified-scoreboard] .tp-sb-digits');await expect(centre.getByRole('slider')).toBeEnabled();await expect(score).toHaveText('0–0');
 await expect3D(centre);
 await expect(centre.locator('.unified-provenance')).toContainText('synthetic tracking');await expect(centre.locator('canvas')).toHaveAttribute('data-renderer','stylized-3d-1');await expect(centre.getByRole('group',{name:'Speed',exact:true}).getByRole('button',{name:'1×',exact:true})).toHaveAttribute('aria-pressed','true');
 const start=Date.now();await centre.getByRole('group',{name:'Speed',exact:true}).getByRole('button',{name:'120×',exact:true}).click();await centre.getByRole('button',{name:'Play',exact:true}).click();await expect(centre.getByRole('combobox',{name:'Phase',exact:true})).toHaveValue('2',{timeout:180000});await expect(centre.getByRole('slider')).toHaveValue(String(historical.manifest.duration_ms),{timeout:180000});
 await expect(score).toHaveText('2 : 2');await expect(centre.getByRole('button',{name:'Play',exact:true})).toBeDisabled();await expect(centre.getByRole('tab',{name:'Match',exact:true})).toHaveAttribute('aria-selected','true');
 const playbackWall=Date.now()-start;writeFileSync(join(root!,'historical-playback-checkpoint.json'),JSON.stringify({wall_ms:playbackWall,score:[2,2],full_playback:true,duration_ms:historical.manifest.duration_ms}));
 const milestone=centre.getByRole('region',{name:'Reached milestones'});await expect(milestone.locator('li')).toHaveCount(4);
 const players=new Map<string,string>(historical.match.lineups.flatMap((l:{players:{key:string;name:string}[]})=>l.players.map(p=>[p.key,p.name])));
 for(let i=0;i<goals.length;i++){await milestone.locator('li button').nth(i).click();const detail=centre.locator('.unified-event-detail');for(const ref of goals[i].ids)await expect(detail.locator('code').filter({hasText:ref})).toBeVisible();await expect(detail.getByRole('button',{name:players.get(goals[i].actor),exact:true})).toBeVisible();if(i===2)await expect(detail).toContainText('own_goal');}
 await centre.getByRole('tab',{name:'Summary',exact:true}).click();await expect(centre.locator('.unified-scope')).toContainText('Final · independent of playback');await expect(centre.getByText(/Final result: 2 : 2/)).toBeVisible();
 await centre.getByRole('combobox',{name:'Analysis scope'}).selectOption('cursor');await centre.getByRole('tab',{name:'Match',exact:true}).click();
 let prior='0 : 0';
 for(const g of goals){const ms=elapsed(g.period,g.ms);await seek(centre,ms-1);await expect(score).toHaveText(prior);await seek(centre,ms);await expect(score).toHaveText(g.score);await seek(centre,ms+1);await expect(score).toHaveText(g.score);prior=g.score;}
 for(const change of historical.statistics.substitutions){
  const ms=elapsed(change.at.period,change.at.period_ms);await seek(centre,ms);const ref=historical.manifest.segments.find((s:{period:number;from_ms:number;to_ms:number})=>s.period===change.at.period&&s.from_ms<=change.at.period_ms&&s.to_ms>change.at.period_ms);
  const raw=JSON.parse(readFileSync(join(dataset!,'3754078',`${ref.period}-${ref.index}.json`),'utf8'));const frame=raw.frames.filter((f:{period_ms:number})=>f.period_ms<=change.at.period_ms).at(-1);
  const expected=frame.players.map((p:number[])=>'historical:'+historical.manifest.roster.find((r:{index:number})=>r.index===p[0]).key).sort();
  await expect.poll(async()=>centre.getByRole('combobox',{name:'Inspect player',exact:true}).locator('option').evaluateAll(nodes=>nodes.map(n=>(n as HTMLOptionElement).value).filter(Boolean).sort())).toEqual(expected);
  const list=centre.locator('[data-unified-events]');await list.getByRole('combobox',{name:'Event type'}).selectOption('Substitution');const candidates=list.locator(':scope > .unified-event-list button');await expect(candidates.first()).toBeVisible();for(let i=0;i<await candidates.count();i++){await candidates.nth(i).click();const text=await centre.locator('.unified-event-detail').textContent();if(change.event_ids.every((id:string)=>text!.includes(id)))break;}for(const id of change.event_ids)await expect(centre.locator('.unified-event-detail')).toContainText(id);await list.getByRole('combobox',{name:'Event type'}).selectOption('');
 }
 await seek(centre,0);await expect(score).toHaveText('0 : 0');await expect(centre.getByText('Discontinuities',{exact:false}).first()).toBeVisible();await centre.getByLabel('Synthetic movement',{exact:true}).uncheck();await expect(centre.getByRole('img',{name:'Recorded anchors',exact:true})).toBeVisible();await centre.getByLabel('Synthetic movement',{exact:true}).check();
 await centre.getByRole('tab',{name:'Effort',exact:true}).click();await expect(centre.getByText(/No measured tracking/)).toBeVisible();await expect(centre.getByRole('table')).toHaveCount(0);await centre.getByRole('tab',{name:'Data',exact:true}).click();await expect(centre.locator('.unified-data > p').filter({hasText:historical.manifest.dataset_version})).toBeVisible();
 for(const url of requests.filter(u=>u.includes('/events?'))){const q=new URL(url).searchParams;expect(Number(q.get('to_ms'))-Number(q.get('from_ms'))).toBeLessThanOrEqual(60000);}
 expect(errors).toEqual([]);const result={full_playback_wall_ms:playbackWall,whole_flow_wall_ms:Date.now()-start,source_score:[2,2],duration_ms:historical.manifest.duration_ms,goal_boundaries:goals.length,substitutions:historical.statistics.substitutions.length,segment_reads:requests.filter(u=>u.includes('/segments/')).length,events_reads:requests.filter(u=>u.includes('/events?')).length,statistics_reads:requests.filter(u=>u.includes('/statistics?')).length,js_errors:errors};writeFileSync(join(root!,'historical-ui-result.json'),JSON.stringify(result,null,2));await info.attach('recorded-acceptance',{body:JSON.stringify(result),contentType:'application/json'});
});

test('existing saved viewers retain source result, export hash and ownership through the common screen',async({page,request},info)=>{
 const results=[];
 for(const item of Object.values(auth.saved) as {id:string;engine:string;schema:string;trace_hash:string}[]){
  const centre=await openSaved(page,item.id,item.engine);await expect(centre.getByRole('button',{name:'Play',exact:true})).toBeVisible();await expect(centre.getByRole('group',{name:'Speed',exact:true}).getByRole('button',{name:'1×',exact:true})).toHaveAttribute('aria-pressed','true');
  const prefix=item.engine==='grf'?'/api/grf/matches':'/api/matches',download=await page.request.get(`${prefix}/${item.id}/replay`);expect(download.ok()).toBe(true);expect((await download.json()).trace_hash).toBe(item.trace_hash);expect((await request.get(`${prefix}/${item.id}/replay`)).status()).toBe(404);
  const max=Number(await centre.getByRole('slider').getAttribute('max'));await seek(centre,max);const expected=item.engine==='grf'?(await download.json()).samples.at(-1).score:undefined;
  if(expected)await expect(centre.locator('[data-unified-scoreboard] .tp-sb-digits')).toHaveText(`${expected[0]}–${expected[1]}`);
  await centre.getByRole('tab',{name:'Summary',exact:true}).click();await expect(centre.locator('.unified-scope')).toContainText('Final · independent of playback');
  await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Reconstruction',exact:true}).click();await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Simulation',exact:true}).click();await expect(centre.getByRole('slider')).toHaveValue(String(max));results.push({schema:item.schema,engine:item.engine,trace_hash:item.trace_hash});
 }
 writeFileSync(join(root!,'saved-ui-result.json'),JSON.stringify(results));await info.attach('saved-acceptance',{body:JSON.stringify(results),contentType:'application/json'});
});

async function structure(centre:Locator){return centre.evaluate(root=>({
 screen:root.className,scoreboards:root.querySelectorAll('[data-unified-scoreboard]').length,transports:root.querySelectorAll('[data-unified-transport]').length,eventExplorers:root.querySelectorAll('[data-unified-events]').length,
 tabs:Array.from(root.querySelectorAll('[role=tab]')).map(n=>n.textContent),
 transportNodes:Array.from(root.querySelector('[data-unified-transport]')!.children).map(n=>n.tagName),
 speeds:Array.from(root.querySelector('[data-unified-transport] select')!.children).map(n=>(n as HTMLOptionElement).value),renderer:root.querySelector('canvas')?.getAttribute('data-renderer'),
}));}

test('sole ordinary generated GRF result is inspected without executing it again',async({page,request},info)=>{
 const launch=read('launch.json');test.skip(launch.state!=='ready','Requires the separately submitted single ordinary job; never launches from this test.');
 await page.context().addCookies([{name:'timepitch_session',value:launch.recovered_session_cookie??auth.cookie,url:'http://127.0.0.1:18079',httpOnly:true,sameSite:'Strict'}]);
 const centre=await openSaved(page,launch.job_id,'grf');const commonStructure=await structure(centre);const record=read('new-grf.json');await expect(centre.locator('[data-unified-transport]')).toHaveCount(1);await expect(centre.getByRole('tab')).toHaveCount(6);await expect(centre.locator('canvas')).toHaveAttribute('data-renderer','stylized-3d-1');
 expect(record.input.config.seed).toBe(42);expect(record.input.config.home_key).toBe('chelsea:2015');expect(record.input.config.away_key).toBe('swansea:2015');expect(record.native_binary_sha256).toBe(launch.native_sha256);expect(record.completion_reason).toBe('full_time');
 await seek(centre,record.duration_ms);await expect(centre.locator('[data-unified-scoreboard] .tp-sb-digits')).toHaveText(`${record.samples.at(-1).score[0]}–${record.samples.at(-1).score[1]}`);await centre.getByRole('tab',{name:'Summary',exact:true}).click();await expect(centre.locator('.unified-scope')).toContainText('Final · independent of playback');
 await centre.getByRole('tab',{name:'Maps',exact:true}).click();await expect(centre.locator('[data-plot-id=shots]')).toBeVisible();await centre.getByRole('tab',{name:'Effort',exact:true}).click();const distance=centre.locator('[data-metric-id=distance_m]').first();await distance.locator('summary').click();await expect(distance).toContainText('compressed_clock_is_not_full_match_tracking');
 expect((await request.get(`/api/grf/matches/${launch.job_id}/replay`)).status()).toBe(404);
 await page.goto('/#/reconstruction/3754078');const historicalCentre=page.locator('[data-source=historical][data-unified-match-centre]');await expect(historicalCentre.getByRole('slider')).toBeEnabled();await seek(historicalCentre,0);expect(await structure(historicalCentre)).toEqual(commonStructure);await seek(historicalCentre,historical.manifest.duration_ms);await expect(historicalCentre.locator('[data-unified-scoreboard] .tp-sb-digits')).toHaveText('2–2');
 const result={recorded_score:[2,2],simulated_score:record.samples.at(-1).score,seed:42,engine:record.engine_version,trace_hash:record.trace_hash,distinct_outcomes_preserved:true};writeFileSync(join(root!,'new-grf-ui-result.json'),JSON.stringify(result));await info.attach('comparison',{body:JSON.stringify(result),contentType:'application/json'});
});
