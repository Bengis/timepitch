import { test, expect } from '@playwright/test';
import { expect3D, graphicsProbe, readProbe } from './pitch-renderer-checks';

// TP206/TP223: the public demo (#/demo) opens in Retro 16-bit (default since TP223); 3D stays selectable in
// «Graphics» and, once chosen, is remembered. Its recordings live outside git (.local/replays-dist, served at /replays/
// by vite dev); without them this test is skipped, never faked.
const sample = '/replays/arsenal2003-mancity2024-43/touchlines-cal3.json.gz';

test('the demo opens in Retro 16-bit and 3D can be chosen: players and ball, without horizontal scroll', async ({ page }) => {
  const head = await page.request.head(sample);
  test.skip(!head.ok() || !!head.headers()['content-type']?.includes('html'), 'Demo recordings are not served here (.local/replays-dist).');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await graphicsProbe(page);
  await page.goto('/#/demo');
  const centre = page.locator('[data-unified-match-centre]');
  await expect(centre).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-movement-selector] button[aria-pressed=true]')).toHaveCount(1);
  const pitch = centre.locator('.pitch-section');
  await expect(pitch).toHaveAttribute('data-requested-renderer', 'retro16-1');
  await expect(pitch).toHaveAttribute('data-effective-renderer', 'retro16-1');
  // 3D is chosen in the folded pitch settings and saved as an explicit choice.
  await centre.locator('details.pitch-settings > summary').first().click();
  await centre.getByRole('combobox', { name: 'Graphics', exact: true }).selectOption('stylized-3d-1');
  await expect3D(centre);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timepitch.pitch.v1') ?? '{}'))).toMatchObject({ version: 2, renderer: 'stylized-3d-1', rendererChosen: true });
  await expect(centre.locator('.pitch-section canvas')).toBeVisible();
  // 22 players to inspect and real WebGL draw calls (pitch, players and ball). TP210: the selector lives in the folded
  // pitch settings under the playback bar (mockup v1-2d keeps the pitch clean), so it is counted in the DOM.
  await expect.poll(() => centre.locator('.pitch-inspector select option').count()).toBe(23);
  await expect.poll(async () => (await readProbe(page)).draws).toBeGreaterThan(0);
  const slider = centre.getByRole('slider');
  await slider.fill('600000'); await expect(slider).toHaveValue('600000');
  await expect3D(centre);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
