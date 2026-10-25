import {test,expect,type Page} from '@playwright/test';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {testBase} from '../playwright.config';

const candidate=process.env.TIMEPITCH_ACCEPTANCE_SAVED_DIR;
const savedRoot=candidate&&existsSync(join(candidate,'selected.json'))?candidate:undefined;
test.skip(!savedRoot,'Requires explicitly prepared private saved copies; never generates matches.');
const selection=(savedRoot?JSON.parse(readFileSync(join(savedRoot,'selected.json'),'utf8')):{match_ids:[]}) as {match_ids:number[]};
const auth=(savedRoot?JSON.parse(readFileSync(join(savedRoot,'browser-auth.json'),'utf8')):{cookie:'',saved:{}}) as {cookie:string;saved:Record<string,{id:string;trace_hash:string}>};
const violations=new WeakMap<Page,string[]>();
test.beforeEach(async({page,context})=>{
  await context.addCookies([{name:'timepitch_session',value:auth.cookie,url:testBase,httpOnly:true,sameSite:'Strict'}]);
  violations.set(page,[]);
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='POST'&&path!=='/api/replays/import'){
      violations.get(page)!.push(path);return route.fulfill({status:403,json:{detail:'Acceptance forbids generation'}});
    }
    return route.continue();
  });
});
test.afterEach(async({page})=>{expect(violations.get(page)).toEqual([]);});

