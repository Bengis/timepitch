import { test, expect } from '@playwright/test';

test('real catalogue, historical rosters and language switching work locally', async ({ page, baseURL }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL!).origin) externalRequests.push(url.origin);
  });
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  await expect(page.getByRole('heading', { name: 'Football, across eras.' })).toBeVisible();
  const home = page.getByRole('article', { name: 'Home team', exact: true });
  const away = page.getByRole('article', { name: 'Away team', exact: true });
  await expect(home.getByRole('heading', { name: 'Arsenal', exact: true })).toBeVisible();
  await expect(away.getByRole('heading', { name: 'Manchester City', exact: true })).toBeVisible();
  await home.getByText('Season squad and sources',{exact:true}).click();
  await expect(home.locator('.player-name').filter({ hasText: /^Thierry Henry$/ })).toBeVisible();
  await expect(home.locator('tbody tr').filter({ hasText: 'Thierry Henry' }).locator('td').nth(3)).toHaveText('30');
  // TP213/TP225: the team selector is the picker layer opened from each VERSUS card (full catalogue, per side).
  await page.getByRole('region', { name: 'Away: Manchester City 2024/25' }).getByRole('button', { name: 'Change team' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a team' });
  await expect(picker.getByText('686 of 686 team-seasons')).toBeVisible();
  await picker.getByRole('searchbox', { name: 'Search club or season' }).fill('Liverpool');
  await picker.getByRole('combobox', { name: 'Season', exact: true }).selectOption('2018');
  await picker.getByRole('button', { name: /Liverpool.*2018\/19/ }).click();
  await expect(picker).toBeHidden();
  await expect(away.getByRole('heading', { name: 'Liverpool', exact: true })).toBeVisible();
  await expect(away.locator('.player-name').filter({ hasText: /^Nathaniel Clyne$/ })).toBeAttached();
  await page.getByRole('button', { name: 'Language: Español' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { name: 'Fútbol entre épocas.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Enfrentamiento' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Equipo visitante', exact: true }).getByRole('heading', { name: 'Liverpool', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Idioma: Español' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `../.local/qa/catalog-${test.info().project.name}.png`, fullPage: true });
});

test('a failed detail request shows retry and never mislabels the previous roster', async ({ page }) => {
  await page.goto('/');await page.getByRole('button',{name:'More details'}).click();
  const home = page.getByRole('article', { name: 'Home team', exact: true });
  await home.getByText('Season squad and sources',{exact:true}).click();
  await expect(home.locator('.player-name').filter({ hasText: /^Thierry Henry$/ })).toBeVisible();
  await page.route('**/api/catalog/teams/arsenal%3A1992', route => route.fulfill({ status: 503 }));
  await page.getByRole('region', { name: 'Home: Arsenal 2003/04' }).getByRole('button', { name: 'Change team' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a team' });
  await picker.getByRole('searchbox', { name: 'Search club or season' }).fill('Arsenal 1992');
  await picker.getByRole('button', { name: /Arsenal.*1992\/93/ }).click();
  await expect(home.getByRole('alert')).toContainText('Could not load');
  await expect(home.locator('.player-name').filter({ hasText: /^Thierry Henry$/ })).not.toBeAttached();
  await page.unroute('**/api/catalog/teams/arsenal%3A1992');
  await home.getByRole('button', { name: 'Try again' }).click();
  await expect(home.getByRole('heading', { name: 'Arsenal', exact: true })).toBeVisible();
  await home.getByText('Season squad and sources',{exact:true}).click();
  await expect(home.locator('.player-name').filter({ hasText: /^Tony Adams$/ })).toBeVisible();
});
