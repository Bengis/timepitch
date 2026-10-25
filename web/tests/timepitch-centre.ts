import { expect, type Locator, type Page } from '@playwright/test';

/**
 * TP224: since TP106 a TimePitch match opens in the unified Match Centre inside `div[data-match-id]` (TP226: broadcast shell, autoplay at 10×).
 * Locators are language-neutral (one slider, the speed group by class) so they survive switching EN/ES.
 */
export function timepitchMatch(page: Page) {
  const centre = page.locator('[data-unified-match-centre][data-source=timepitch]');
  const view = page.locator('div[data-match-id]').filter({ has: centre });
  return {
    view, centre,
    clock: centre.getByRole('slider'),
    score: centre.locator('[data-unified-scoreboard] .tp-sb-digits'),
    /** TP210: speed is a group of toggle buttons («1×», «20×»…). */
    speed: (value: string) => centre.locator('.pbk-speed').getByRole('button', { name: `${value}×`, exact: true }),
  };
}

/** TP226: a simulated match starts by itself at 10×; pause it so the rest of a spec drives a still clock. */
export async function pauseAutoplay(centre: Locator) {
  await expect(centre.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(centre.locator('.pbk-speed').getByRole('button', { name: '10×', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await centre.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(centre.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
}

/**
 * TP226: on a desktop viewport the broadcast (bar, tabs, scoreboard, pitch, side column and playback bar) fits without
 * vertical scrolling; on a phone it stacks with no horizontal scroll.
 */
export async function expectBroadcastFits(page: Page, centre: Locator) {
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (viewport.width <= 860) return;
  await expect.poll(async () => {
    const bar = await centre.locator('[data-playback-panel]').boundingBox();
    return bar ? Math.round(bar.y + bar.height + await page.evaluate(() => scrollY)) <= viewport.height : false;
  }).toBe(true);
}
