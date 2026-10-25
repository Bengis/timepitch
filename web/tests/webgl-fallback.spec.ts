import { test, expect } from '@playwright/test';
import { unifiedFixture, openUnified } from './unified-fixtures';
import { expectFallback, graphicsGate, refuseWebGL } from './pitch-renderer-checks';
import type { Locator } from '@playwright/test';

/** TP226: saved simulated matches start by themselves; pause (or wait for the short fixture to end) for a still clock. */
async function stopAutoplay(centre: Locator) {
  const play = centre.locator('.pbk-play');
  await expect(play).toHaveAttribute('aria-label', /^(Pause|Play)$/);
  if (await play.getAttribute('aria-label') === 'Pause' && await play.isEnabled()) await play.click().catch(() => {});
  await expect(play).toHaveAttribute('aria-label', 'Play');
}

// TP206: the app is 3D-only (TP205). The simplified 2D view (retro-1) is only the automatic fallback when WebGL is
// unavailable. These tests force that path by refusing WebGL contexts and keep the old Retro intent: the pitch is
// visible, players can be inspected, the paused picture is stable, sprite art can fail softly and there is no
// horizontal scroll (the mobile project runs at 390 px).

test('without WebGL the match opens in the 2D fallback with inspection, a stable paused picture and retry', async ({ page, baseURL }) => {
  const gate = await graphicsGate(page, baseURL!); await refuseWebGL(page); const fixture = await unifiedFixture(page);
  const centre = await openUnified(page, 'grf'), slider = centre.getByRole('slider');
  // TP226: GRF opens in the broadcast shell and starts by itself (the 30 s fixture ends in ~3 s at 10×): stop it first.
  await stopAutoplay(centre);
  await slider.fill('1000'); await expect(slider).toHaveValue('1000');
  await expectFallback(centre);
  await expect(centre.locator('canvas')).toHaveAttribute('data-sprite-status', 'ready');
  const pitch = centre.getByRole('img', { name: 'Pitch with 22 players and the ball', exact: true });
  await expect(pitch).toBeVisible();
  await expect(centre.locator('.pitch-status')).toContainText('Showing a simplified 2D view at the same match position');
  // In the shell the camera is chosen with the HUD tabs over the pitch (TP210).
  for (const [tab, camera] of [['Tactical', 'overview'], ['Broadcast', 'follow']]) {
    await centre.locator('.pitch-hud-camtabs').getByRole('button', { name: tab, exact: true }).click();
    await expect(centre.locator('canvas')).toHaveAttribute('data-camera', camera);
  }
  // WebGL is still refused: the retry is bounded, keeps the cursor and stays on the fallback.
  await centre.getByRole('button', { name: 'Retry 3D', exact: true }).click();
  await expectFallback(centre);
  expect(await slider.inputValue()).toBe('1000');
  // The inspector is folded in the picture settings; choosing a player opens «Player card», so go back to the broadcast.
  await centre.locator('.tp-pitch-settings-host > details > summary').click();
  const inspector = centre.getByRole('combobox', { name: 'Inspect player', exact: true });
  await inspector.selectOption({ index: 1 });
  await centre.getByRole('tab', { name: 'Live broadcast', exact: true }).click();
  const chosen = await inspector.inputValue(); expect(chosen).not.toBe('');
  const frozen = await pitch.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(180);
  expect(await pitch.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())).toBe(frozen);
  await page.getByRole('button', { name: 'Language: Español' }).press('Enter');
  await expect(centre.getByRole('button', { name: 'Reintentar 3D', exact: true })).toBeVisible();
  await expect(centre.locator('.pitch-status')).toContainText('Mostrando una vista 2D simplificada');
  await expect(centre.locator('.pitch-hud-camtabs').getByRole('button', { name: 'Emisión', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(centre.getByRole('combobox', { name: 'Consultar jugador', exact: true })).toHaveValue(chosen);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(gate.forbidden).toEqual([]); expect(gate.external).toEqual([]); expect(gate.errors).toEqual([]);
  expect(fixture.forbidden).toEqual([]); expect(fixture.unexpected).toEqual([]); fixture.assertImmutable();
});

test('the 2D fallback keeps player inspection when the local sprite asset cannot load', async ({ page, baseURL }) => {
  const gate = await graphicsGate(page, baseURL!); await refuseWebGL(page); const fixture = await unifiedFixture(page);
  await page.route('**/football-sprites*.svg*', route => route.abort());
  const centre = await openUnified(page, 'timepitch');
  await expectFallback(centre);
  await expect(centre.locator('canvas')).toHaveAttribute('data-sprite-status', 'fallback');
  await expect(centre.locator('.pitch-status')).toContainText('Player art could not load');
  await centre.locator('.tp-pitch-settings-host > details > summary').click(); // TP226: folded in the shell
  const inspector = centre.getByRole('combobox', { name: 'Inspect player', exact: true });
  await inspector.selectOption({ index: 1 });
  await centre.getByRole('tab', { name: 'Live broadcast', exact: true }).click();
  expect(await inspector.inputValue()).not.toBe('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(gate.forbidden).toEqual([]); expect(gate.errors).toEqual([]); fixture.assertImmutable();
});
