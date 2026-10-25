import {test,expect} from '@playwright/test';

for(const schema_version of ['grf-physical-1','grf-activity-1','grf-actions-1']){
  test(`${schema_version} stays in the library and never mounts the compressed viewer`,async({page})=>{
    const job={id:'physical-saved',state:'ready',config:{home_key:'arsenal:2003',away_key:'mancity:2017'},summary:{score:[0,0],home_name:'Saved Arsenal',away_name:'Saved City'}};
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/grf/matches',route=>route.fulfill({json:[job]}));
    await page.route('**/api/grf/matches/physical-saved',route=>route.fulfill({json:job}));
    await page.route('**/api/grf/matches/physical-saved/replay',route=>route.fulfill({json:{schema_version}}));
    await page.goto('/');
    await page.getByRole('button',{name:'Library',exact:true}).click();
    await page.getByRole('button',{name:/Saved Arsenal — Saved City/}).click();
    await expect(page.getByRole('alert')).toContainText('Physical GRF replays are not yet available in this browser');
    await expect(page.locator('.grf-match-view')).toHaveCount(0);
    await expect(page.getByRole('button',{name:/Saved Arsenal — Saved City/})).toBeEnabled();
    await page.getByRole('button', { name: 'Language: Español' }).click();
    await expect(page.getByRole('alert')).toContainText('Las repeticiones físicas de GRF todavía no están disponibles en este navegador');
    await page.getByRole('button',{name:'Nuevo partido',exact:true}).click();
    await expect(page.getByRole('combobox',{name:'Motor de simulación',exact:true})).toBeVisible();
    expect(errors).toEqual([]);
  });
}
