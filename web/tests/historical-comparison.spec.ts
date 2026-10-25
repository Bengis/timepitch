import {test,expect} from '@playwright/test';
import {unifiedFixture} from './unified-fixtures';
import {comparisonFixture} from '../src/historical/test-fixtures';
test.beforeEach(async({page})=>{
  await unifiedFixture(page);
  page.on('request',r=>{if(r.method()==='POST')throw new Error(`Read-only bridge acceptance sent POST: ${new URL(r.url()).pathname}`);});
});
test('recorded matches only offer playback; simulation remains a separate workspace',async({page})=>{
  const matchupReads:string[]=[];page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/')&&u.pathname.includes('/matchup'))matchupReads.push(r.url());});
  await page.goto('/#/reconstruction/9');
  await expect(page.locator('[data-unified-scoreboard]')).toContainText('Home club');
  await expect(page.getByRole('button',{name:'Simulate this matchup',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:'Simulation',exact:true}).click();
  await expect(page).toHaveURL(/#\/simulation\/setup$/);
  await expect(page.getByRole('complementary',{name:'Historical preparation',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Play match',exact:true})).toBeVisible();
  expect(matchupReads).toEqual([]);
  for(const width of [320,1440]){
    await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath(`independent-simulation-${width}.png`),fullPage:true});
  }
});
test('controlled saved-comparison responses preserve definitions, identity and optional session links',async({page})=>{
  // UI fixtures are not real simulation results or model/calibration evidence.
  const config={home_key:'chelsea:2015',away_key:'arsenal:2015',seed:42};
  await page.route('**/api/matches',r=>r.fulfill({json:[{id:'saved-timepitch',state:'ready',config,summary:null}]}));
  await page.route('**/api/grf/matches',r=>r.fulfill({json:[{id:'saved-grf',state:'ready',config,summary:null}]}));
  let reads=0;
  await page.route('**/api/historical/matches/9/comparison?*',r=>{
    reads++;const query=new URL(r.request().url()).searchParams,cmp=comparisonFixture();
    cmp.historical_match_id=9;cmp.historical_dataset_version='v1';cmp.engine=query.get('engine') as 'timepitch'|'grf';cmp.simulation_id=query.get('simulation_id')!;
    cmp.rows[0].historical={home:2,away:0,definition:'final-goal-count'};cmp.rows[0].simulated={home:3,away:1,definition:'final-goal-count'};cmp.rows[0].delta={home:1,away:1};
    if(cmp.engine==='grf'){
      cmp.rows[1].status='unavailable';cmp.rows[1].simulated={home:null,away:null,definition:'unavailable'};
      cmp.rows.push({metric:'shots',historical:{home:4,away:3,definition:'statsbomb-shot-events'},simulated:{home:4,away:3,definition:'grf-native-shot-actions'},status:'different_definition',delta:null,reason:'different_definition'});
    }
    return r.fulfill({json:cmp});
  });
  await page.goto('/#/reconstruction/9');
  await page.getByRole('tab',{name:'Summary',exact:true}).click();await page.getByRole('button',{name:'Reveal final analysis',exact:true}).click();await page.getByRole('button',{name:'Compare with an existing owned simulation',exact:true}).click();
  const chooser=page.locator('.comparison-chooser select');await chooser.selectOption('timepitch/saved-timepitch');
  await expect(page.locator('.comparison-metric').filter({has:page.getByRole('heading',{name:'Expected goals',exact:true})})).toContainText('Different definitions');
  const xg=page.getByRole('table',{name:'Expected goals',exact:true});await expect(xg.getByText('Simulation − recorded',{exact:true})).toHaveCount(0);
  for(const width of [320,1440])for(const scheme of ['light','dark'] as const){
    await page.setViewportSize({width,height:950});await page.emulateMedia({colorScheme:scheme});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath(`comparison-${width}-${scheme}.png`),fullPage:true});
  }
  await page.reload();await page.getByRole('tab',{name:'Summary',exact:true}).click();await page.getByRole('button',{name:'Reveal final analysis',exact:true}).click();await page.getByRole('button',{name:'Compare with an existing owned simulation',exact:true}).click();
  await expect(chooser).toHaveValue('timepitch/saved-timepitch');await expect(xg).toBeVisible();
  await page.evaluate(()=>sessionStorage.clear());await page.reload();await page.getByRole('tab',{name:'Summary',exact:true}).click();await page.getByRole('button',{name:'Reveal final analysis',exact:true}).click();await page.getByRole('button',{name:'Compare with an existing owned simulation',exact:true}).click();
  await expect(chooser).toHaveValue('');await chooser.selectOption('grf/saved-grf');
  await expect(xg.getByText('Not available',{exact:true})).toHaveCount(2);
  const shots=page.getByRole('table',{name:'Shot attempts',exact:true});
  await expect(shots.getByText('Simulation − recorded',{exact:true})).toHaveCount(0);
  await expect(page.getByText(/GRF counts native shot animations/)).toBeVisible();
  await page.getByRole('button', { name: 'Language: Español' }).click();await expect(page.locator('.historical-comparison')).toContainText('Comparación retrospectiva');
  expect(reads).toBeGreaterThanOrEqual(3);
});
