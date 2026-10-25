import { test, expect } from '@playwright/test';
import { timepitchMatch } from './timepitch-centre';

test('local AI absence is labelled and language/mode changes preserve the match', async ({ page }) => {
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  await page.getByRole('combobox', { name: 'Simulation engine', exact: true }).selectOption('timepitch');
  await page.getByRole('button',{name:'Play match',exact:true}).click();
  // TP224: unified Match Centre (TP106); the local explanations live under its Summary tab.
  const { view, centre: match, clock } = timepitchMatch(page);
  await expect(match).toBeVisible();
  const id = await view.getAttribute('data-match-id');
  await clock.press('End');
  await match.getByRole('tab', { name: 'Summary', exact: true }).click();
  const panel = match.getByRole('region', { name: 'Local match explanations', exact: true });
  await panel.getByRole('button', { name: 'Generate local explanation', exact: true }).click();
  await expect(panel.getByText('Deterministic fallback', { exact: true })).toBeVisible();
  await expect(panel.getByText('Recorded facts only; local AI explanation is not available.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Retry local AI', exact: true })).toBeVisible();
  await panel.getByLabel('Explanation mode', { exact: true }).selectOption('analyst');
  await page.getByRole('button', { name: 'Language: Español' }).click();
  await expect(view).toHaveAttribute('data-match-id', id!);
  const translated = match.getByRole('region', { name: 'Explicaciones locales del partido', exact: true });
  await translated.getByRole('button', { name: 'Generar explicación local', exact: true }).click();
  await expect(translated.getByText('Texto determinista de respaldo', { exact: true })).toBeVisible();
  // The language change keeps the match on its Summary tab (the old «Resumen del partido» heading is gone).
  await expect(match.getByRole('tab', { name: 'Resumen', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('scripted metric response exposes motion evidence and rewind hides the future explanation',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  await page.getByRole('combobox', { name: 'Simulation engine', exact: true }).selectOption('timepitch');
  await page.getByRole('button',{name:'Play match',exact:true}).click();
  const {view,centre:match,clock}=timepitchMatch(page);
  await expect(match).toBeVisible();
  await expect(match.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  const id=await view.getAttribute('data-match-id');
  const record=await(await page.request.get(`/api/matches/${id}/replay`)).json();
  const windows=await(await page.request.get(`/api/matches/${id}/windows`)).json();
  const window=windows.find((w:{id:string})=>w.id==='fulltime');
  const fact=window.statistics.facts.find((f:{category:string})=>f.category==='distance_leader');
  expect(fact).toBeTruthy();
  // HTTP double: this checks rendering, never claims real model inference.
  await page.route(`**/api/matches/${id}/explanations`,route=>route.fulfill({json:{
    id:'scripted-metric',match_id:id,window,locale:'en',mode:'fan',state:'ready',provenance:'local_ai',
    model:'scripted-test-double',prompt_version:'grounded-2',calls_reserved:4,attempts:1,latency_ms:1,
    text:'Scripted metric evidence response.',explanation:{window_id:window.id,revision:record.trace_hash,
      category:fact.category,side:fact.side,event_ids:fact.event_ids,player_keys:[fact.player_key],score:window.score,
      metric_id:fact.metric_id,metric_player_key:fact.player_key,sample_ranges:fact.sample_ranges,locale:'en',mode:'fan',variant:0}
  }}));
  await clock.press('End');
  await match.getByRole('tab',{name:'Summary',exact:true}).click();
  const panel=match.getByRole('region',{name:'Local match explanations',exact:true});
  await panel.getByRole('button',{name:'Generate local explanation',exact:true}).click();
  await expect(panel.getByText(/Scripted metric evidence response\./)).toBeVisible();
  await panel.getByText('Cited events and motion',{exact:true}).click();
  await expect(panel.locator('.motion-evidence').first()).toHaveAttribute('data-sample-end',String(fact.sample_ranges[0][1]));
  await clock.fill('0');
  await expect(panel.getByText(/Scripted metric evidence response\./)).not.toBeVisible();
  expect((await(await page.request.get(`/api/matches/${id}/replay`)).json()).trace_hash).toBe(record.trace_hash);
});
