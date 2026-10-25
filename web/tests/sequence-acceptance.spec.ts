import { test,expect,type Page,type Locator } from '@playwright/test';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { graphicsGate,graphicsProbe,gpuIdentity,readProbe,overviewPoint } from './pitch-renderer-checks';

const path=process.env.TIMEPITCH_SEQUENCE_MANIFEST;
// TP224: without the private saved sequence the whole file is skipped (no substitute), instead of failing to load and
// breaking every other spec in the same run. With it, the protected hashes are still checked before any test.
test.skip(!path,'Private saved-sequence acceptance: set TIMEPITCH_SEQUENCE_MANIFEST (no substitute).');
const manifest=path?JSON.parse(readFileSync(path,'utf8')):null,sources=manifest?JSON.parse(readFileSync(manifest.source_manifest,'utf8')):null;
const auth=manifest?JSON.parse(readFileSync(manifest.auth_path,'utf8')):null;
const from=1684024,to=1697850,uri='/#/reconstruction/3754078?sequence=ayew-equaliser-1';
// TP224: since TP200 the football clock is in the broadcast scorebug: time in `.tp-sb-t`, half/full time in `.tp-sb-half`.
const clockText=(centre:Locator)=>centre.locator('.unified-scoreboard .tp-sb-t'),phaseText=(centre:Locator)=>centre.locator('.unified-scoreboard .tp-sb-half');
if(manifest)for(const [path,hash] of Object.entries(manifest.protected))expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);

