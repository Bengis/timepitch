import { test,expect } from '@playwright/test';
import { chooseTeam } from './versus-helpers';
import { pauseAutoplay, timepitchMatch } from './timepitch-centre';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// TP224: since TP106 a TimePitch replay opens in the unified Match Centre. Its statistics follow the cursor of the open
// tab (no separate «Inspect current statistics» step) and the charts are the Maps tab; the old StatisticsPanel is no
// longer mounted. Same intent: statistics never run ahead of the cursor, every chart is reachable, chart evidence seeks
// the replay, and both languages share one unchanged replay.
test('temporal statistics follow the cursor, all charts, evidence navigation and English/Spanish share one replay',async({page})=>{
  const errors:string[]=[],requests:number[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname.endsWith('/statistics'))requests.push(Number(url.searchParams.get('end_ms')));});
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  await page.getByRole('combobox', { name: 'Simulation engine', exact: true }).selectOption('timepitch');
  await page.getByRole('button',{name:'Play match',exact:true}).click();
  const {view,centre:match,clock}=timepitchMatch(page);
  await expect(match).toBeVisible();
  await pauseAutoplay(match);// TP226: starts by itself in the broadcast shell
  const id=await view.getAttribute('data-match-id');
  const original=await (await page.request.get(`/api/matches/${id}/replay`)).json();
  expect(original.metrics_version).toBe('metrics-1');
  await clock.fill('1800000');
  await match.getByRole('tab',{name:'Summary',exact:true}).click();
  const scope=match.locator('.unified-scope');
  await expect(scope).toContainText('At statistics cutoff · 30:00');
  await expect.poll(()=>requests.includes(1800000)).toBe(true);
  expect(requests.every(end=>end<=1800000)).toBe(true);
  await expect(match.getByText('Simulated xG',{exact:true}).first()).toBeVisible();
  const reads=requests.length;
  await page.getByRole('button', { name: 'Language: Español' }).click();
  await expect(match.getByText('xG simulado',{exact:true}).first()).toBeVisible();
  await page.getByRole('button', { name: 'Idioma: English' }).click();
  expect(requests.length).toBe(reads);
  await clock.fill('1700000');
  await expect(scope).toContainText('At statistics cutoff · 28:20');
  expect(requests.every(end=>end<=1800000)).toBe(true);
  await clock.press('End');
  await expect(scope).toContainText('Final · independent of playback');
  await match.getByRole('tab',{name:'Maps',exact:true}).click();
  for(const plot of ['shots','xg','actions','pass_edges','occupancy_in_possession','occupancy_out_of_possession'])
    await expect(match.locator(`[data-plot-id=${plot}]`).getByRole('img')).toBeVisible();
  await match.locator('[data-plot-id=pass_edges]').screenshot({path:`../.local/qa/statistics-passes-${test.info().project.name}.png`});
  await match.getByRole('tab',{name:'Effort',exact:true}).click();
  await expect(match.locator('[data-plot-id=effort]').getByRole('img')).toBeVisible();
  await match.locator('.unified-panel').screenshot({path:`../.local/qa/statistics-effort-${test.info().project.name}.png`});
  // Evidence navigation: a shot row of the shot map watches that moment of the same replay, paused.
  await match.getByRole('tab',{name:'Maps',exact:true}).click();
  const shots=match.locator('[data-plot-id=shots]');
  const columns=await shots.locator('thead th').allTextContents(),at=columns.indexOf('elapsed_ms');
  expect(at).toBeGreaterThanOrEqual(0);
  const row=shots.locator('tbody tr').first(),target=await row.locator('td').nth(at).innerText();
  await row.getByRole('button',{name:'Watch event',exact:true}).click();
  await expect(match.getByRole('tab',{name:'Live broadcast',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(clock).toHaveValue(target);
  await expect(match.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  expect((await (await page.request.get(`/api/matches/${id}/replay`)).json()).trace_hash).toBe(original.trace_hash);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('historical coverage keeps zero, partial exposure and early-era absence distinct',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  await page.getByRole('combobox', { name: 'Simulation engine', exact: true }).selectOption('timepitch');
  const home=page.getByRole('article',{name:'Home team',exact:true});
  await chooseTeam(page,'home','arsenal:2022');
  await expect(home.locator('.season-tag')).toHaveText('2022/23');
  await home.getByText('Season squad and sources',{exact:true}).click();
  await home.locator('.advanced-roster summary').first().click();
  const current=await (await page.request.get('/api/catalog/teams/arsenal:2022')).json();
  const partial=current.players.find((p:{advanced_stats:{xg:{status:string;covered_minutes:number}}})=>p.advanced_stats.xg.status==='partial'&&p.advanced_stats.xg.covered_minutes>0);
  await home.getByRole('combobox',{name:'Historical player',exact:true}).selectOption(partial.key);
  await expect(home.locator('.advanced-roster')).toContainText('Partial');
  await home.locator('.advanced-roster').screenshot({path:`../.local/qa/statistics-history-${test.info().project.name}.png`});
  await chooseTeam(page,'home','arsenal:2025');
  await expect(home.locator('.season-tag')).toHaveText('2025/26');
  await home.getByText('Season squad and sources',{exact:true}).click();
  if(await home.locator('.advanced-roster').getAttribute('open')===null)await home.locator('.advanced-roster summary').first().click();
  const recent=await (await page.request.get('/api/catalog/teams/arsenal:2025')).json();
  const zero=recent.players.find((p:{advanced_stats:{xg:{value:number;status:string}}})=>p.advanced_stats.xg.value===0&&p.advanced_stats.xg.status==='measured');
  await home.getByRole('combobox',{name:'Historical player',exact:true}).selectOption(zero.key);
  const xg=home.locator('.advanced-roster tbody tr').first();
  await expect(xg.locator('.stat').first()).toHaveText('0');
  await expect(xg.locator('.stat').first()).toHaveAttribute('title','Measured');
  await chooseTeam(page,'home','arsenal:1992');
  await expect(home.locator('.season-tag')).toHaveText('1992/93');
  await home.getByText('Season squad and sources',{exact:true}).click();
  if(await home.locator('.advanced-roster').getAttribute('open')===null)await home.locator('.advanced-roster summary').first().click();
  await expect(home.locator('.advanced-roster tbody tr').first().locator('.stat').first()).toHaveText('—');
});

// TP224: the same legacy replay in the unified Match Centre: simulated xG is available (Summary, Maps) while the
// effort view offers no distance, because this previous replay has no canonical motion samples.
test('legacy replay offers available xG without manufacturing kilometres',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  await page.getByRole('combobox', { name: 'Simulation engine', exact: true }).selectOption('timepitch');
  const raw=inflateSync(readFileSync('../backend/tests/fixtures/legacy-engine1.json.zlib'));
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await expect(page.getByLabel('Import replay file',{exact:true})).toBeEnabled();
  await page.getByLabel('Import replay file',{exact:true}).setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:raw});
  const {centre:match,clock}=timepitchMatch(page);
  await expect(match).toBeVisible();
  await clock.press('End');
  await match.getByRole('tab',{name:'Summary',exact:true}).click();
  await expect(match.locator('.unified-scope')).toContainText('Final · independent of playback');
  const xg=match.getByRole('row').filter({has:page.getByText('simulated_xg',{exact:true})}).first();
  await expect(xg).toContainText(/\d+\.\d+ xG/);
  await expect(xg).toContainText('available');
  await match.getByRole('tab',{name:'Maps',exact:true}).click();
  await expect(match.locator('[data-plot-id=xg]').getByRole('img')).toBeVisible();
  await match.getByRole('tab',{name:'Effort',exact:true}).click();
  await expect(match.locator('.unified-scope')).toContainText('Final · independent of playback');
  await expect(match.locator('[data-plot-id=effort]')).toHaveCount(0);
  for(const metric of ['distance_m','distance_km_per90','hsr_distance_m','sprint_distance_m']){
    const rows=match.getByRole('row').filter({has:page.getByText(metric,{exact:true})});
    await expect(rows.first()).toBeVisible();expect(await rows.count()).toBeGreaterThanOrEqual(2); // both teams (and players)
    for(const row of await rows.all())await expect(row.getByRole('cell').nth(1)).toHaveText('Unavailable'); // Subject, Value, Details
  }
});
