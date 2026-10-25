import { test, expect } from '@playwright/test';
import { expectBroadcastFits } from './timepitch-centre';

// TP213 · Pantalla principal VERSUS contra el catálogo real: balance, estrella, rivalidad y paso al flujo existente.
// TP225 · Compacta: las tarjetas abren el selector (capa con búsqueda, filtros y teclado) y «Jugar partido» se ve sin desplazar.
test('versus screen: real records, star players, rivalry and play flow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const versus = page.getByRole('region', { name: 'Team select' });
  // Primera visita: el enfrentamiento de la demo viene preseleccionado.
  const home = versus.getByRole('region', { name: 'Home: Arsenal 2003/04' });
  const away = versus.getByRole('region', { name: 'Away: Manchester City 2024/25' });
  // TP237: a la vista, equipos, motor, gráficos y «Jugar partido»; balance, estrella y rivalidad en «Más detalles».
  await expect(home.getByRole('button', { name: 'Change team' })).toBeVisible();
  if (test.info().project.name === 'desktop') {
    await expect(versus.getByRole('button', { name: /Play match/ })).toBeInViewport({ ratio: 1 });
    await expect(away.getByRole('button', { name: 'Change team' })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.querySelector('.vs')!.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  }
  await expect(home.locator('.vs-record-pos dd')).toHaveCount(0);
  await versus.getByRole('button', { name: 'More details' }).click();
  await expect(home.locator('.vs-record-pos dd')).toHaveText('1st of 20');
  await expect(home.getByText('26-12-0', { exact: true })).toBeVisible();
  await expect(home.getByText('73-26', { exact: true })).toBeVisible();
  await expect(home.getByRole('heading', { name: 'Thierry Henry' })).toBeVisible();
  await expect(away.getByRole('heading', { name: 'Erling Haaland' })).toBeVisible();
  await expect(away.getByText('Unsourced features · assigned by hand', { exact: true })).toBeVisible();


  const rivalry = versus.getByRole('region', { name: 'Rivalry' });
  await expect(rivalry.getByText(/Fictional cross-era match: Arsenal 2003\/04 against Manchester City 2024\/25/)).toBeVisible();
  await expect(rivalry.getByText('Last meeting')).toBeVisible();
  await expect(rivalry.getByText(/Premier League 1992\/93–2025\/26/)).toBeHidden();
  await rivalry.getByRole('button', { name: 'See more' }).click();
  await expect(rivalry.getByText(/Premier League 1992\/93–2025\/26/)).toBeVisible();

  // El selector se abre desde la tarjeta; Escape lo cierra y devuelve el foco.
  await away.getByRole('button', { name: 'Change team' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a team' });
  await expect(picker.getByRole('searchbox', { name: 'Search club or season' })).toBeFocused();
  await expect(picker.getByText('Choosing the away team')).toBeVisible();
  await expect(picker.getByText('686 of 686 team-seasons')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(away.getByRole('button', { name: 'Change team' })).toBeFocused();

  // Mismo club en otra temporada: clásico de su propia historia.
  await away.getByRole('button', { name: 'Change team' }).click();
  await picker.getByRole('searchbox', { name: 'Search club or season' }).fill('Arsenal 1992');
  await picker.getByRole('button', { name: /Arsenal.*1992\/93/ }).click();
  await expect(picker).toBeHidden();
  await expect(versus.getByRole('region', { name: 'A classic from its own history' })).toBeVisible();
  await expect(versus.getByRole('region', { name: 'Away: Arsenal 1992/93' }).locator('.vs-record-pos dd')).toHaveText('10th of 22');

  // Teclado: Intro en la búsqueda elige el primer resultado.
  await versus.getByRole('region', { name: 'Away: Arsenal 1992/93' }).getByRole('button', { name: 'Change team' }).click();
  await picker.getByRole('searchbox', { name: 'Search club or season' }).fill('Leicester 2015');
  await page.keyboard.press('Enter');
  await expect(versus.getByRole('region', { name: 'Away: Leicester City 2015/16' })).toBeVisible();

  await page.getByRole('button', { name: 'Language: Español' }).click();
  await expect(page.getByRole('region', { name: 'Selección de equipos' }).getByRole('button', { name: /Jugar partido/ })).toBeVisible();
  // TP236: «Jugar partido» simula directamente; al lado, los gráficos (Capitán Hane de serie). El resto, plegado.
  await expect(page.getByRole('combobox', { name: 'Gráficos', exact: true })).toHaveValue('anime-1');
  // TP237: el motor también está a la vista; alineaciones, balance y rivalidad, en «Más detalles».
  await expect(page.getByRole('combobox', { name: 'Motor de simulación' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Más detalles' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('article', { name: 'Equipo visitante', exact: true }).getByRole('heading', { name: 'Leicester City', exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Ver la demo' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

// TP226: «Ver la demo» desde VERSUS abre la emisión en la misma pestaña y arranca sola (10×), cabiendo en la pantalla;
// con movimiento reducido no arranca y ofrece un botón grande de reproducir. Sin grabaciones servidas se omite.
for (const reduced of [false, true]) test(`demo from VERSUS ${reduced ? 'waits for a big play button with reduced motion' : 'starts by itself'}`, async ({ page }) => {
  const head = await page.request.get('/replays/arsenal2003-mancity2024-43/touchlines-cal3.json.gz');
  test.skip(!head.ok() || !!head.headers()['content-type']?.includes('html'), 'Demo recordings are not served here (.local/replays-dist).');
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Watch the demo' }).click();
  const centre = page.locator('[data-unified-match-centre][data-source=recorded]');
  await expect(centre).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  if (reduced) {
    await expect(centre.getByRole('button', { name: 'Play the match' })).toBeVisible();
    await expect(centre.locator('.pbk-play')).toHaveAttribute('aria-label', 'Play');
    await centre.getByRole('button', { name: 'Play the match' }).click();
  }
  await expect(centre.locator('.pbk-play')).toHaveAttribute('aria-label', 'Pause');
  await expect(centre.locator('.pbk-speed').getByRole('button', { name: '10×', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectBroadcastFits(page, centre);
});