// Test-only read of confirmed Pitch props, not a production global or a second sampler.
// This distinguishes an actual published cursor from the range input's pending seek value.
async function presented(centre:Locator){
  return centre.locator('.pitch-canvas-container').evaluate(node=>{
    type Fiber={memoizedProps?:Record<string,unknown>;return?:Fiber;alternate?:Fiber;stateNode?:{current?:Fiber}};
    let fiber=(node as unknown as Record<string,unknown>)[Object.keys(node).find(k=>k.startsWith('__reactFiber$'))!] as Fiber|undefined;
    let root=fiber;while(root?.return)root=root.return;
    if(root?.stateNode?.current!==root)fiber=fiber?.alternate??fiber;
    while(fiber){const p=fiber.memoizedProps;
      if(p?.frame&&p.previous&&'displayClockLabel' in p){const frame=p.frame as {clock_ms:number;period:number;ball:{x:number;y:number}|null;players:{key:string;x:number;y:number}[];score:unknown};return {frame,cue:p.cue??null,active:p.active,focus:p.fieldFocus??null,clock:p.displayClockLabel};}
      fiber=fiber.return;
    }
    throw new Error('Confirmed shared Pitch props unavailable');
  });
}
async function prepare(page:Page,baseURL:string,route=uri){
  const gate=await graphicsGate(page,baseURL);await graphicsProbe(page);
  await page.context().addCookies([{name:'timepitch_session',value:auth.saved,url:baseURL,httpOnly:true,sameSite:'Strict'}]);
  await page.goto(route);const centre=page.locator('[data-unified-match-centre][data-source=historical]');
  await expect(centre.getByRole('button',{name:'Replay sequence'})).toBeVisible();
  await expect(centre.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  if(route===uri){await expect(centre.locator('.pitch-section')).toHaveAttribute('data-effective-renderer','stylized-3d-1');await expect(centre.locator('.pitch-section')).toHaveAttribute('data-renderer-status','ready');}
  return {centre,gate};
}
async function seek(centre:Locator,ms:number){
  await centre.getByRole('slider').fill(String(ms));
  await expect.poll(async()=> (await presented(centre)).frame.clock_ms).toBe(ms);
  await expect(centre.locator('.unified-scoreboard')).toBeVisible();
}
async function checkGate(gate:Awaited<ReturnType<typeof graphicsGate>>){expect(gate.forbidden).toEqual([]);expect(gate.external).toEqual([]);expect(gate.errors).toEqual([]);}
async function facts(page:Page){
  const values=[];
  for(const path of ['/api/historical/matches/3754078','/api/historical/matches/3754078/events?period=1&from_ms=1682024&to_ms=1699850','/api/historical/matches/3754078/statistics?period=1&at_ms=1695328']){
    const response=await page.request.get(path);expect(response.ok()).toBe(true);values.push(await response.json());
  }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

if(process.env.TIMEPITCH_SEQUENCE_BASELINE==='1'){
  test('pilot surface is required on the retained baseline',async({page})=>{
    await page.goto(uri);await expect(page.getByRole('button',{name:'Replay sequence'})).toBeVisible({timeout:5000});
  });
}else{
  test('desktop/mobile layout fits the viewport and keeps primary viewing controls together',async({page,baseURL},info)=>{
    const {centre,gate}=await prepare(page,baseURL!);await page.screenshot({path:join(info.outputDir,'actual-layout.png'),fullPage:true});
    const geometry=await centre.evaluate(root=>({viewport:{width:innerWidth,height:innerHeight},scrollWidth:document.documentElement.scrollWidth,
      boxes:[...root.querySelectorAll('.unified-scoreboard,.pitch-canvas-container,.sequence-transport,.sequence-card')].map(e=>{const b=e.getBoundingClientRect();return {class:e.className,x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom};})}));
    await info.attach('layout',{body:JSON.stringify(geometry,null,2),contentType:'application/json'});
    await checkGate(gate);expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport.width);
    if(info.project.name==='desktop')expect(geometry.boxes.every(b=>b.bottom<=900)).toBe(true);
    if(info.project.name==='desktop')expect(geometry.boxes.find(b=>b.class==='pitch-canvas-container')!.height).toBeGreaterThanOrEqual(400);
    for(const ms of [1695328,to]){
      await seek(centre,ms);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(geometry.viewport.width);
      if(info.project.name==='desktop')for(const box of await centre.locator('.sequence-transport,.sequence-card').all())expect((await box.boundingBox())!.y+(await box.boundingBox())!.height).toBeLessThanOrEqual(900);
      const evidence=centre.locator('.sequence-card').getByRole('button',{name:'View evidence'});
      await evidence.focus();await expect(evidence).toBeFocused();
      expect(await evidence.evaluate(e=>{const p=e.closest('.sequence-card')!,a=e.getBoundingClientRect(),b=p.getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom})).toBe(true);
    }
    await centre.getByText('Match details',{exact:true}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(geometry.viewport.width);
    await page.screenshot({path:join(info.outputDir,'details-layout.png'),fullPage:true});await checkGate(gate);
  });
  test('saved V2 exact cursors, source facts, poses, focus and no future DOM',async({page,baseURL},info)=>{
    const {centre,gate}=await prepare(page,baseURL!),before=await facts(page),gpu=await gpuIdentity(centre);
    const times=[...new Set([from,to,...[1685158,1692171,1693655,1694186,1695068,1695328,1697116].flatMap(t=>[t-1,t,t+1])])].sort((a,b)=>a-b);
    const snapshots=new Map<number,unknown>();
    for(const ms of times){
      await seek(centre,ms);const sample=await presented(centre);expect(sample.active).toBe(true);expect(sample.frame.players).toHaveLength(22);expect(new Set(sample.frame.players.map(p=>p.key)).size).toBe(22);expect(sample.frame.ball).not.toBeNull();
      expect(sample.frame.score).toEqual({home:1,away:ms>=1697116?1:0});snapshots.set(ms,sample);
      const ball=sample.frame.ball!,expected=await overviewPoint(centre,ball.x,ball.y),box=(await centre.locator('.pitch-canvas-container').boundingBox())!;
      const halo=centre.locator('.sequence-ball-overlay circle').first();
      expect(Number(await halo.getAttribute('cx'))+box.x).toBeCloseTo(expected.x,1);
      expect(Number(await halo.getAttribute('cy'))+box.y).toBeCloseTo(expected.y,1);
      expect(await centre.innerHTML()).not.toContain('2 : 2');expect(await centre.locator('.unified-scoreboard .tp-sb-digits').textContent()).not.toBe('2–2');
      if(ms<1697116)expect(await centre.innerHTML()).not.toContain('132624e5-65f2-405e-9842-d26eaa11e939');
    }
    for(const ms of [...times].reverse()){await seek(centre,ms);expect(await presented(centre)).toEqual(snapshots.get(ms));}
    await seek(centre,1693655);expect((await presented(centre)).cue).toMatchObject({type:'shot',bodyPart:'head'});
    await seek(centre,1695068);expect((await presented(centre)).cue).toMatchObject({type:'shot',bodyPart:'left_foot'});
    await seek(centre,1695328);await expect(centre.locator('.sequence-card')).toContainText('Cahill');await expect(centre.locator('.sequence-card')).toContainText('0.263');
    await info.attach('actual-gpu',{body:JSON.stringify({gpu,sourceDigest:'2448bed73cb06c3fbaf2df69b31e6af208afc38a909128b887740428f3b04944',times,sourceFactHash:before,probe:await readProbe(page)}),contentType:'application/json'});
    expect(await facts(page)).toBe(before);expect(await centre.locator('canvas').count()).toBe(1);await checkGate(gate);
  });
  test('three playback rates, pause/replay/next, settings and keyboard inspector retain one field',async({page,baseURL},info)=>{
    const {centre,gate}=await prepare(page,baseURL!);const results=[];
    for(const rate of [.5,1,2]){
      await centre.getByRole('button',{name:'Replay sequence'}).click();await seek(centre,from);
      await centre.getByRole('combobox',{name:'Speed',exact:true}).selectOption(String(rate));
      const started=Date.now();await centre.getByRole('button',{name:'Play',exact:true}).click();
      await expect.poll(async()=>Number(await centre.getByRole('slider').inputValue()),{timeout:45000}).toBe(to);
      await expect.poll(async()=>(await presented(centre)).frame.clock_ms).toBe(to);
      expect((await presented(centre)).frame.score).toEqual({home:1,away:1});results.push({rate,wallMs:Date.now()-started,from,to});
    }
    await centre.getByRole('button',{name:'Replay sequence'}).click();await seek(centre,from);
    await centre.getByRole('button',{name:'Next moment',exact:true}).click();await expect.poll(async()=>(await presented(centre)).frame.clock_ms).toBeGreaterThan(from);await expect(centre.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
    await seek(centre,1695328);await centre.locator('.sequence-card').getByRole('button',{name:'Gary Cahill'}).focus();await page.keyboard.press('Enter');await expect(centre.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
    await centre.getByText('Match details',{exact:true}).click();await centre.getByText('Display settings',{exact:true}).click();await page.waitForTimeout(150);const reads=gate.api.length;
    await centre.getByRole('combobox',{name:'Camera',exact:true}).selectOption('follow');await centre.getByRole('combobox',{name:'Camera',exact:true}).selectOption('overview');
    expect(gate.api.slice(reads)).toEqual([]);expect(await centre.locator('canvas').count()).toBe(1);await checkGate(gate);
    await info.attach('rate-schedules',{body:JSON.stringify(results),contentType:'application/json'});
  });
  test('ordinary historical and saved GRF stay independent of the opt-in pilot',async({page,baseURL},info)=>{
    const gate=await graphicsGate(page,baseURL!);await graphicsProbe(page);
    await page.context().addCookies([{name:'timepitch_session',value:auth.grf,url:baseURL!,httpOnly:true,sameSite:'Strict'}]);
    await page.goto('/#/reconstruction/3754078');const historical=page.locator('[data-unified-match-centre][data-source=historical]');await expect(historical.getByRole('tab')).toHaveCount(6);await expect(historical.locator('.sequence-card')).toHaveCount(0);
    await page.goto('/#/library');const response=await page.request.get('/api/grf/matches');expect(response.ok()).toBe(true);const rows=await response.json();const index=rows.findIndex((r:{id:string})=>r.id===sources.sources.grf.id);expect(index).toBeGreaterThanOrEqual(0);
    await page.locator('.grf-history .history-list button').nth(index).click();const grf=page.locator('[data-unified-match-centre][data-source=grf]');await expect(grf).toBeVisible();await expect(grf.getByRole('tab')).toHaveCount(6);await expect(grf.locator('canvas')).toHaveCount(1);
    const replay=await page.request.get(`/api/grf/matches/${sources.sources.grf.id}/replay`);expect(replay.ok()).toBe(true);
    await info.attach('saved-grf',{body:JSON.stringify({id:sources.sources.grf.id,replayHash:createHash('sha256').update(await replay.body()).digest('hex')}),contentType:'application/json'});await checkGate(gate);
  });
  test('unavailable action source is explicit rather than another engine or a silent scene',async({page,baseURL})=>{
    await page.route('**/api/historical/matches/3754078/reconstruction/segments/**',route=>route.abort());
    const gate=await graphicsGate(page,baseURL!);await page.goto(uri);
    await expect(page.getByText(/Sequence preview unavailable/)).toBeVisible();await expect(page.locator('.sequence-card')).toHaveCount(0);await checkGate(gate);
  });
  test('final source football clock is inspectable separately from the main clip',async({page,baseURL},info)=>{
    const gate=await graphicsGate(page,baseURL!);await page.goto('/#/reconstruction/3754078');
    const centre=page.locator('[data-unified-match-centre][data-source=historical]');
    await expect(centre.getByRole('slider')).toBeEnabled();await seek(centre,5851968);
    const actual=`${await phaseText(centre).innerText()} · ${await clockText(centre).innerText()}`;
    await info.attach('final-source-clock',{body:JSON.stringify({actual,expectedFootballClock:'90+04:31',sourceElapsedMs:5851968,sourceSecondPeriodMs:2971473}),contentType:'application/json'});
    await checkGate(gate);expect(actual).toBe('Full time · 90+04:31');
    expect((await presented(centre)).clock).toBe('90+04:31');
    await seek(centre,2880495);await expect(phaseText(centre)).toHaveText('2nd half');await expect(clockText(centre)).toHaveText('45:00');
    expect((await presented(centre)).clock).toBe('45:00');
  });
  test('record sequence and half-time for review @desktop-record',async({browser,baseURL},info)=>{
    test.setTimeout(150000);mkdirSync(manifest.clips,{recursive:true});const summaries=[];
    // Record the actual desktop acceptance viewport; failed TP148 tall recordings stay separate.
    for(const kind of ['sequence','halftime']){
      const context=await browser.newContext({baseURL,viewport:{width:1440,height:900},colorScheme:'dark',serviceWorkers:'block',recordVideo:{dir:manifest.clips,size:{width:1440,height:900}}});
      const page=await context.newPage(),video=page.video()!;const {centre,gate}=await prepare(page,baseURL!,kind==='sequence'?uri:'/#/reconstruction/3754078?sequence=halftime-check-1');
      const started=Date.now(),samples:{wallMs:number;slider:number;clock:string|null}[]=[];
      if(kind==='sequence'){
        await seek(centre,from);await centre.getByRole('button',{name:'Play',exact:true}).click();
        for(let n=0;n<100;n++){await page.waitForTimeout(200);const cursor=Number(await centre.getByRole('slider').inputValue());samples.push({wallMs:Date.now()-started,slider:cursor,clock:await clockText(centre).textContent()});if(cursor===to)break;}
        expect(samples.at(-1)?.slider).toBe(to);
        await page.screenshot({path:join(manifest.clips,'sequence-end.png')});
      }else{
        await centre.getByRole('button',{name:'Play',exact:true}).click();await expect(centre.getByRole('button',{name:'Start second half'})).toBeEnabled();
        await expect(clockText(centre)).toHaveText('Half-time');await page.screenshot({path:join(manifest.clips,'halftime.png')});await page.waitForTimeout(1000);
        await centre.getByRole('button',{name:'Start second half'}).click();await expect(clockText(centre)).toHaveText('45:00');await page.screenshot({path:join(manifest.clips,'second-half-start.png')});
        await page.waitForTimeout(2000);
        await centre.getByRole('slider').fill('2878495');await expect(phaseText(centre)).toHaveText('1st half');
        await centre.getByRole('button',{name:'Play',exact:true}).click();
        await page.evaluate(()=>{const until=performance.now()+2500;while(performance.now()<until){/* Deliberately delayed browser tick; source time must stop at the real boundary. */}});
        await expect(centre.getByRole('button',{name:'Start second half'})).toBeEnabled();
        expect((await presented(centre)).frame.clock_ms).toBe(2880495);
      }
      await checkGate(gate);summaries.push({kind,wallMs:Date.now()-started,samples,viewport:{width:1440,height:900},includesSetupFrames:true,diagnosticViewport:false});
      await context.close();await video.saveAs(join(manifest.clips,`${kind}-ui.webm`));
    }
    writeFileSync(join(dirname(path!),'recordings.json'),JSON.stringify(summaries,null,2)+'\n');await info.attach('recordings',{body:JSON.stringify(summaries),contentType:'application/json'});
  });
}
