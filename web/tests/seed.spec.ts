import { test, expect } from '@playwright/test';

test('each automatic simulation sends a new uint32 seed in either engine', async ({ page }) => {
  const seeds: number[] = [];
  await page.route('**/api/engines', route => route.fulfill({ json: [
    { id: 'timepitch', available: true }, { id: 'grf', available: true },
  ] }));
  for (const path of ['/api/matches', '/api/grf/matches']) {
    await page.route(`**${path}`, route => {
      if (route.request().method() !== 'POST') return route.continue();
      seeds.push(route.request().postDataJSON().seed);
      return route.fulfill({ status: 422, json: { detail: 'Test request captured' } });
    });
  }
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  // A repeated random draw must still produce a different next automatic seed.
  await page.evaluate(() => { crypto.getRandomValues = array => { (array as Uint32Array).fill(4294967295); return array; }; });
  const simulate = page.getByRole('button',{name:'Play match',exact:true});
  const engine = page.getByRole('combobox', { name: 'Simulation engine', exact: true });
  for (const selected of ['grf', 'grf', 'timepitch', 'timepitch']) {
    await engine.selectOption(selected);
    const count = seeds.length;
    await simulate.click();
    await expect.poll(() => seeds.length).toBe(count + 1);
    await expect(simulate).toBeEnabled();
  }
  expect(seeds).toEqual([4294967295, 0, 4294967295, 0]);
});

test('fixed seeds are optional, validated and preserved across engines and languages', async ({ page }) => {
  const seeds: number[] = [];
  await page.route('**/api/engines', route => route.fulfill({ json: [
    { id: 'timepitch', available: true }, { id: 'grf', available: true },
  ] }));
  for (const path of ['/api/matches', '/api/grf/matches']) {
    await page.route(`**${path}`, route => {
      if (route.request().method() !== 'POST') return route.continue();
      seeds.push(route.request().postDataJSON().seed);
      return route.fulfill({ status: 422, json: { detail: 'Test request captured' } });
    });
  }
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  const fixed = page.getByRole('checkbox', { name: 'Use a fixed seed', exact: true });
  const seed = page.getByLabel('Simulation seed', { exact: true });
  const simulate = page.getByRole('button',{name:'Play match',exact:true});
  await expect(fixed).not.toBeChecked();
  await expect(seed).toBeDisabled();
  await fixed.check();
  await seed.fill('77');
  await simulate.click();
  await expect.poll(() => seeds.length).toBe(1);
  await expect(simulate).toBeEnabled();
  await page.getByRole('combobox', { name: 'Simulation engine', exact: true }).selectOption('timepitch');
  await page.getByRole('button', { name: 'Language: Español' }).click();
  const spanishSeed = page.getByLabel('Semilla de simulación', { exact: true });
  await expect(spanishSeed).toHaveValue('77');
  await expect(page.getByRole('checkbox', { name: 'Usar una semilla fija', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Jugar partido', exact: true }).click();
  await expect.poll(() => seeds.length).toBe(2);
  expect(seeds).toEqual([77, 77]);
  const spanishSimulate = page.getByRole('button', { name: 'Jugar partido', exact: true });
  await expect(spanishSimulate).toBeEnabled();
  for (const invalid of ['', '-1', '4294967296', '1.5']) {
    await spanishSeed.fill(invalid);
    await expect(spanishSimulate).toBeDisabled();
  }
  await page.getByRole('checkbox', { name: 'Usar una semilla fija', exact: true }).uncheck();
  await expect(spanishSimulate).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
