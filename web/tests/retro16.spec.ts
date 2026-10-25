import { test, expect, type Locator } from '@playwright/test';

// TP222/TP223: «Retro 16-bit» is the default graphics (3D is the other choice). The public demo (#/demo) must open in
// the pixel-art renderer without choosing anything, draw a real picture (not a blank canvas), show the illustrative
// referee and assistants and, where the scale allows it, the shirt numbers of identified players. On the phone the
// camera tabs are there and the scene caption is one compact row that does not cover the pitch. Like demo-3d.spec.ts, the demo
// recordings live outside git (.local/replays-dist); without them this test is skipped, never faked.
const sample = '/replays/arsenal2003-mancity2024-43/touchlines-cal3.json.gz';
/** Referee kit chosen for this match (purple: black and yellow clash with the keepers; see palette.ts → refereeKitFor). */
const REFEREE = [0x70, 0x46, 0xc8];

async function canvasColours(canvas: Locator) {
  return canvas.evaluate((node, ref) => {
    const c = node as HTMLCanvasElement, ctx = c.getContext('2d')!;
    const data = ctx.getImageData(0, 0, c.width, c.height).data, colours = new Set<number>();
    let referee = 0;
    for (let i = 0; i < data.length; i += 4) {
      colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      if (data[i] === ref[0] && data[i + 1] === ref[1] && data[i + 2] === ref[2]) referee++;
    }
    return { colours: colours.size, referee };
  }, REFEREE);
}

test('the demo opens in Retro 16-bit: pixel picture, referee and assistants, shirt numbers, camera tabs', async ({ page }, info) => {
  const head = await page.request.head(sample);
  test.skip(!head.ok() || !!head.headers()['content-type']?.includes('html'), 'Demo recordings are not served here (.local/replays-dist).');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/demo');
  const centre = page.locator('[data-unified-match-centre]');
  await expect(centre).toBeVisible({ timeout: 60000 });
  const pitch = centre.locator('.pitch-section');
  await expect(pitch).toHaveAttribute('data-requested-renderer', 'retro16-1');
  await expect(pitch).toHaveAttribute('data-renderer-status', 'ready');
  await expect(pitch).toHaveAttribute('data-effective-renderer', 'retro16-1');
  const canvas = centre.locator('.pitch-section canvas');
  await expect(canvas).toHaveAttribute('data-renderer', 'retro16-1');
  await expect(canvas).toHaveAttribute('data-sprite-status', 'ready');
  await expect(centre.locator('.pitch-section p[role=status]')).toContainText('The referee and assistants are illustrative');
  const slider = centre.getByRole('slider');
  await slider.fill('30000'); await expect(slider).toHaveValue('30000');

  // Broadcast: a real pixel picture with the officials on it; numbers on backs when the art scale is 2 or more.
  await expect(canvas).toHaveAttribute('data-camera', 'follow');
  await expect.poll(async () => (await canvasColours(canvas)).colours).toBeGreaterThan(40);
  await expect.poll(async () => Number(await canvas.getAttribute('data-officials'))).toBeGreaterThan(0);
  if (info.project.name === 'desktop') await expect.poll(async () => Number(await canvas.getAttribute('data-shirt-numbers'))).toBeGreaterThan(0);

  // Tactical: own pixel layer at whole-number scale; the three officials as purple diamonds; numbers inside the
  // tokens when they fit (desktop: 11 px tokens).
  // TP223: the camera tabs are there on the phone too, and the HUD is one row that leaves the pitch visible.
  const box = (await centre.locator('.pitch-canvas-container').boundingBox())!;
  const left = (await centre.locator('.pitch-hud-tl').boundingBox())!, right = (await centre.locator('.pitch-hud-tr').boundingBox())!;
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);
  expect(Math.max(left.y + left.height, right.y + right.height) - box.y).toBeLessThanOrEqual(Math.max(36, box.height * .15));
  await centre.getByRole('button', { name: 'Tactical', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-camera', 'overview');
  await expect(canvas).toHaveAttribute('data-tactical', /^(landscape|portrait) \dppm x\d+$/);
  await expect.poll(async () => Number(await canvas.getAttribute('data-officials'))).toBe(3);
  await expect.poll(async () => (await canvasColours(canvas)).referee).toBeGreaterThan(0);
  // TP226: the broadcast now fits one screen, so at 1366×768 the tactical pixel layer is too small for numbers in the
  // tokens (≈ 492 px of pitch height); on a larger desktop screen they fit again.
  if (info.project.name === 'desktop') {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect.poll(async () => Number(await canvas.getAttribute('data-shirt-numbers'))).toBeGreaterThanOrEqual(11);
    await page.setViewportSize({ width: 1366, height: 768 });
  }

  // Nothing was chosen: the default is saved as such (not as a choice) and the page never scrolls sideways.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timepitch.pitch.v1') ?? '{}'))).toMatchObject({ renderer: 'retro16-1', rendererChosen: false, camera: 'overview' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
