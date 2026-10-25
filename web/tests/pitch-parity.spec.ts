import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {unifiedFixture,openUnified} from './unified-fixtures';
import {expect3D,prefer3D} from './pitch-renderer-checks';
const savedRoot=process.env.TIMEPITCH_ACCEPTANCE_SAVED_DIR;


test('recorded and simulated modes share the 3D presentation and camera controls',async({page},info)=>{
  test.skip(!savedRoot,'Uses explicit existing replay copies, never generates matches.');
  await prefer3D(page);
  const viewport=page.viewportSize()!;
  const measure=async(selector:string)=>page.locator(selector).evaluate(n=>({
    width:n.querySelector('canvas')!.getBoundingClientRect().width,
    cameraFont:getComputedStyle(n.querySelector('.pitch-toolbar label')!).fontSize,
    inspectorFont:getComputedStyle(n.querySelector('.pitch-inspector label')!).fontSize,
    cameraSelectFont:getComputedStyle(n.querySelector('.pitch-toolbar select')!).fontSize,
    inspectorSelectFont:getComputedStyle(n.querySelector('.pitch-inspector select')!).fontSize,
    inspectorNoteMargin:getComputedStyle(n.querySelector('.pitch-inspector p')!).margin,
    cameraNoteMargin:getComputedStyle(n.querySelector('.camera-note')!).margin,
  }));
  const forbidden:string[]=[];
  await page.route('**/api/**',r=>{if(r.request().method()==='POST'){forbidden.push(new URL(r.request().url()).pathname);return r.fulfill({status:403,json:{detail:'No generation in visual acceptance'}});}return r.continue();});
  const saved=Object.fromEntries(['timepitch','grf'].map(engine=>[engine,JSON.parse(readFileSync(join(savedRoot!,`saved-${engine}.json`),'utf8'))]));
  for(const engine of ['timepitch','grf']){
    const {job,record,statistics}=saved[engine],prefix=engine==='grf'?'/api/grf/matches':'/api/matches';
    await page.route(`**${prefix}`,r=>r.fulfill({json:[job]}));
    await page.route(`**${prefix}/${job.id}`,r=>r.fulfill({json:job}));
    await page.route(`**${prefix}/${job.id}/replay`,r=>r.fulfill({json:record}));
    await page.route(`**${prefix}/${job.id}/statistics*`,r=>r.fulfill({json:statistics}));
    if(engine==='timepitch')await page.route(`**${prefix}/${job.id}/windows`,r=>r.fulfill({json:[]}));
  }
  await page.goto('/#/reconstruction/3754078');
  const recorded=page.locator('[data-source=historical]'),canvas=recorded.locator('canvas');
  await expect3D(recorded);
  await recorded.getByRole('combobox',{name:'Camera',exact:true}).selectOption('follow');
  await expect(canvas).toHaveAttribute('data-camera','follow');
  await expect(recorded.getByRole('combobox',{name:'Camera',exact:true})).toHaveValue('follow');
  await expect(recorded.getByRole('combobox',{name:'Inspect player',exact:true})).toBeVisible();
  await page.getByRole('slider',{name:'Match position'}).fill('45000');
  await page.screenshot({path:info.outputPath('reconstruction-follow.png'),fullPage:true});
  const style=await canvas.evaluate(n=>({width:n.getAttribute('width'),height:n.getAttribute('height'),ratio:getComputedStyle(n).aspectRatio,pixels:getComputedStyle(n).imageRendering}));
  const presentation=await measure('[data-source=historical] .pitch-section');
  const responsive:Record<number,typeof presentation>={};
  for(const width of [320,768,800,801,900,1024,1100,1440]){
    await page.setViewportSize({width,height:950});responsive[width]=await measure('[data-source=historical] .pitch-section');
  }
  await page.setViewportSize(viewport);
  await recorded.getByRole('combobox',{name:'Camera',exact:true}).selectOption('overview');
  await expect(canvas).toHaveAttribute('data-camera','overview');
  await page.getByLabel('Synthetic movement').uncheck();
  await expect(page.getByRole('img',{name:'Recorded anchors',exact:true})).toBeVisible();
  await expect(page.locator('[data-source=historical] .unified-provenance')).toContainText('Recorded events · synthetic tracking');
  await page.getByLabel('Synthetic movement').check();
  for(const engine of ['timepitch','grf']){
    await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Library',exact:true}).click();
    const history=engine==='grf'?'.grf-history':'.history:not(.grf-history)';
    await page.locator(`${history} .history-list`).getByRole('button').first().click();
    const view=page.locator(engine==='grf'?'[data-source=grf]':'[data-source=timepitch]'),simulated=view.locator('canvas');
    await expect3D(view);
    await view.getByRole('combobox',{name:'Camera',exact:true}).selectOption('follow');
    await expect(simulated).toHaveAttribute('data-camera','follow');
    const selector=engine==='grf'?'[data-source=grf] .pitch-section':'[data-source=timepitch] .pitch-section';
    const actual=await measure(selector);
    await info.attach(`${engine}-actual-presentation`,{body:JSON.stringify({reconstruction:presentation,simulation:actual}),contentType:'application/json'});
    await page.screenshot({path:info.outputPath(`${engine}-follow.png`),fullPage:true});
    expect(actual).toEqual(presentation);
    for(const width of [320,768,800,801,900,1024,1100,1440]){
      await page.setViewportSize({width,height:950});expect(await measure(selector)).toEqual(responsive[width]);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.setViewportSize(viewport);
    expect(await simulated.evaluate(n=>({width:n.getAttribute('width'),height:n.getAttribute('height'),ratio:getComputedStyle(n).aspectRatio,pixels:getComputedStyle(n).imageRendering}))).toEqual(style);
    await expect(view.getByRole('combobox',{name:'Inspect player',exact:true})).toBeVisible();
  }
  await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Reconstruction',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-camera','overview');
  for(const width of [320,768,1440]){await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  expect(forbidden).toEqual([]);
});

for(const locale of ['en','es'])for(const color of ['light','dark'] as const)test(`full shared surface parity ${locale} ${color}`,async({page},info)=>{
  await prefer3D(page);const f=await unifiedFixture(page);await page.addInitScript(l=>localStorage.setItem('timepitch.locale',l),locale);await page.emulateMedia({colorScheme:color,reducedMotion:'reduce'});
  const measurements:Record<string,unknown[]>={};
  for(const source of ['historical','grf','timepitch']){
    const centre=await openUnified(page,source);measurements[source]=[];
    await expect3D(centre);
    for(const width of [320,390,768,800,801,1024,1440]){
      await page.setViewportSize({width,height:1000});
      // TP206: since TP205 the note under the player picker only appears when the source has no real shirt numbers,
      // so whole-section heights legitimately differ by source; compare the pitch surface and the picker control instead.
      const sizes=await centre.evaluate(root=>{
        // TP224: the scoreboard's meta line shows «Playback elapsed» only for sources without a football clock (GRF,
        // TimePitch), so at 320/390 px it wraps one more line than historical; compare the shared scorebug itself.
        const keys=['[data-unified-scoreboard] .tp-scorebug','[data-unified-transport]','[role=tablist]','.pitch-surface','canvas','.pitch-toolbar','.pitch-inspector label'];
        return keys.map(key=>{const e=root.querySelector<HTMLElement>(key)!,r=e.getBoundingClientRect(),s=getComputedStyle(e);return {key,width:r.width,height:r.height,font:s.fontFamily,size:s.fontSize,lineHeight:s.lineHeight};});
      });measurements[source].push(sizes);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    }
  }
  expect(measurements.grf).toEqual(measurements.historical);expect(measurements.timepitch).toEqual(measurements.historical);
  await info.attach('shared-surfaces',{body:JSON.stringify(measurements),contentType:'application/json'});expect(f.forbidden).toEqual([]);expect(f.unexpected).toEqual([]);f.assertImmutable();
});
