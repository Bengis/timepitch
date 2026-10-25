import {test,expect} from '@playwright/test';
import {fullFixture} from '../src/grf/test-fixtures';
import {summaryFixture} from '../src/grf/statistics/test-fixtures';
import {chooseTeam} from './versus-helpers';

test('historical crests follow selection, survive mobile layout and identify saved matches',async({page})=>{
  const replay=fullFixture(),summary=summaryFixture();
  replay.input.config.home_key='arsenal:1992';replay.input.config.away_key='mancity:1992';
  replay.input.home_name='Arsenal';replay.input.away_name='Manchester City';
  const job={id:'crest-layout',state:'ready',config:replay.input.config,summary:{home_name:'Home club',away_name:'Away club',score:summary.score}};
  await page.route('**/api/grf/matches',route=>route.fulfill({json:[job]}));
  await page.route('**/api/grf/matches/crest-layout',route=>route.fulfill({json:job}));
  await page.route('**/api/grf/matches/crest-layout/replay',route=>route.fulfill({json:replay}));
  await page.route('**/api/grf/matches/crest-layout/statistics',route=>route.fulfill({json:summary}));
  await page.goto('/');
  const home=page.locator('.team-panel.home');
  await expect(home.locator('.team-crest img')).toHaveAttribute('src','/assets/crests-hd/arsenal-2002.svg');
  // TP213: teams are chosen in the VERSUS picker; the team panels below still show the chosen club's crest.
  await chooseTeam(page,'home','arsenal:2024');
  await expect(home.locator('.team-crest img')).toHaveAttribute('src','/assets/crests/arsenal-2024.png');
  await chooseTeam(page,'home','arsenal:2025');
  await expect(home.locator('.team-crest img')).toHaveAttribute('src','/assets/crests-hd/arsenal-2002.svg');
  await chooseTeam(page,'home','arsenal:1992');
  await expect(home.locator('.team-crest img')).toHaveAttribute('src','/assets/crests/arsenal-1990.gif');
  await chooseTeam(page,'away','mancity:1992');
  await expect(page.locator('.team-panel.away .team-crest img')).toHaveAttribute('src','/assets/crests/mancity-1981.gif');
  for(const scheme of ['light','dark'] as const){
    await page.emulateMedia({colorScheme:scheme});
    await page.setViewportSize({width:320,height:780});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(home.locator('.team-crest img')).toBeVisible();
    expect(await home.locator('.team-crest img').evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
  }
  await page.getByRole('navigation').getByRole('button',{name:'Library',exact:true}).click();
  const saved=page.getByRole('button',{name:/Home club — Away club/});
  await expect(saved.locator('.team-crest')).toHaveCount(2);
  await saved.click();
  // TP200: the match header is the broadcast scorebug; each side carries its crest.
  const scorebug=page.locator('[data-unified-scoreboard] .tp-scorebug');
  await expect(scorebug.locator('.tp-sb-crest')).toHaveCount(2);
  await expect(scorebug.locator('.tp-sb-crest img')).toHaveCount(2);
  await expect(scorebug.locator('.tp-sb-team--home .tp-sb-crest img')).toHaveAttribute('src','/assets/crests/arsenal-1990.gif');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('historical-crests-mobile.png')});
});
