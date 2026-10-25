import { expect, test } from '@playwright/test';

// TP237 («simplifica»): arriba, título y una frase (sin portada ni cifras); app solo oscura.
test('main screen opens with a compact title above VERSUS, dark only, without horizontal scroll', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const hero = page.locator('.setup-view .vs-hero');
  await expect(hero.getByRole('heading', { name: 'Football, across eras.' })).toBeVisible();
  await expect(hero.getByText(/since 1992\/93.*two engines.*three graphics modes/)).toBeVisible();
  await expect(hero.getByRole('img')).toHaveCount(0);
  await expect(page.locator('.vs')).toBeVisible();
  const [heroBox, vsBox] = await Promise.all([hero.boundingBox(), page.locator('.vs').boundingBox()]);
  expect(heroBox!.y + heroBox!.height).toBeLessThanOrEqual(vsBox!.y);
  // Aunque el sistema pida tema claro, la app se queda en oscuro.
  const scheme = await page.evaluate(() => [getComputedStyle(document.documentElement).colorScheme, getComputedStyle(document.documentElement).backgroundColor]);
  expect(scheme).toEqual(['dark', 'rgb(5, 8, 15)']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// TP217: VERSUS es la pantalla principal también con el armazón de dos modos (como en producción,
// TIMEPITCH_TWO_MODES_UI=1); la reconstrucción y la biblioteca siguen en el menú y sus enlaces directos funcionan.
test('with two modes, "/" opens VERSUS under Simulation; reconstruction, library and demo links still work', async ({ page }) => {
  await page.route('**/api/historical/capabilities', route => route.fulfill({ json: { two_modes_ui: true, reconstruction_enabled: false, dataset_state: 'absent', dataset_version: null, publication_status: 'blocked_pending_permission' } }));
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  await expect(nav.getByRole('button')).toHaveText(['Simulation', 'Reconstruction', 'Library']);
  await expect(nav.getByRole('button', { name: 'Simulation', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.setup-view .vs-hero')).toBeVisible();
  await expect(page.locator('.vs')).toBeVisible();
  await expect(page.locator('.simulation-subnav')).toHaveCount(0);
  // TP225: también con el menú de dos modos (producción) «Jugar partido» se ve sin desplazar.
  await expect(page.locator('.vs-cta')).toBeInViewport({ ratio: 1 });
  await nav.getByRole('button', { name: 'Reconstruction', exact: true }).click();
  await expect(page).toHaveURL(/#\/reconstruction$/);
  await expect(page.getByRole('alert')).toContainText('historical archive is unavailable');
  await page.locator('.modes-topbar .wordmark').click();
  await expect(page.locator('.vs')).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Simulation', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.goto('/#/reconstruction/9');
  await expect(nav.getByRole('button', { name: 'Reconstruction', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.setup-view')).toBeHidden();
  await page.goto('/#/library');
  await expect(nav.getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.goto('/#/demo');
  await expect(page.locator('.setup-view')).toBeHidden();
  await expect(page.locator('.library-view')).toBeHidden();
});

// TP225/TP237: en escritorio, lo que hay a la vista (equipos, motor, gráficos, «Jugar partido», demo y «Más detalles»)
// cabe sin desplazar; balance, estrella y rivalidad aparecen al abrir «Más detalles».
for (const [width, height] of [[1440, 900], [1366, 768]]) test(`VERSUS fits one ${width}x${height} viewport`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Simulation engine', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Graphics', exact: true })).toBeVisible();
  await expect(page.locator('.vs-star-name')).toHaveCount(0);
  const bottoms = await page.evaluate(() => ['.vs', '.vs-cta', '.vs-demo-open', '.vs-details-toggle', '.vs-side--away .vs-change'].map(s => document.querySelector(s)!.getBoundingClientRect().bottom));
  for (const bottom of bottoms) expect(bottom).toBeLessThanOrEqual(height);
  await page.getByRole('button', { name: 'More details' }).click();
  await expect(page.locator('.vs-record-wdl dd')).toHaveCount(2);
  await expect(page.locator('.vs-star-name')).toHaveCount(2);
  await expect(page.locator('.vs-h2h')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// TP237: en el teléfono la fila de lanzamiento se apila bajo las tarjetas (sin barra fija) y el selector ocupa la pantalla.
test('phone: stacked launch row and full-screen picker sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.vs-cta').scrollIntoViewIfNeeded();
  await expect(page.locator('.vs-cta')).toBeInViewport({ ratio: 1 });
  await page.locator('.vs-side--away .vs-change').click();
  const box = await page.getByRole('dialog', { name: 'Choose a team' }).boundingBox();
  expect(box).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

// TP217: el G-E-P («26-12-0») no se parte en dos líneas con las dos tarjetas en columnas estrechas.
for (const width of [880, 1000, 1200]) test(`W-D-L stays on one line at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'More details' }).click();
  const cells = page.locator('.vs-record-wdl dd');
  await expect(cells).toHaveCount(2);
  for (const cell of await cells.all()) {
    await expect(cell).toHaveText(/^\d+-\d+-\d+$/);
    const [height, fontSize, scroll, client] = await cell.evaluate(el => [el.getBoundingClientRect().height, parseFloat(getComputedStyle(el).fontSize), el.scrollWidth, el.clientWidth]);
    expect(height).toBeLessThan(fontSize * 1.8);
    expect(scroll).toBeLessThanOrEqual(client + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
