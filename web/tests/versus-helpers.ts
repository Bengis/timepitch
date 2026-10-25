import { expect, type Page } from '@playwright/test';

/**
 * TP213/TP225: choose a team-season for one side. The card's «Change team» button opens the picker layer for that side;
 * club + season leave exactly one option and choosing it closes the layer.
 */
export async function chooseTeam(page: Page, side: 'home' | 'away', key: string) {
  const [club, season] = key.split(':');
  await page.locator(`.vs-side--${side} .vs-change`).click();
  const picker = page.locator('#vs-picker');
  await expect(picker).toBeVisible();
  await picker.locator('.vs-filters select').nth(0).selectOption(club);
  await picker.locator('.vs-filters select').nth(1).selectOption(season);
  await picker.locator('.vs-grid .vs-option').first().click();
  await expect(picker).toBeHidden();
}
