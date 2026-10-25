import {test,expect,type Page} from '@playwright/test';
import {unifiedFixture,openUnified} from './unified-fixtures';
import {ready,status} from '../src/chronicles/test-fixtures';
import type {SessionIdentity} from '../src/match-centre/session';

async function chronicleFixture(page:Page,cached=true){
  const base=await unifiedFixture(page),posts:unknown[]=[];let stored:ReturnType<typeof ready>|null=null;
  await page.context().route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===new URL(test.info().project.use.baseURL??process.env.TIMEPITCH_E2E_ORIGIN??`http://127.0.0.1:${process.env.TIMEPITCH_TEST_PORT}`).origin)return route.fallback();
    return route.abort();
  });
  await page.route('**/api/chronicles/v2**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname.endsWith('/status'))return route.fulfill({json:status({worker:'off',generation_allowed:!cached})});
    if(req.method()==='POST'){
      const body=req.postDataJSON();posts.push(body);expect(Object.keys(body).sort()).toEqual(['engine','locale','match_id','trace_hash']);
      stored=ready({source:body.engine,id:body.match_id,revision:body.trace_hash},body.locale);
      return route.fulfill({status:202,json:{...stored,state:'queued',checked:null}});
    }
    if(url.pathname.endsWith('/saved-report'))return route.fulfill({json:stored});
    if(!cached&&!stored)return route.fulfill({status:204});
    const source={source:url.searchParams.get('engine'),id:url.searchParams.get('match_id'),revision:url.searchParams.get('trace_hash')} as SessionIdentity;
    return route.fulfill({json:stored??ready(source,url.searchParams.get('locale')==='es'?'es':'en')});
  });
  return {...base,posts};
}

for(const source of ['grf','timepitch'])for(const locale of ['en','es'])for(const color of ['light','dark'] as const){
  test(`cached ${source} ${locale} ${color} has evidence and common player`,async({page},info)=>{
    const f=await chronicleFixture(page);await page.addInitScript(value=>localStorage.setItem('timepitch.locale',value),locale);
    await page.emulateMedia({colorScheme:color,reducedMotion:'reduce'});
    const centre=await openUnified(page,source),summary=centre.getByRole('tab',{name:locale==='en'?'Summary':'Resumen',exact:true});
    // Reach recorded events through the common player, then reveal final analysis explicitly.
    await centre.getByRole('slider').fill(source==='grf'?'25000':'1000');await summary.click();
    const panel=centre.getByRole('region',{name:locale==='en'?'Match chronicle':'Crónica del partido'});
    await expect(panel.getByRole('heading',{name:/Home club finished|Home club terminó/})).toHaveCount(0);
    await centre.getByRole('button',{name:/Reveal final analysis|Mostrar análisis final/}).click();
    await expect(panel.getByRole('heading',{name:/Home club finished|Home club terminó/})).toBeVisible();
    await expect(panel.getByText(/independently verified|de forma independiente/)).toBeVisible();
    await expect(panel.getByRole('button',{name:/Generate chronicle|Generar crónica/})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await panel.screenshot({path:info.outputPath(`chronicle-${source}-${locale}-${color}.png`)});
    const details=panel.locator('details').nth(1);await details.locator('summary').focus();await page.keyboard.press('Enter');
    const watch=details.getByRole('button',{name:/Watch cited event|Ver evento citado/});
    await expect(watch).toBeVisible();
    await watch.click();await expect(centre.getByRole('tab',{name:locale==='en'?'Match':'Partido',exact:true})).toHaveAttribute('aria-selected','true');
    // TP210: the transport now starts with the jump buttons; focus still lands on its first control.
    await expect(centre.locator('[data-unified-transport] button').first()).toBeFocused();
    await expect(centre.getByRole('button',{name:locale==='en'?'Play':'Reproducir',exact:true})).toBeVisible();
    expect(await centre.locator('canvas').count()).toBe(1);
    await summary.click();
    await page.getByRole('button',{name:locale==='en'?/^(Language|Idioma): Español$/:/^(Language|Idioma): English$/}).click();
    await expect(centre.locator('.chronicle-panel').getByRole('heading',{name:locale==='en'?/Home club terminó/:/Home club finished/})).toBeVisible();
    await page.reload();
    expect(f.posts).toEqual([]);expect(f.forbidden).toEqual([]);expect(f.unexpected).toEqual([]);f.assertImmutable();
  });
}

for(const source of ['grf','timepitch'])test(`explicit ${source} request is single and polls only stored data`,async({page})=>{
  const f=await chronicleFixture(page,false),centre=await openUnified(page,source);
  await centre.getByRole('tab',{name:'Summary',exact:true}).click();await centre.getByRole('button',{name:'Reveal final analysis'}).click();
  const panel=centre.getByRole('region',{name:'Match chronicle'}),button=panel.getByRole('button',{name:'Generate chronicle'});
  await button.focus();await page.keyboard.press('Enter');
  await expect(panel.getByRole('heading',{name:/Home club finished/})).toBeVisible();
  expect(f.posts).toHaveLength(1);await centre.getByRole('tab',{name:'Players',exact:true}).click();await centre.getByRole('tab',{name:'Summary',exact:true}).click();
  await expect(panel.getByRole('heading',{name:/Home club finished/})).toBeVisible();expect(f.posts).toHaveLength(1);
  await centre.getByRole('tab',{name:'Match',exact:true}).click();await centre.getByRole('button',{name:'Play',exact:true}).click();
  await centre.getByRole('button',{name:'Pause',exact:true}).click();expect(f.posts).toHaveLength(1);
  expect(f.forbidden).toEqual([]);expect(f.unexpected).toEqual([]);f.assertImmutable();
});

test('reconstruction gives a specific unsupported source and never posts',async({page})=>{
  const f=await chronicleFixture(page),centre=await openUnified(page,'historical');
  await centre.getByRole('tab',{name:'Summary',exact:true}).click();
  await expect(centre.getByText(/Reconstruction chronicles are not supported/)).toBeVisible();
  expect(f.posts).toEqual([]);expect(f.forbidden).toEqual([]);expect(f.unexpected).toEqual([]);f.assertImmutable();
});
