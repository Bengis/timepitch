import {test,expect} from '@playwright/test';
import {unifiedFixture} from './unified-fixtures';

test('Match Centre keeps all player data readable at 320px and preserves match, filters and themes',async({page})=>{
  const f=await unifiedFixture(page);let replayReads=0;page.on('request',r=>{if(r.url().endsWith('/fixture-grf/replay'))replayReads++;});
  await page.route('**/api/historical/capabilities',r=>r.fulfill({json:{two_modes_ui:false,reconstruction_enabled:false,dataset_state:'absent',dataset_version:null,publication_status:'blocked_pending_permission'}}));
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();const nav=page.getByRole('navigation',{name:'Workspace'});await nav.getByRole('button',{name:'Library',exact:true}).click();await page.locator('.grf-history').getByRole('button',{name:/Home club.*Away club/}).click();
  const centre=page.locator('[data-unified-match-centre][data-source=grf]');await expect(centre).toBeVisible();await centre.getByRole('slider').fill('1000');await centre.getByRole('button',{name:'Reveal final analysis'}).click();await centre.getByRole('tab',{name:'Players',exact:true}).click();
  await centre.getByRole('combobox',{name:'Team',exact:true}).selectOption('away');const roster=centre.getByRole('table',{name:'Players',exact:true});await expect(roster.locator('tbody tr')).toHaveCount(11);
  await centre.getByRole('searchbox',{name:'Filter metrics'}).fill('shots');
  await page.setViewportSize({width:320,height:780});
  const metric=centre.getByRole('table',{name:'Metric',exact:true});await expect(metric).toBeVisible();expect(await metric.evaluate(n=>parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(13);
  await roster.getByRole('button').first().click();await expect(centre.getByRole('dialog')).toBeVisible();await centre.getByRole('dialog').getByRole('button',{name:'Close player detail'}).click();
  for(const scheme of ['light','dark'] as const){await page.emulateMedia({colorScheme:scheme});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await centre.screenshot({path:test.info().outputPath(`players-320-${scheme}.png`)});}
  await nav.getByRole('button',{name:'New match',exact:true}).click();await expect(page.getByRole('button',{name:'Play match',exact:true})).toBeVisible();await nav.getByRole('button',{name:'Match centre',exact:true}).click();
  await expect(centre.getByRole('combobox',{name:'Team',exact:true})).toHaveValue('away');await expect(centre.getByRole('searchbox',{name:'Filter metrics'})).toHaveValue('shots');await expect(centre.getByRole('slider')).toHaveValue('1000');expect(replayReads).toBe(1);
  await centre.getByRole('tab',{name:'Maps',exact:true}).click();await expect(centre.locator('[data-plot-id=pass_edges]')).toBeVisible();await expect(centre.locator('[data-plot-id=shots]')).toBeVisible();
  await centre.getByRole('tab',{name:'Summary',exact:true}).click();await expect(centre.getByRole('table',{name:'Metric',exact:true})).toBeVisible();await expect(centre.locator('.unified-scope')).toContainText('Final · independent of playback');
  await page.getByRole('button', { name: 'Language: Español' }).click();await expect(page.getByRole('button',{name:'Centro de partido',exact:true})).toHaveAttribute('aria-current','page');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(f.forbidden).toEqual([]);expect(f.unexpected).toEqual([]);f.assertImmutable();
});
