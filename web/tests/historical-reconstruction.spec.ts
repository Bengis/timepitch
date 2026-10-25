import {test,expect} from '@playwright/test';
import {fullFixture} from '../src/grf/test-fixtures';
import {summaryFixture} from '../src/grf/statistics/test-fixtures';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {historicalFixture,statisticsFixture} from '../src/historical/test-fixtures';

test.beforeEach(async({page})=>{
  await page.route('**/api/historical/capabilities',route=>route.fulfill({json:{two_modes_ui:true,reconstruction_enabled:true,dataset_state:'ready',dataset_version:'sha256:ab91d82f3c33e4ee103c9524d787663f50e138ae40caf05f82a5b4163c2d4bfe',publication_status:'blocked_pending_permission'}}));
  page.on('request',request=>{if(request.method()==='POST')throw new Error(`Unexpected POST during read-only acceptance: ${new URL(request.url()).pathname}`);});
});
test('recorded pilot, cursor score, layers, source evidence and responsive UI',async({page})=>{
  test.skip(!process.env.TIMEPITCH_HISTORICAL_DATASET,'Requires accepted read-only pilot data; full-source acceptance is phase 5.');
  let segments=0;page.on('request',r=>{if(r.url().includes('/reconstruction/segments/'))segments++;});
  await page.goto('/#/reconstruction/3754217');
  const centre=page.locator('[data-unified-match-centre][data-source=historical]'),range=centre.getByRole('slider',{name:'Match position'});
  await expect(centre.locator('[data-unified-scoreboard]')).toContainText('Chelsea');await expect(centre.locator('[data-unified-scoreboard]')).toContainText('Arsenal');
  await expect(centre.locator('[data-unified-scoreboard] .tp-sb-digits')).toHaveText('0–0');await expect(centre.locator('.unified-provenance')).toContainText('Recorded events · synthetic tracking');
  await expect(centre.getByRole('button',{name:'Simulate this matchup',exact:true})).toHaveCount(0);
  const play=centre.getByRole('button',{name:'Play',exact:true}),box=await play.boundingBox(),field=await centre.locator('canvas').boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.y+box!.height).toBeLessThan(field!.y);
  await play.focus();await play.press('Enter');await centre.getByRole('button',{name:'Pause',exact:true}).press('Enter');await range.fill('45000');
  const events=centre.locator('[data-unified-events]');await events.locator('.unified-event-list button').first().click();await expect(events.locator('.unified-event-detail')).toBeVisible();
  await centre.getByLabel('Synthetic movement',{exact:true}).uncheck();await expect(centre.getByRole('img',{name:'Recorded anchors',exact:true})).toBeVisible();await expect(events.locator('.unified-event-detail')).toBeVisible();await centre.getByLabel('Synthetic movement',{exact:true}).check();
  await centre.getByRole('tab',{name:'Players',exact:true}).click();await expect(centre.getByRole('table',{name:'Players',exact:true})).toBeVisible();
  await centre.getByRole('tab',{name:'Maps',exact:true}).click();const actions=centre.locator('[data-plot-id=action_map]');await expect(actions.getByRole('img')).toBeVisible();
  await actions.getByRole('searchbox',{name:'Filter map rows'}).fill('Pass');await actions.getByLabel('Map team',{exact:true}).selectOption('statsbomb:1');
  await range.fill('55000');await expect(centre.locator('.unified-scope')).toContainText('0:55');await expect(actions.getByRole('searchbox')).toHaveValue('Pass');await expect(actions.getByRole('img')).toBeVisible();
  await range.fill('45000');await centre.getByRole('tab',{name:'Summary',exact:true}).click();await centre.getByRole('button',{name:'Reveal final analysis'}).click();await expect(centre.getByText(/Final result: 2 : 0/)).toBeVisible();await expect(centre.locator('[data-unified-scoreboard] .tp-sb-digits')).toHaveText('0–0');await expect(centre.locator('.unified-scope')).toContainText('Final · independent of playback');
  const before=segments;await play.click();await page.waitForTimeout(1200);await centre.getByRole('button',{name:'Pause',exact:true}).click();expect(segments).toBe(before);const paused=await range.inputValue();
  const nav=page.getByRole('navigation',{name:'Workspace'});await nav.getByRole('button',{name:'Simulation',exact:true}).click();await expect(page.getByRole('button',{name:'Play match',exact:true})).toBeVisible();await nav.getByRole('button',{name:'Reconstruction',exact:true}).click();await expect(range).toHaveValue(paused);
  for(const width of [320,390,768,1440])for(const theme of ['light','dark'] as const)for(const language of ['en','es']){
    await page.setViewportSize({width,height:950});await page.emulateMedia({colorScheme:theme});await page.getByRole('button',{name:language==='es'?/^(Language|Idioma): Español$/:/^(Language|Idioma): English$/}).click();
    await expect(centre.locator('.unified-provenance')).toContainText(language==='en'?'Recorded events · synthetic tracking':'Eventos registrados · tracking sintético');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  await page.getByRole('button', { name: 'Language: English' }).click();await centre.getByRole('tab',{name:'Data',exact:true}).click();await expect(centre.getByText(/synthetic-motion-1/).first()).toBeVisible();await expect(centre.getByText(/StatsBomb Open Data/).first()).toBeVisible();
  await centre.getByRole('tab',{name:'Data',exact:true}).focus();await page.keyboard.press('Home');await expect(centre.getByRole('tab',{name:'Match',exact:true})).toBeFocused();await page.reload();await expect(centre.locator('[data-unified-scoreboard]')).toContainText('Chelsea');await centre.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByRole('heading',{name:'Football, as it happened.'})).toBeVisible();await page.getByRole('combobox',{name:'Season',exact:true}).selectOption('44');await expect(page.getByText('Arsenal fixtures only · not the full league')).toBeVisible();
});