for(const id of selection.match_ids)test(`recorded ${id}: archive, playback, evidence, final analysis and independent simulation`,async({page},info)=>{
  const match=(await (await page.request.get(`/api/historical/matches/${id}`)).json());
  const last=match.clock.periods.at(-1);
  const final=await (await page.request.get(`/api/historical/matches/${id}/statistics?period=${last.period}&at_ms=${last.duration_ms}`)).json();
  await page.goto(`/#/reconstruction?season=${match.season_id}`);
  // Explicit archive selection uses the actual source team ID and recorded date.
  await page.getByRole('combobox',{name:'Season',exact:true}).selectOption(String(match.season_id));
  await page.getByRole('combobox',{name:'All teams',exact:true}).selectOption(String(match.home_team.source_id));
  const row=page.locator('.archive-row').filter({hasText:match.date}).filter({hasText:match.away_team.name});
  await row.click();
  await expect(page).toHaveURL(new RegExp(`reconstruction/${id}`));
  await expect(page.locator('[data-source=historical] [data-unified-scoreboard]')).toContainText(match.home_team.name);
  await expect(page.locator('[data-source=historical] .unified-provenance')).toContainText('Recorded events · synthetic tracking');
  const range=page.getByRole('slider',{name:'Match position',exact:true});
  await expect(page.locator('[data-source=historical] [data-unified-scoreboard] .tp-sb-digits')).toHaveText('0–0');
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Pause',exact:true}).click();await range.fill('45000');
  const events=page.locator('[data-unified-events]');
  await events.locator('.unified-event-list button').first().click();
  await expect(events.locator('.unified-event-detail')).toBeVisible();
  await expect(events.locator('.unified-event-detail')).toContainText('source_recorded');
  await page.getByLabel('Synthetic movement').uncheck();
  await expect(page.getByRole('img',{name:'Recorded anchors',exact:true})).toBeVisible();
  await expect(events.locator('.unified-event-detail')).toBeVisible();
  await page.getByLabel('Synthetic movement').check();
  await page.getByRole('tab',{name:'Players',exact:true}).click();await expect(page.getByRole('table').first()).toBeVisible();
  // A real recorded substitution, not an invented UI event, is inspected at its cutoff.
  const change=final.substitutions.find((s:{at:{period:number}})=>s.at.period===2);
  expect(change).toBeTruthy();
  const changeMs=match.clock.periods.find((p:{period:number})=>p.period===2).playback_start_ms+Math.ceil(change.at.period_ms/100)*100;
  await page.getByRole('combobox',{name:'Phase',exact:true}).selectOption('2');await range.fill(String(changeMs));
  await page.getByRole('tab',{name:'Match',exact:true}).click();
  await page.locator('[data-unified-events]').getByRole('button',{name:/Substitution/}).first().click();
  await expect(page.locator('.unified-event-detail')).toContainText(change.event_ids[0]);
  await page.getByRole('tab',{name:'Maps',exact:true}).click();
  await expect(page.locator('.unified-maps')).toBeVisible();
  await page.getByRole('tab',{name:'Summary',exact:true}).click();await page.getByRole('button',{name:'Reveal final analysis',exact:true}).click();
  await expect(page.getByText(`Final result: ${match.final_score.home} : ${match.final_score.away} · Final · independent of playback`,{exact:true})).toBeVisible();
  await expect(page.locator('.unified-scope')).toContainText('Final · independent of playback');
  await page.getByRole('tab',{name:'Data',exact:true}).click();await expect(page.getByText(/synthetic-motion-1/).first()).toBeVisible();
  await page.screenshot({path:info.outputPath(`recorded-${id}.png`),fullPage:true});
  await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Library',exact:true}).click();
  await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Reconstruction',exact:true}).click();
  await expect(page.locator('[data-source=historical] [data-unified-scoreboard]')).toContainText(match.home_team.name);
  await expect(range).toHaveValue(String(changeMs));
  await expect(page.getByRole('button',{name:'Simulate this matchup',exact:true})).toHaveCount(0);
  await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Simulation',exact:true}).click();
  await expect(page).toHaveURL(/simulation\/setup/);
  await expect(page.getByRole('complementary',{name:'Historical preparation',exact:true})).toHaveCount(0);
  for(const width of [320,768,1440]){await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});

test('real owned saved viewers export, restore and import without simulating',async({page})=>{
  await page.goto('/#/library');
  for(const engine of ['timepitch','grf']){
    await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Library',exact:true}).click();
    const prefix=engine==='grf'?'.grf-history':'.history:not(.grf-history)';
    await page.locator(`${prefix} .history-list`).getByRole('button').first().click();
    const view=page.locator(engine==='grf'?'[data-source=grf]':'[data-source=timepitch]');await expect(view).toBeVisible();
    const pause=view.getByRole('button',{name:'Pause',exact:true});if(await pause.isVisible())await pause.click();
    const identity=await view.locator('..').getAttribute('data-match-id');expect(identity).toBeTruthy();
    const downloadPromise=page.waitForEvent('download');await view.locator('a[download]').click();
    const download=await downloadPromise,path=await download.path();expect(path).toBeTruthy();
    expect(JSON.parse(readFileSync(path!,'utf8')).trace_hash).toBe(auth.saved[engine].trace_hash);
    await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Reconstruction',exact:true}).click();
    await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Simulation',exact:true}).click();
    await expect(view.locator('..')).toHaveAttribute('data-match-id',identity!);
  }
  await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Library',exact:true}).click();
  const saved=JSON.parse(readFileSync(join(savedRoot!,'saved-timepitch.json'),'utf8'));
  const imported=page.waitForResponse(r=>r.url().endsWith('/api/replays/import')&&r.request().method()==='POST');
  await page.locator('input[type=file]').setInputFiles({name:'saved-replay.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved.record))});
  expect((await imported).status()).toBe(201);
  await expect(page.locator('.history:not(.grf-history) .history-list button').first()).toBeEnabled();
  await page.reload();await expect(page.locator('.history:not(.grf-history) .history-list button').first()).toBeEnabled();
});

test('measured browser cold open and cached visual seek obey bounded read-only playback',async({page},info)=>{
  const paths:string[]=[];page.on('request',r=>{if(r.url().includes('/api/historical/'))paths.push(new URL(r.url()).pathname+new URL(r.url()).search);});
  await page.addInitScript(()=>{
    const watch=()=>{
      const canvas=document.querySelector('[data-source=historical] canvas'),players=document.querySelectorAll('[data-source=historical] .pitch-inspector select option').length;
      const ready=canvas&&players>1&&document.querySelector('.unified-event-list li')&&document.querySelector('[data-source=historical] [data-unified-transport]')&&!document.querySelector('[data-source=historical] [role=alert]')&&document.querySelector('[data-source=historical] [data-unified-scoreboard] .tp-sb-digits')?.textContent==='0–0';
      if(ready)requestAnimationFrame(()=>requestAnimationFrame(()=>Object.assign(window,{__tpUsable:performance.now()})));else requestAnimationFrame(watch);
    };requestAnimationFrame(watch);
  });
  await page.goto('/#/reconstruction/3754217');await page.waitForFunction(()=>('__tpUsable' in window));
  const cold=await page.evaluate(()=>Number((window as unknown as {__tpUsable:number}).__tpUsable));
  const seeks:number[]=[];const segmentReadsBefore=paths.filter(p=>p.includes('/segments/')).length;
  for(const ms of [10000,20000,30000,40000,50000]){
    const elapsed=await page.evaluate(async target=>{
      const range=document.querySelector<HTMLInputElement>('[data-source=historical] input[type=range]')!,canvas=document.querySelector<HTMLCanvasElement>('[data-source=historical] canvas')!;
      const before=canvas.toDataURL(),start=performance.now();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(range,String(target));
      range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise<void>(resolve=>{const tick=()=>{if(canvas.toDataURL()!==before&&range.value===String(target))requestAnimationFrame(()=>resolve());else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
      return performance.now()-start;
    },ms);seeks.push(elapsed);
  }
  const cachedSegmentReads=paths.filter(p=>p.includes('/segments/')).length-segmentReadsBefore;
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(()=>Number(document.querySelector<HTMLInputElement>('[data-source=historical] input[type=range]')?.value)>=52000);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const metrics={cold_open_ms:cold,cached_visual_seek_ms:seeks,cached_segment_network_reads:cachedSegmentReads,segment_requests:paths.filter(p=>p.includes('/segments/')).length,event_window_requests:paths.filter(p=>p.includes('/events?')).length,statistics_requests:paths.filter(p=>p.includes('/statistics?')).length,limits:{cold_ms:2000,seek_ms:200},browser:'fresh context / HTTP cache; OS cache uncontrolled',statistics:'cutoff-labelled, fetched separately; visual seek measures next painted canvas'};
  writeFileSync(info.outputPath('performance.json'),JSON.stringify(metrics,null,2));
  await info.attach('performance.json',{body:JSON.stringify(metrics,null,2),contentType:'application/json'});
  expect(cachedSegmentReads).toBe(0);expect(metrics.segment_requests).toBe(1);expect(metrics.event_window_requests).toBe(1);expect(metrics.statistics_requests).toBeLessThanOrEqual(5);
  expect(cold).toBeLessThanOrEqual(2000);expect(Math.max(...seeks)).toBeLessThanOrEqual(200);
});

test('capability fixture with both new modes disabled retains legacy setup and saved replay',async({page})=>{
  // Negative UI fixture; the real disabled/public backend gate is covered separately.
  await page.route('**/api/historical/capabilities',route=>route.fulfill({json:{two_modes_ui:false,reconstruction_enabled:false,dataset_state:'absent',dataset_version:null,publication_status:'blocked_pending_permission'}}));
  await page.goto('/#/reconstruction/3754217');
  const nav=page.getByRole('navigation',{name:'Workspace'});
  await expect(page.getByRole('button',{name:'Play match',exact:true})).toBeVisible();
  await expect(nav.getByRole('button',{name:'Reconstruction',exact:true})).toHaveCount(0);
  await nav.getByRole('button',{name:'Library',exact:true}).click();
  await page.locator('.history:not(.grf-history) .history-list').getByRole('button').first().click();
  await expect(page.locator('[data-source=timepitch]')).toBeVisible();
});
