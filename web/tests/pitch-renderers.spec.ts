import { test, expect } from '@playwright/test';
import { unifiedFixture, openUnified } from './unified-fixtures';
import { expect3D, expectFallback, gpuIdentity, graphicsGate, graphicsProbe, readProbe } from './pitch-renderer-checks';

// TP206: the app is 3D-only (TP205). These checks keep the renderer intent on the 3D view and on the automatic fallback.
const score = '[data-unified-scoreboard] .tp-sb-digits';

for (const locale of ['en', 'es']) test(`the 3D pitch preserves all three fixture sources ${locale}`, async ({ page, baseURL }, info) => {
  const gate = await graphicsGate(page, baseURL!); await graphicsProbe(page);
  await page.addInitScript(locale => localStorage.setItem('timepitch.locale', locale), locale);
  const fixture = await unifiedFixture(page);
  for (const source of ['historical', 'grf', 'timepitch']) {
    const centre = await openUnified(page, source), slider = centre.getByRole('slider');
    await expect3D(centre);
    await slider.fill('1000'); await expect(slider).toHaveValue('1000');
    // Explicit seek schedules the existing throttled statistics read. Finish it before measuring graphics-only requests.
    await page.waitForTimeout(1200);
    const shown = await centre.locator(score).textContent(), reads = gate.api.length;
    for (const camera of ['follow', 'overview']) {
      await centre.getByRole('combobox', { name: /^(Camera|Cámara)$/ }).selectOption(camera);
      await expect(centre.locator('canvas')).toHaveAttribute('data-camera', camera);
    }
    for (const light of ['daylight', 'floodlights']) await centre.getByRole('combobox', { name: /^(Lighting|Iluminación)$/ }).selectOption(light);
    await centre.getByRole('combobox', { name: /^(Detail|Detalle)$/ }).selectOption('low');
    const gpu = await gpuIdentity(centre); await info.attach(`${source}-gpu`, { body: JSON.stringify(gpu), contentType: 'application/json' });
    expect(gpu.version).toContain('WebGL 2'); expect(gpu.width).toBeLessThanOrEqual(Math.ceil(gpu.cssWidth * 1.5));
    await expect.poll(async () => (await readProbe(page)).draws).toBeGreaterThan(0);
    await expect3D(centre);
    expect(await slider.inputValue()).toBe('1000'); expect(await centre.locator(score).textContent()).toBe(shown);
    expect(await centre.locator('canvas').count()).toBe(1);
    expect(gate.api.slice(reads)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect(gate.forbidden).toEqual([]); expect(gate.external).toEqual([]); expect(gate.errors).toEqual([]);
  expect(fixture.forbidden).toEqual([]); expect(fixture.unexpected).toEqual([]); fixture.assertImmutable();
});

test('real WebGL loss shows the 2D fallback until an explicit retry, with the same cursor', async ({ page, baseURL }) => {
  const gate = await graphicsGate(page, baseURL!); await graphicsProbe(page); const fixture = await unifiedFixture(page);
  const centre = await openUnified(page, 'grf'); await expect3D(centre); await centre.getByRole('slider').fill('1000');
  await centre.locator('canvas').evaluate(canvas => {
    const extension = (canvas as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Actual context loss extension required'); extension.loseContext();
  });
  await expectFallback(centre);
  await expect(centre.locator('.pitch-status')).toContainText('simplified 2D view');
  await page.waitForTimeout(150); expect(await centre.getByRole('slider').inputValue()).toBe('1000');
  await centre.getByRole('button', { name: 'Retry 3D' }).click(); await expect3D(centre);
  expect((await gpuIdentity(centre)).version).toContain('WebGL 2');
  expect(await centre.getByRole('slider').inputValue()).toBe('1000');
  expect(gate.forbidden).toEqual([]); expect(gate.external).toEqual([]); expect(gate.errors).toEqual([]); fixture.assertImmutable();
});

test('a rejected 3D chunk stays bounded and recovers only on explicit retry', async ({ page, baseURL }) => {
  const gate = await graphicsGate(page, baseURL!); const fixture = await unifiedFixture(page);
  // Built bundle: the manifest exists and the recovery entry must stay self-contained. Vite dev serves no manifest.
  const manifest = await page.request.get('/assets/pitch-renderer-manifest.json');
  const built = manifest.ok() && !!manifest.headers()['content-type']?.includes('json');
  if (built) expect((await manifest.json())['src/match/renderers/three.ts'].imports ?? [], 'Recovery entry must remain self-contained').toEqual([]);
  // The 3D entry: hashed chunk when built, source module under vite dev.
  const chunk = (url: URL) => /\/assets\/three-[^/]*\.js$/.test(url.pathname) || url.pathname.endsWith('/src/match/renderers/three.ts');
  let blocked = 0;
  await page.route(chunk, route => { blocked++; return route.abort(); });
  const centre = await openUnified(page, 'timepitch'); await centre.getByRole('slider').fill('1000');
  await expectFallback(centre);
  await page.waitForTimeout(200); expect(blocked).toBe(1);
  await page.unroute(chunk); await centre.getByRole('button', { name: 'Retry 3D' }).click();
  if (built) await expect3D(centre);
  else {
    // Recovery re-imports the hashed chunk named by the build manifest (registry.ts); vite dev keeps the failed module.
    test.info().annotations.push({ type: 'dev-server', description: 'Retry recovery is only verifiable against a built bundle.' });
    await expectFallback(centre);
  }
  expect(await centre.getByRole('slider').inputValue()).toBe('1000');
  expect(gate.forbidden).toEqual([]); expect(gate.external).toEqual([]); expect(gate.errors).toEqual([]); fixture.assertImmutable();
});

test('twenty hide cycles release listeners, observers and real GPU contexts', async ({ page, baseURL }, info) => {
  const gate = await graphicsGate(page, baseURL!); await graphicsProbe(page); const fixture = await unifiedFixture(page);
  const centre = await openUnified(page, 'grf'); await expect3D(centre); const baseline = await readProbe(page);
  expect(baseline.contexts).toBe(1);
  for (let index = 0; index < 20; index++) {
    await centre.getByRole('tab', { name: 'Maps', exact: true }).click();
    expect(await centre.locator('canvas').count()).toBe(0);
    await expect.poll(async () => (await readProbe(page)).contexts).toBe(0);
    await centre.getByRole('tab', { name: 'Match', exact: true }).click(); await expect3D(centre);
    await expect.poll(async () => (await readProbe(page)).contexts).toBe(1);
    expect((await readProbe(page)).listeners).toBe(baseline.listeners);
    expect((await readProbe(page)).observers).toBe(baseline.observers);
    expect(await centre.locator('canvas').count()).toBe(1);
  }
  await centre.getByRole('tab', { name: 'Maps', exact: true }).click();
  expect(await centre.locator('canvas').count()).toBe(0);
  await expect.poll(async () => (await readProbe(page)).contexts).toBe(0);
  const after = await readProbe(page); expect(after.observers).toBe(0); expect(after.listeners).toBe(0);
  expect(after.buffers).toBe(0); expect(after.textures).toBe(0); expect(after.programs).toBe(0);
  await info.attach('lifecycle-counters', { body: JSON.stringify({ baseline, after }), contentType: 'application/json' });
  expect(gate.forbidden).toEqual([]); expect(gate.external).toEqual([]); expect(gate.errors).toEqual([]); fixture.assertImmutable();
});

test('fresh profiles open in Retro 16-bit, implicit v1 preferences migrate to it and 3D stays an explicit choice (TP223)', async ({ page, baseURL }) => {
  const gate = await graphicsGate(page, baseURL!, { graphics: 'default' }); const fixture = await unifiedFixture(page);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('timepitch.pitch.v1') ?? '{}'));
  let centre = await openUnified(page, 'historical');
  const pitch = () => centre.locator('.pitch-section');
  await expect(pitch()).toHaveAttribute('data-renderer-status', 'ready');
  await expect(pitch()).toHaveAttribute('data-effective-renderer', 'retro16-1');
  await expect.poll(stored).toMatchObject({ version: 2, renderer: 'retro16-1', rendererChosen: false });
  // v1 records were written on mount, so 3D there was the old default, not a choice; retired 2D ids too. Both move to
  // Retro 16-bit keeping camera and lighting.
  for (const renderer of ['retro-1', 'stylized-3d-1']) {
    await page.evaluate(r => localStorage.setItem('timepitch.pitch.v1', JSON.stringify({ version: 1, renderer: r, appearance: 'floodlights', camera: 'overview', detail: 'low' })), renderer);
    await page.reload(); centre = page.locator('[data-unified-match-centre][data-source=historical]');
    await expect(pitch()).toHaveAttribute('data-renderer-status', 'ready');
    await expect(pitch()).toHaveAttribute('data-effective-renderer', 'retro16-1');
    await expect(centre.getByRole('combobox', { name: 'Camera', exact: true })).toHaveValue('overview');
    await expect(centre.getByRole('combobox', { name: 'Lighting', exact: true, includeHidden: true })).toHaveValue('floodlights');
    await expect.poll(stored).toMatchObject({ version: 2, renderer: 'retro16-1', rendererChosen: false, camera: 'overview' });
  }
  // Choosing 3D gives real WebGL 2 and is kept after a reload.
  const summary = centre.locator('details.pitch-settings > summary').first();
  if (await summary.count()) await summary.click();
  await centre.getByRole('combobox', { name: 'Graphics', exact: true }).selectOption('stylized-3d-1');
  await expect3D(centre); expect((await gpuIdentity(centre)).version).toContain('WebGL 2');
  await page.reload(); centre = page.locator('[data-unified-match-centre][data-source=historical]');
  await expect3D(centre);
  await expect.poll(stored).toMatchObject({ version: 2, renderer: 'stylized-3d-1', rendererChosen: true });
  expect(gate.forbidden).toEqual([]); expect(gate.external).toEqual([]); expect(gate.errors).toEqual([]); fixture.assertImmutable();
});
