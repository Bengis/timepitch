import { test, expect } from '@playwright/test';
import { timepitchMatch } from './timepitch-centre';

test('returning to a pending window resumes polling after another explanation was requested', async ({ page }) => {
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  await page.getByRole('combobox', { name: 'Simulation engine', exact: true }).selectOption('timepitch'); await page.getByRole('button',{name:'Play match',exact:true}).click();
  // TP224: unified Match Centre (TP106); the local explanations live under its Summary tab.
  const { view, centre: match, clock } = timepitchMatch(page); await expect(match).toBeVisible();
  const id = await view.getAttribute('data-match-id');
  const windows = await (await page.request.get(`/api/matches/${id}/windows`)).json();
  const jobs: Record<string, unknown> = {};
  await page.route(`**/api/matches/${id}/explanations`, async route => {
    const body = route.request().postDataJSON();
    const window = windows.find((w: { id: string }) => w.id === body.window_id);
    const job = { id: window.id, match_id: id, window, locale: body.locale, mode: body.mode, state: 'pending', provenance: 'deterministic_fallback', text: '', model: 'test-only-boundary', prompt_version: 'test-only', calls_reserved: 0, attempts: 1 };
    jobs[window.id] = job; await route.fulfill({ status: 202, json: job });
  });
  let finished = false;
  await page.route(`**/api/matches/${id}/explanations/*`, async route => {
    const key = route.request().url().split('/').at(-1)!;
    await route.fulfill({ json: { ...(jobs[key] as object), ...(finished ? { state: 'unavailable', text: 'Recorded facts only; local AI explanation is not available.' } : {}) } });
  });
  await clock.press('End');
  await match.getByRole('tab', { name: 'Summary', exact: true }).click();
  const panel = match.getByRole('region', { name: 'Local match explanations', exact: true });
  await panel.getByLabel('Recorded window', { exact: true }).selectOption('halftime');
  await panel.getByRole('button', { name: 'Generate local explanation', exact: true }).click();
  await expect(panel.locator('.explanation-result.pending')).toBeVisible();
  await panel.getByLabel('Recorded window', { exact: true }).selectOption('fulltime');
  await panel.getByRole('button', { name: 'Generate local explanation', exact: true }).click();
  await expect(panel.locator('.explanation-result.pending')).toBeVisible();
  finished = true;
  await panel.getByLabel('Recorded window', { exact: true }).selectOption('halftime');
  await expect(panel.locator('.explanation-result.unavailable')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Generate local explanation', exact: true })).toBeEnabled();
});
