import { test, expect } from '@playwright/test';
import { chooseTeam } from './versus-helpers';
import { pauseAutoplay, timepitchMatch } from './timepitch-centre';

test('the local demo preserves a replay across playback rates and rejects queue and import failures honestly', async ({ page, context, baseURL }) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { const url = new URL(r.url()); if (url.origin !== new URL(baseURL!).origin) external.push(url.origin); });
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  await page.getByRole('combobox', { name: 'Simulation engine', exact: true }).selectOption('timepitch');
  const home = page.getByRole('article', { name: 'Home team', exact: true });
  const away = page.getByRole('article', { name: 'Away team', exact: true });
  await chooseTeam(page, 'home', 'arsenal:1992');
  await chooseTeam(page, 'away', 'liverpool:2018');
  await expect(home.locator('.season-tag')).toHaveText('1992/93');
  await expect(away.locator('.season-tag')).toHaveText('2018/19');
  await home.getByText('Season squad and sources',{exact:true}).click();
  await expect(home.locator('.roster')).toContainText('Estimated');
  await home.getByRole('combobox', { name: 'Tactic', exact: true }).selectOption('counter');
  await page.route('**/api/matches', async route => { if (route.request().method() === 'POST') await route.fulfill({ status: 429 }); else await route.continue(); });
  await page.getByRole('button',{name:'Play match',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('queue is full');
  await page.unroute('**/api/matches');
  await page.getByRole('button',{name:'Play match',exact:true}).click();
  // TP224/TP226: unified Match Centre in the broadcast shell, started by itself (paused here); speeds are buttons (TP210).
  const { view, centre: match, clock, score, speed } = timepitchMatch(page); await expect(match).toBeVisible();
  await pauseAutoplay(match);
  const id = await view.getAttribute('data-match-id');
  const original = await (await page.request.get(`/api/matches/${id}/replay`)).json();
  for (const rate of ['5', '120']) {
    await speed(rate).click();
    await expect(speed(rate)).toHaveAttribute('aria-pressed', 'true');
    await clock.fill('2700000');
    const events = match.locator('[data-unified-events]');
    await events.getByRole('combobox', { name: 'Event type', exact: true }).selectOption('halftime');
    await events.getByRole('button', { name: /^halftime · / }).click();
    await expect(events.locator('.unified-event-detail')).toContainText('halftime');
    await events.getByRole('combobox', { name: 'Event type', exact: true }).selectOption('');
    await clock.press('End');
    await expect(score).toHaveText(`${original.metrics.home.goals}–${original.metrics.away.goals}`);
  }
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.getByLabel('Import replay file', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"events":[]}') });
  await expect(page.getByRole('alert')).toContainText('incompatible replay');
  await expect(view).toHaveAttribute('data-match-id', id!);
  const cookies = await context.cookies();
  await page.reload();
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.getByRole('button', { name: /Arsenal.*Liverpool.*Ready/ }).click();
  await expect(view).toHaveAttribute('data-match-id', id!);
  expect((await (await page.request.get(`/api/matches/${id}/replay`)).json()).trace_hash).toBe(original.trace_hash);
  expect(cookies.some(cookie => cookie.name === 'timepitch_session' && cookie.httpOnly)).toBe(true);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