test('existing recorded TimePitch and GRF matches retain identity and cursor across modes',async({page})=>{
  test.skip(!process.env.TIMEPITCH_ACCEPTANCE_SAVED_DIR,'Requires explicitly selected private saved replays, never generates a match.');
  test.setTimeout(120000);
  const saved=Object.fromEntries(['timepitch','grf'].map(engine=>[engine,JSON.parse(readFileSync(join(process.env.TIMEPITCH_ACCEPTANCE_SAVED_DIR!,`saved-${engine}.json`),'utf8'))]));
  for(const engine of ['timepitch','grf']){
    const {job,record,statistics}=saved[engine],prefix=engine==='grf'?'/api/grf/matches':'/api/matches';
    await page.route(`**${prefix}`,route=>route.fulfill({json:[job]}));
    await page.route(`**${prefix}/${job.id}`,route=>route.fulfill({json:job}));
    await page.route(`**${prefix}/${job.id}/replay`,route=>route.fulfill({json:record}));
    await page.route(`**${prefix}/${job.id}/statistics*`,route=>route.fulfill({json:statistics}));
    if(engine==='timepitch')await page.route(`**${prefix}/${job.id}/windows`,route=>route.fulfill({json:[]}));
  }
  await page.goto('/#/library');
  for(const engine of ['timepitch','grf']){
    await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Library',exact:true}).click();
    const name=engine==='grf'?'.grf-history':'.history:not(.grf-history)';
    await page.locator(`${name} .history-list`).getByRole('button').first().click();
    const view=page.locator(engine==='grf'?'[data-source=grf]':'[data-source=timepitch]');
    await expect(view).toBeVisible();
    const pause=view.getByRole('button',{name:'Pause',exact:true});if(await pause.isVisible())await pause.click();
    const id=await view.locator('..').getAttribute('data-match-id');
    await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Reconstruction',exact:true}).click();
    await expect(view).not.toBeVisible();
    await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Simulation',exact:true}).click();
    await expect(view).toBeVisible();await expect(view.locator('..')).toHaveAttribute('data-match-id',id!);
    await expect(view.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  }
});

test('a saved GRF replay survives mode changes; unavailable history does not block simulation',async({page})=>{
  const replay=fullFixture(),summary=summaryFixture();
  const job={id:'saved-only',state:'ready',config:replay.input.config,summary:{home_name:'Home club',away_name:'Away club',score:summary.score}};
  await page.route('**/api/grf/matches',route=>route.fulfill({json:[job]}));
  await page.route('**/api/grf/matches/saved-only',route=>route.fulfill({json:job}));
  await page.route('**/api/grf/matches/saved-only/replay',route=>route.fulfill({json:replay}));
  await page.route('**/api/grf/matches/saved-only/statistics',route=>route.fulfill({json:summary}));
  await page.route('**/api/historical/seasons',route=>route.fulfill({status:503,json:{detail:'Fixture: temporarily unavailable'}}));
  await page.goto('/#/library');
  await page.getByRole('button',{name:/Home club — Away club/}).click();
  await expect(page.locator('[data-unified-match-centre][data-source=grf]')).toBeVisible();
  const nav=page.getByRole('navigation',{name:'Workspace'});
  await nav.getByRole('button',{name:'Reconstruction',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('historical archive is unavailable');
  await nav.getByRole('button',{name:'Simulation',exact:true}).click();
  await expect(page.locator('[data-unified-match-centre][data-source=grf]')).toBeVisible();
  await page.getByRole('button',{name:'New match',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play match',exact:true})).toBeVisible();
  await page.goBack();await expect(page.locator('[data-unified-match-centre][data-source=grf]')).toBeVisible();
});

test('long identities, unavailable motion and missing facts remain readable',async({page})=>{
  // UI fixture only, not a claim about an actual recorded match.
  const match=historicalFixture();match.home_team.name='A very long historical home football club name';match.away_team.name='Another extremely long away football club identity';
  await page.route('**/api/historical/capabilities',route=>route.fulfill({json:{two_modes_ui:true,reconstruction_enabled:true,dataset_state:'ready',dataset_version:'v1',publication_status:'blocked_pending_permission'}}));
  await page.route('**/api/historical/matches/9',route=>route.fulfill({json:match}));
  await page.route('**/api/historical/matches/9/reconstruction',route=>route.fulfill({status:503,json:{detail:'Fixture: unavailable motion'}}));
  await page.route('**/api/historical/matches/9/events?*',route=>route.fulfill({json:{dataset_version:'v1',match_id:9,total:0,items:[]}}));
  await page.route('**/api/historical/matches/9/statistics?*',route=>{const ms=Number(new URL(route.request().url()).searchParams.get('at_ms'));return route.fulfill({json:statisticsFixture(ms)});});
  await page.goto('/#/reconstruction/9');
  await expect(page.getByText(/Movement is unavailable/).first()).toBeVisible();
  await expect(page.locator('[data-source=historical] canvas')).toBeVisible();await expect(page.locator('[data-source=historical] [data-unified-scoreboard] .tp-sb-digits')).toHaveText('0–0');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('[data-unified-scoreboard] .tp-sb-team .tp-sb-name').first()).toBeVisible();
  }
  await page.getByRole('tab',{name:'Players',exact:true}).click();
  const table=page.getByRole('table',{name:'Players',exact:true});await expect(table).toBeVisible();
  expect(await table.evaluate(n=>getComputedStyle(n).fontSize)).toBe('13px');
  await expect(table.locator('tbody tr')).toHaveCount(match.lineups!.flatMap(l=>l.players).length);await expect(table.getByText('—',{exact:true})).toHaveCount(1);await expect(table.getByText('9',{exact:true})).toBeVisible();
});
