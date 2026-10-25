import {test,expect} from '@playwright/test';
import {unifiedFixture,openUnified} from './unified-fixtures';

test('historical provider attribution is served from this application under its unchanged CSP',async({page})=>{
  await unifiedFixture(page);const centre=await openUnified(page,'historical');
  const icon=centre.getByRole('img',{name:'Hudl Statsbomb',exact:true});await expect(icon).toBeVisible();
  const src=await icon.getAttribute('src');expect(src).toMatch(/^\/assets\/statsbomb-.*\.svg$/);
  const response=await page.request.get(src!);expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/svg+xml');
  expect(response.headers()['content-security-policy']).toContain("img-src 'self'");
  await expect.poll(()=>icon.evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

for(const source of ['historical','grf','timepitch'])for(const locale of ['en','es'])for(const color of ['light','dark'] as const){
  test(`unified ${source} ${locale} ${color}`,async({page},info)=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const f=await unifiedFixture(page);
    await page.addInitScript(value=>localStorage.setItem('timepitch.locale',value),locale);await page.emulateMedia({colorScheme:color,reducedMotion:'reduce'});
    const centre=await openUnified(page,source),tabs=centre.getByRole('tab');
    expect(await centre.locator('[data-unified-scoreboard]').count()).toBe(1);expect(await centre.locator('[data-unified-transport]').count()).toBe(1);expect(await centre.locator('[data-unified-events]').count()).toBe(1);
    const play=locale==='en'?'Play':'Reproducir',pause=locale==='en'?'Pause':'Pausar',speed=locale==='en'?'Speed':'Velocidad';
    // TP210: speed is a group of toggle buttons («1×», «20×»…), not a combobox; the pressed one is the current speed.
    const speeds=centre.getByRole('group',{name:speed,exact:true}),rate=(value:string)=>speeds.getByRole('button',{name:`${value}×`,exact:true});
    await expect(centre.getByRole('button',{name:play,exact:true})).toBeEnabled();await expect(rate('1')).toHaveAttribute('aria-pressed','true');
    // TP226: GRF y TimePitch abren en el armazón de emisión (Emisión/Ficha/Alineaciones + Análisis: 7 pestañas, barra bajo
    // el campo). Con movimiento reducido no arrancan solos: hay un botón grande de reproducir sobre el campo.
    const shell=source!=='historical';
    if(shell)await expect(centre.getByRole('button',{name:locale==='en'?'Play the match':'Reproducir el partido'})).toBeVisible();
    await expect(tabs).toHaveCount(shell?7:6);
    const measurements=[];
    for(const width of [320,390,768,800,801,1024,1440]){
      await page.setViewportSize({width,height:1000});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
      const geometry=await centre.evaluate(root=>{
        const rect=(selector:string)=>{const n=root.querySelector(selector)! as HTMLElement,r=n.getBoundingClientRect(),s=getComputedStyle(n);return {width:r.width,height:r.height,font:s.fontFamily,fontSize:s.fontSize};};
        return {pitch:rect('canvas'),transport:rect('[data-unified-transport]'),tabs:rect('[role=tablist]'),scoreboard:rect('[data-unified-scoreboard]')};
      });measurements.push({width,...geometry});
      // El armazón sigue la maqueta (TP210: barra y HUD con controles compactos); la regla de 44 px queda para el histórico.
      if(!shell){const short=await centre.locator('button:visible,select:visible,input:not([type=checkbox]):visible').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height<43.5).map(n=>n.outerHTML.slice(0,80)));expect(short).toEqual([]);}
    }
    await info.attach('geometry',{body:JSON.stringify(measurements),contentType:'application/json'});
    const transport=await centre.locator('[data-unified-transport]').boundingBox(),pitch=await centre.locator('canvas').boundingBox();if(shell)await expect.poll(async()=>{const t=await centre.locator('[data-unified-transport]').boundingBox(),p=await centre.locator('.retro-field').boundingBox();return p!.y+p!.height<t!.y;}).toBe(true);else expect(transport!.y+transport!.height).toBeLessThan(pitch!.y);
    await tabs.first().focus();await page.keyboard.press('End');await expect(tabs.last()).toBeFocused();await page.keyboard.press('Home');await expect(tabs.first()).toBeFocused();
    await centre.getByRole('button',{name:play,exact:true}).click();await centre.getByRole('button',{name:pause,exact:true}).click();
    await centre.getByRole('slider').fill('1000');await expect(centre.getByRole('slider')).toHaveValue('1000');
    const event=centre.locator('[data-unified-events] .unified-event-list button').first();await expect(event).toBeVisible();await event.click();
    await expect(centre.locator('.unified-event-detail')).toBeVisible();await centre.locator('.unified-event-detail').getByRole('button',{name:/Watch event|Ver jugada/}).click();
    await tabs.nth(2).click();if(shell)await centre.locator('[data-lineups-screen] details.tpa-log > summary').click();const player=centre.getByRole('table',{name:/^Players$|^Jugadores$/}).getByRole('button').first();await player.click();await expect(centre.getByRole('dialog')).toBeVisible();await centre.getByRole('dialog').getByRole('button',{name:/Close player detail|Cerrar ficha/}).click();
    const summary=shell?3:1;await tabs.nth(summary).click();await centre.getByRole('button',{name:/Reveal final analysis|Mostrar análisis final/}).click();
    await expect(tabs.nth(summary)).toHaveAttribute('aria-selected','true');
    for(const tab of shell?[1,2,3,4,5,6]:[2,3,4,5]){await tabs.nth(tab).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}
    await tabs.first().click();await rate('20').click();await centre.getByRole('button',{name:/^Replay$|^Repetir$/}).click();await centre.getByRole('button',{name:pause,exact:true}).click();
    await expect(rate('20')).toHaveAttribute('aria-pressed','true');await expect(rate('1')).toHaveAttribute('aria-pressed','false');
    await centre.screenshot({path:info.outputPath('common-match.png')});
    expect(errors).toEqual([]);expect(f.forbidden).toEqual([]);expect(f.unexpected).toEqual([]);f.assertImmutable();
  });
}

test('unified historical resource bounds, cached backward seek and hidden playback pause',async({page})=>{
  const f=await unifiedFixture(page),centre=await openUnified(page,'historical');
  for(const ms of [1000,61000,121000,1000]){await centre.getByRole('slider').fill(String(ms));await expect(centre.getByRole('button',{name:'Play',exact:true})).toBeEnabled();await expect(centre.getByRole('slider')).toHaveValue(String(ms));await expect(centre.getByText(/Buffering/)).toHaveCount(0);}
  expect([...f.segments.values()]).toEqual([1,1,1]);
  await centre.getByRole('button',{name:'Play',exact:true}).click();await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Simulation',exact:true}).click();
  // TP210: the play button is an icon; its accessible name says whether it plays or pauses.
  await expect(centre.locator('.unified-play')).toHaveAttribute('aria-label','Play');
  const frozen=await centre.locator('input[type=range]').inputValue();await page.waitForTimeout(200);expect(await centre.locator('input[type=range]').inputValue()).toBe(frozen);
  await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Reconstruction',exact:true}).click();await expect(centre.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  for(const start of f.statsStarts)expect(f.statsStarts.filter(t=>t>=start&&t<start+990).length).toBeLessThanOrEqual(4);
  expect(f.forbidden).toEqual([]);expect(f.unexpected).toEqual([]);f.assertImmutable();
});
