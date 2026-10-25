import { test, expect } from '@playwright/test';

test('prepared local agents return a validated explanation in the actual app', async ({ page }) => {
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  await page.getByRole('combobox', { name: 'Simulation engine', exact: true }).selectOption('timepitch');
  await page.getByRole('button',{name:'Play match',exact:true}).click();
  const match = page.locator('.match-view'); await expect(match).toBeVisible();
  const id = await match.getAttribute('data-match-id');
  const before = await (await page.request.get(`/api/matches/${id}/replay`)).json();
  await match.getByRole('slider', { name: 'Match clock', exact: true }).press('End');
  const panel = match.getByRole('region', { name: 'Local match explanations', exact: true });
  await panel.getByRole('button', { name: 'Generate local explanation', exact: true }).click();
  await expect(panel.locator('.explanation-result.ready')).toBeVisible({ timeout: 45000 });
  await panel.getByText('Cited events and motion', { exact: true }).click();
  await expect(panel.locator('.explanation-result')).toContainText('qwen2.5-1.5b-instruct-generic-gpu:4@4');
  await expect(panel.locator('.explanation-result')).toContainText('4/4');
  expect(await panel.locator('.explanation-result code,.motion-evidence').count()).toBeGreaterThan(0);
  await expect(panel.locator('.explanation-result')).toContainText('grounded-2');
  await panel.getByLabel('Explanation mode', { exact: true }).selectOption('analyst');
  await page.getByRole('button', { name: 'Language: Español' }).click();
  const translated = match.getByRole('region', { name: 'Explicaciones locales del partido', exact: true });
  await translated.getByRole('button', { name: 'Generar explicación local', exact: true }).click();
  await expect(translated.locator('.explanation-result.ready')).toBeVisible({ timeout: 45000 });
  await expect(match).toHaveAttribute('data-match-id', id!);
  expect((await (await page.request.get(`/api/matches/${id}/replay`)).json()).trace_hash).toBe(before.trace_hash);
  await page.screenshot({ path: '../.local/qa/real-model-demo.png', fullPage: true });
});
