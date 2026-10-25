import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { expect3D, fieldPoint, gpuIdentity, graphicsGate, graphicsProbe, overviewPoint } from './pitch-renderer-checks';

const manifestPath = process.env.TIMEPITCH_PITCH_ACCEPTANCE_MANIFEST;
// TP206: without the private manifest the suite is skipped (not an error), so ordinary runs stay clean.
// Acceptance itself still requires it: a skipped run is not renderer acceptance.
test.skip(!manifestPath, 'Private saved-renderer acceptance: set TIMEPITCH_PITCH_ACCEPTANCE_MANIFEST.');
const manifest = manifestPath ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const auth = manifest ? JSON.parse(readFileSync(manifest.auth_path, 'utf8')) : null;
const raw = (source: string) => JSON.parse(readFileSync(manifest.sources[source].record, 'utf8'));
const privateRoot = manifestPath ? dirname(dirname(manifestPath)) : '';

async function openSaved(page: Page, source: string, baseURL: string) {
  const selected = manifest.sources[source];
  await page.context().addCookies([{ name: 'timepitch_session', value: auth[selected.auth], url: baseURL, httpOnly: true, sameSite: 'Strict' }]);
  if (source === 'historical') await page.goto(`/#/reconstruction/${selected.id}`);
  else {
    await page.goto('/#/library');
    const prefix = source === 'grf' ? '/api/grf/matches' : '/api/matches';
    const response = await page.request.get(prefix); expect(response.ok()).toBe(true);
    const rows = await response.json(), index = rows.findIndex((row: { id: string }) => row.id === selected.id);
    expect(index, 'Selected owner must see the saved record').toBeGreaterThanOrEqual(0);
    const buttons = page.locator(source === 'grf' ? '.grf-history .history-list button' : '.history:not(.grf-history) .history-list button');
    await expect(buttons).toHaveCount(rows.length); await buttons.nth(index).click();
  }
  const centre = page.locator(`[data-unified-match-centre][data-source=${source}]`);
  await expect(centre).toBeVisible(); await expect(centre.getByRole('slider')).toBeEnabled();
  await expect(centre.locator('[data-unified-transport] p[role=status]')).toHaveCount(0);
  return centre;
}
async function seek(centre: Locator, ms: number) {
  await centre.getByRole('slider').fill(String(ms));
  await expect(centre.getByRole('slider')).toHaveValue(String(ms));
  await expect(centre.locator('[data-unified-transport] p[role=status]')).toHaveCount(0);
}
async function recordedFacts(page: Page, source: string) {
  const id = manifest.sources[source].id;
  const paths = source === 'historical' ? [`/api/historical/matches/${id}`, `/api/historical/matches/${id}/events?period=1&from_ms=0&to_ms=60000`, `/api/historical/matches/${id}/statistics?period=1&at_ms=0`]
    : [`/api/${source === 'grf' ? 'grf/' : ''}matches/${id}/replay`, `/api/${source === 'grf' ? 'grf/' : ''}matches/${id}/statistics${source === 'grf' ? '' : '?end_ms=0'}`];
  const values = [];
  for (const path of paths) { const response = await page.request.get(path); expect(response.ok()).toBe(true); values.push(await response.json()); }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
function sourcePlayers(source: string) {
  if (source === 'grf') {
    const record = raw(source), sample = record.samples[0];
    return record.input.players.filter((p: { side: string; slot: number }) => (p.side === 'home' ? sample.home_active : sample.away_active)?.[p.slot] !== false).map((p: { id: string; side: string; slot: number }) => {
      const xy = (p.side === 'home' ? sample.home_xy : sample.away_xy)[p.slot];
      return { key: `grf:${p.id}`, x: (xy[0] + 1) * 52.5, y: (xy[1] + .42) * 68 / .84 };
    });
  }
  if (source === 'timepitch') {
    const record = raw(source), s = record.motion[0];
    return record.initial_frame.players.map((p: { key: string }, i: number) => ({ key: `timepitch:${p.key}`, x: s[10][2 * i] / 1000, y: s[10][2 * i + 1] / 1000 }));
  }
  const expected = JSON.parse(readFileSync(manifest.sources.historical.expected, 'utf8'));
  const segment = JSON.parse(readFileSync(join(manifest.reconstruction, String(manifest.sources.historical.id), '1-0.json'), 'utf8'));
  return segment.frames[0].players.map(([index, x, y]: number[]) => ({ key: `historical:${expected.manifest.roster.find((p: { index: number }) => p.index === index).key}`, x, y }));
}
function sourceFocus(source: string) {
  if (source === 'historical') return { x: 52.5, y: 34 }; // First recorded frame has no known ball.
  const record = raw(source);
  return source === 'grf' ? { x: (record.samples[0].ball_xyz[0] + 1) * 52.5, y: (record.samples[0].ball_xyz[1] + .42) * 68 / .84 }
    : { x: record.motion[0][8] / 1000, y: record.motion[0][9] / 1000 };
}

for (const source of ['grf', 'timepitch', 'historical']) for (const dpr of [1, 1.5, 2]) {
  test(`saved ${source} roots and noncentral picking/projection at DPR${dpr}`, async ({ browser, baseURL }, info) => {
    const viewport = info.project.use.viewport!;
    const context = await browser.newContext({ baseURL, viewport, deviceScaleFactor: dpr, serviceWorkers: 'block' });
    const page = await context.newPage(), gate = await graphicsGate(page, baseURL!); await graphicsProbe(page);
    try {
      const loadingStarted = Date.now(); const centre = await openSaved(page, source, baseURL!);
      await expect3D(centre); const readyMs = Date.now() - loadingStarted; await seek(centre, 0);
      const factsHash = await recordedFacts(page, source);
      const score = await centre.locator('[data-unified-scoreboard] .tp-sb-digits').textContent();
      const facts = await centre.locator('[data-unified-events]').textContent();
      await page.waitForTimeout(150); const reads = gate.api.length;
      await centre.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('overview');
      const gpu = await gpuIdentity(centre); expect(gpu.width).toBeLessThanOrEqual(Math.ceil(gpu.cssWidth * 1.5));
      expect(gpu.height).toBeLessThanOrEqual(Math.ceil(gpu.cssHeight * 1.5));
      expect(gate.api.slice(reads)).toEqual([]);
      const players = sourcePlayers(source) as { key: string; x: number; y: number }[];
      const target = players.find(p => p.x > 12 && p.x < 40 && Math.abs(p.y - 34) > 8 && players.every(q => q.key === p.key || Math.hypot(q.x - p.x, q.y - p.y) > 4));
      expect(target, 'Independent recorded noncentral player required').toBeTruthy();
      const point = await overviewPoint(centre, target!.x, target!.y);
      await info.attach('independent-pick', { body: JSON.stringify({ target, point }), contentType: 'application/json' });
      await page.mouse.click(point.x, point.y);
      await expect(centre.getByRole('combobox', { name: 'Inspect player' })).toHaveValue(target!.key);
      await centre.getByRole('combobox', { name: 'Inspect player' }).selectOption('');
      await centre.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('follow');
      const focus = sourceFocus(source), followTarget = players.find(p => Math.hypot(p.x - focus.x, p.y - focus.y) > 7 && Math.hypot(p.x - focus.x, p.y - focus.y) < 18 && players.every(q => q.key === p.key || Math.hypot(q.x - p.x, q.y - p.y) > 4));
      expect(followTarget, 'Independent source player in follow view required').toBeTruthy();
      const follow = await fieldPoint(centre, followTarget!.x, followTarget!.y, 'follow', focus); await page.mouse.click(follow.x, follow.y);
      await expect(centre.getByRole('combobox', { name: 'Inspect player' })).toHaveValue(followTarget!.key);
      await centre.getByRole('combobox', { name: 'Inspect player' }).selectOption('');
      await centre.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('overview');
      expect(await centre.getByRole('slider').inputValue()).toBe('0');
      expect(await centre.locator('[data-unified-scoreboard] .tp-sb-digits').textContent()).toBe(score);
      expect(await centre.locator('[data-unified-events]').textContent()).toBe(facts);
      expect(await recordedFacts(page, source)).toBe(factsHash);
      if (source === 'historical') {
        const segment = JSON.parse(readFileSync(join(manifest.reconstruction, String(manifest.sources.historical.id), '1-0.json'), 'utf8'));
        const anchor = segment.anchors.find((a: { location: { x: number }; status: string; entity_key: string }) => a.location && a.status === 'placed' && Math.abs(a.location.x - 52.5) > 10 && a.entity_key !== 'ball');
        expect(anchor).toBeTruthy(); await seek(centre, anchor.period_ms);
        const circle = centre.locator(`[data-anchor="${anchor.id}"] circle`); await expect(circle).toBeVisible();
        const expected = await overviewPoint(centre, anchor.location.x, anchor.location.y), actual = (await circle.boundingBox())!;
        expect(Math.abs(actual.x + actual.width / 2 - expected.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(actual.y + actual.height / 2 - expected.y)).toBeLessThanOrEqual(2);
        await centre.getByLabel('Synthetic movement', { exact: true }).uncheck();
        expect(await centre.getByRole('combobox', { name: 'Inspect player' }).locator('option').count()).toBe(1);
        await expect(circle).toBeVisible(); await expect(centre.locator('.unified-provenance')).toContainText('synthetic tracking');
        const followAnchor = segment.anchors.find((a: { location: { x: number; y: number }; status: string }) => a.location && a.status === 'placed' && a.location.x > 35 && a.location.x < 70 && a.location.y > 20 && a.location.y < 40 && Math.abs(a.location.x - 52.5) > 10);
        expect(followAnchor).toBeTruthy(); await seek(centre, followAnchor.period_ms);
        await centre.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('follow');
        const followExpected = await fieldPoint(centre, followAnchor.location.x, followAnchor.location.y, 'follow', { x: 52.5, y: 34 });
        const followCircle = centre.locator(`[data-anchor="${followAnchor.id}"] circle`); await expect(followCircle).toBeVisible(); const followActual = (await followCircle.boundingBox())!;
        expect(Math.abs(followActual.x + followActual.width / 2 - followExpected.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(followActual.y + followActual.height / 2 - followExpected.y)).toBeLessThanOrEqual(2);
      }
      await info.attach('actual-gpu-and-independent-pick', { body: JSON.stringify({ source, dpr, gpu, readyMs, factsHash, knownPoint: { x: target!.x, y: target!.y }, sourceFileHash: source === 'historical' ? null : manifest.sources[source].sha256 }), contentType: 'application/json' });
      expect(gate.forbidden).toEqual([]); expect(gate.external).toEqual([]); expect(gate.errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test('record identical saved GRF segment and bounded historical anchors for visual review', async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'Clips recorded once; mobile graphics are checked by the DPR/source tests.');
  test.setTimeout(240000);
  const directory = join(privateRoot, 'clips'); mkdirSync(directory, { recursive: true });
  const records = [];
  for (const source of ['grf', 'historical']) for (const camera of ['follow', 'overview']) {
    for (const variant of source === 'grf' ? ['daylight', 'floodlights'] : ['daylight']) {
      const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
      const page = await context.newPage(), gate = await graphicsGate(page, baseURL!); await graphicsProbe(page);
      try {
        const centre = await openSaved(page, source, baseURL!);
        const start = source === 'grf' ? 30000 : 1325000, length = source === 'grf' ? 20000 : 8000;
        await expect3D(centre);
        await centre.getByRole('combobox', { name: 'Lighting' }).selectOption(variant);
        await centre.getByRole('combobox', { name: 'Camera', exact: true }).selectOption(camera);
        await centre.getByRole('group', { name: 'Speed', exact: true }).getByRole('button', { name: '1×', exact: true }).click(); await seek(centre, start);
        await centre.locator('canvas').scrollIntoViewIfNeeded();
        const stem = `${source}-${variant}-${camera}`, gpu = await gpuIdentity(centre);
        await centre.locator('.pitch-section').screenshot({ path: join(directory, `${stem}.png`) });
        const clip = await centre.evaluate(async (root, { start, length }) => {
          const canvas = root.querySelector('canvas')!, stream = canvas.captureStream(30);
          const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8';
          const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1800000 }), chunks: Blob[] = [];
          recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
          const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
          recorder.start(200); (root.querySelector('.unified-play') as HTMLButtonElement).click();
          const began = performance.now();
          await new Promise<void>((resolve, reject) => {
            const poll = () => { const cursor = Number((root.querySelector('input[type=range]') as HTMLInputElement).value);
              if (cursor >= start + length) return resolve();
              if (performance.now() - began > length + 15000) return reject(new Error('Saved playback failed to advance; do not fabricate movement'));
              setTimeout(poll, 25); }; poll();
          });
          (root.querySelector('.unified-play') as HTMLButtonElement).click(); recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
          const blob = new Blob(chunks, { type: mimeType }), bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          const probe = (window as unknown as { __pitchGraphicsProbe: { times(): number[] } }).__pitchGraphicsProbe;
          return { base64: btoa(binary), end: Number((root.querySelector('input[type=range]') as HTMLInputElement).value), wallMs: performance.now() - began, mimeType, frameTimes: probe.times().filter(t => t >= began) };
        }, { start, length });
        const file = join(directory, `${stem}.webm`), bytes = Buffer.from(clip.base64, 'base64'); writeFileSync(file, bytes);
        const intervals = clip.frameTimes.slice(1).map((t, i) => t - clip.frameTimes[i]).sort((a, b) => a - b);
        records.push({ source, camera, variant, file: `${stem}.webm`, start, requestedEnd: start + length, actualEnd: clip.end,
          wallMs: clip.wallMs, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), gpu,
          recordedClearIntervals: intervals.length ? { count: intervals.length, medianMs: intervals[Math.floor(intervals.length / 2)], p95Ms: intervals[Math.floor(intervals.length * .95)] } : null });
        expect(clip.end).toBeGreaterThanOrEqual(start + length); expect(gate.forbidden).toEqual([]); expect(gate.external).toEqual([]); expect(gate.errors).toEqual([]);
        writeFileSync(join(directory, 'clips.json'), JSON.stringify({ humanVisualApproval: 'pending', records }, null, 2));
      } finally { await context.close(); }
    }
  }
  await info.attach('clips-receipt', { body: JSON.stringify(records), contentType: 'application/json' });
});

test('record historical UI with the real SVG source anchors', async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'One UI recording; the DPR matrix covers mobile alignment.');
  const directory = join(privateRoot, 'clips'), context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 1000 },
    serviceWorkers: 'block', recordVideo: { dir: join(privateRoot, 'screen-recordings'), size: { width: 1366, height: 1000 } } });
  const page = await context.newPage(), gate = await graphicsGate(page, baseURL!), video = page.video()!;
  try {
    const centre = await openSaved(page, 'historical', baseURL!); await expect3D(centre);
    await centre.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('overview');
    await centre.getByRole('group', { name: 'Speed', exact: true }).getByRole('button', { name: '1×', exact: true }).click(); await seek(centre, 1327000);
    await centre.locator('canvas').scrollIntoViewIfNeeded(); await centre.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(() => centre.locator('[data-anchor] circle').count(), { timeout: 5000 }).toBeGreaterThan(0);
    await centre.locator('.pitch-section').screenshot({ path: join(directory, 'historical-source-anchors.png') });
    await expect.poll(async () => Number(await centre.getByRole('slider').inputValue()), { timeout: 15000 }).toBeGreaterThanOrEqual(1335000);
    await centre.getByRole('button', { name: 'Pause', exact: true }).click();
    expect(gate.forbidden).toEqual([]); expect(gate.external).toEqual([]); expect(gate.errors).toEqual([]);
    await info.attach('historical-ui-recording', { body: JSON.stringify({ source: 'historical', start: 1327000, end: Number(await centre.getByRole('slider').inputValue()), realSvgAnchorsObserved: true, syntheticTracking: true, includesSetupFrames: true }), contentType: 'application/json' });
  } finally { await context.close(); }
  await video.saveAs(join(directory, 'historical-ui-anchors.webm'));
});
