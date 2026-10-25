import { test, expect } from '@playwright/test';
import { chooseTeam } from './versus-helpers';
import { pauseAutoplay, timepitchMatch } from './timepitch-centre';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

test('compact replay preserves seeking, restart transitions, player selection and languages', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  await page.getByRole('combobox', { name: 'Simulation engine', exact: true }).selectOption('timepitch');
  await page.getByRole('button',{name:'Play match',exact:true}).click();
  // TP224/TP226: unified Match Centre in the broadcast shell, started by itself at 10× (paused here).
  const { view, centre: match, clock, score, speed } = timepitchMatch(page);
  await expect(match).toBeVisible({ timeout: 40000 });
  await pauseAutoplay(match);
  const id = await view.getAttribute('data-match-id');
  const replay = await (await page.request.get(`/api/matches/${id}/replay`)).json();
  expect(replay.format_version).toBe(2);
  expect(replay.events.every((e: object) => !('frame_after' in e))).toBe(true);
  await clock.fill('2700000');
  // The «Restart · players taking their positions» caption is gone with the old view; the scorebug still has to land
  // on the second-half restart (the restart pose itself is covered by the renderer unit tests).
  await expect(match.locator('[data-unified-scoreboard] .tp-sb-t')).toHaveText('45:00', { timeout: 1500 });
  await expect(match.locator('[data-unified-scoreboard] .tp-sb-half')).toHaveText('2nd half');
  const player = match.getByRole('combobox', { name: 'Inspect player', exact: true });
  // The unified centre namespaces player keys by source (`timepitch:<key>`).
  const selected = `timepitch:${replay.initial_frame.players[1].key}`;
  // TP226: in the broadcast shell the inspector lives in the folded picture settings under the playback bar (TP210);
  // choosing a player opens the «Player card» screen and, back to the broadcast, the selection is kept.
  await match.locator('.tp-pitch-settings-host > details > summary').click();
  await player.selectOption(selected);
  await match.getByRole('tab', { name: 'Live broadcast', exact: true }).click();
  const shown = (await score.textContent())!;
  // Choosing a player opens the player-card drawer (fixed, right side), which covers the header's language switch and the
  // speed buttons; operate them by keyboard, as a keyboard user would, so the selection is kept.
  await page.getByRole('button', { name: 'Language: Español' }).focus();await page.keyboard.press('Enter');
  await expect(match.locator('[data-unified-scoreboard] .tp-sb-half')).toHaveText('2.ª parte');
  await expect(match.getByRole('combobox', { name: 'Consultar jugador', exact: true })).toHaveValue(selected);
  await expect(score).toHaveText(shown);
  await page.getByRole('button', { name: 'Idioma: English' }).focus();await page.keyboard.press('Enter');
  await clock.fill('1800000');
  const goals = replay.events.filter((e: {type: string; t1_ms: number}) => e.type === 'goal' && e.t1_ms <= 1800000);
  const count = (side: string) => goals.filter((e: {side: string}) => e.side === side).length;
  await expect(score).toHaveText(`${count('home')}–${count('away')}`);
  for (const rate of ['1', '5', '20', '60', '120']) {
    await speed(rate).focus();await page.keyboard.press('Enter');
    await expect(speed(rate)).toHaveAttribute('aria-pressed', 'true');
    await expect(match.getByRole('combobox', { name: 'Inspect player', exact: true })).toHaveValue(selected);
  }
  await page.screenshot({ path: `../.local/qa/movement-${test.info().project.name}.png`, fullPage: true });
  expect((await (await page.request.get(`/api/matches/${id}/replay`)).json()).trace_hash).toBe(replay.trace_hash);
  expect(errors).toEqual([]);
});

test('the frozen previous engine replay remains labelled and exportable', async ({ page }) => {
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  await page.getByRole('combobox', { name: 'Simulation engine', exact: true }).selectOption('timepitch');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByLabel('Import replay file', { exact: true })).toBeEnabled();
  const raw = inflateSync(readFileSync('../backend/tests/fixtures/legacy-engine1.json.zlib'));
  const original = JSON.parse(raw.toString());
  await page.getByLabel('Import replay file', { exact: true }).setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: raw });
  const { view, centre: match } = timepitchMatch(page);
  await expect(match).toBeVisible({ timeout: 40000 });
  const id = await view.getAttribute('data-match-id');
  expect((await (await page.request.get(`/api/matches/${id}/replay`)).json()).trace_hash).toBe(original.trace_hash);
  // TP224: the unified centre no longer prints «Previous engine version»; the frozen version stays labelled in the
  // recorded source details (engine version and `legacy`) and the replay stays exportable.
  await expect(view).toHaveAttribute('data-engine-version', original.engine_version);
  // TP239: los datos técnicos van plegados en la columna del partido (sin pestaña «Data»).
  await match.getByText('Technical details', { exact: true }).click();
  const source = match.locator('[data-technical] details').filter({ has: page.locator('summary', { hasText: /^Source$/ }) });
  await source.locator('summary').click();
  await expect(source).toContainText(`"engine": "${original.engine_version}"`);
  await expect(source).toContainText('"legacy": true');
  await expect(match.getByRole('link', { name: 'Export replay', exact: true })).toHaveAttribute('href', `/api/matches/${id}/replay`);
  await page.getByRole('button', { name: 'Language: Español' }).click();
  await expect(match.getByRole('link', { name: 'Exportar reproducción', exact: true })).toBeVisible();
});

test('four formations and a mirror keep 22 side-scoped identities in the rendered replay', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  await page.getByRole('combobox', { name: 'Simulation engine', exact: true }).selectOption('timepitch');
  // This checks rendering/identity. Random seed coverage lives in seed.spec.ts;
  // engine invalid_flight for seed 3061007205 is recorded separately in TP027.
  await page.getByRole('checkbox',{name:'Use a fixed seed',exact:true}).check();
  await page.getByLabel('Simulation seed',{exact:true}).fill('42');
  for (const formation of ['4-4-2', '4-3-3', '3-5-2', '4-5-1']) {
    const home = page.getByRole('article', { name: 'Home team', exact: true });
    const away = page.getByRole('article', { name: 'Away team', exact: true });
    await chooseTeam(page, 'away', 'arsenal:2003');
    await home.getByRole('combobox', { name: 'Formation', exact: true }).selectOption(formation);
    await page.getByRole('button',{name:'Play match',exact:true}).click();
    const { view, centre: match } = timepitchMatch(page);
    await expect(match).toBeVisible({ timeout: 40000 });
    const id = await view.getAttribute('data-match-id');
    const replay = await (await page.request.get(`/api/matches/${id}/replay`)).json();
    expect(new Set(replay.initial_frame.players.map((p: {key: string}) => p.key)).size).toBe(22);
    expect(replay.config.home_formation).toBe(formation);
    await expect(match.getByRole('img', { name: 'Pitch with 22 players and the ball' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await match.getByRole('button', { name: 'New match', exact: true }).click();
  }
});
