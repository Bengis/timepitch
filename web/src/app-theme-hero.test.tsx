// TP215: la app es solo oscura y la portada de TimePitch vuelve arriba de la pantalla principal como asset del build.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {LanguageProvider} from './i18n';
import App from './App';
import * as api from './api';
import * as historical from './historical/api';
vi.mock('./api',async()=>({...await vi.importActual('./api'),getTeams:vi.fn(),getTeam:vi.fn(),getMatches:vi.fn(),getGrfMatches:vi.fn(),getEngines:vi.fn()}));
vi.mock('./historical/api',async()=>({...await vi.importActual('./historical/api'),readCapabilities:vi.fn()}));
beforeEach(()=>{
  window.location.hash='';vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  vi.mocked(api.getTeams).mockResolvedValue([]);vi.mocked(api.getTeam).mockRejectedValue(new Error('No squad'));
  vi.mocked(api.getMatches).mockResolvedValue([]);vi.mocked(api.getGrfMatches).mockResolvedValue([]);vi.mocked(api.getEngines).mockResolvedValue([]);
  vi.mocked(historical.readCapabilities).mockRejectedValue(new Error('No capabilities'));
});
afterEach(()=>vi.restoreAllMocks());

// TP237 («simplifica»): sin portada ni cifras; la frase dice lo que se puede hacer y a la vista quedan motor,
// gráficos y jugar. Balance, estrella, rivalidad, alineaciones y semilla, en «Más detalles».
it('shows the illustrated cover with one Play button; engine and graphics (no Captain Hane) folded in Options (TP240, EN/ES)',async()=>{
  const {container}=render(<LanguageProvider><App/></LanguageProvider>);
  const hero=container.querySelector('.setup-view .vs-hero') as HTMLElement;
  expect(hero).not.toBeNull();
  expect(within(hero).getByRole('img')).toBeInTheDocument();
  expect(within(hero).getByText(/since 1992\/93 and watch them play/i)).toBeInTheDocument();
  await waitFor(()=>expect(container.querySelector('.vs')).not.toBeNull());
  expect(screen.getByRole('button',{name:'Play match'})).toBeVisible();
  expect(screen.queryByRole('button',{name:/Watch the demo|More details/})).toBeNull();
  const options=screen.getByText('Options').closest('details')!;
  expect(options).not.toHaveAttribute('open');
  const graphics=within(options).getByRole('combobox',{name:'Graphics',hidden:true}) as HTMLSelectElement;
  expect(graphics).toHaveValue('retro16-1');
  expect([...graphics.options].map(o=>o.value)).toEqual(['retro16-1','stylized-3d-1']);
  expect(within(options).getByRole('combobox',{name:'Simulation engine',hidden:true})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:/Español/}));
  expect(within(hero).getByText(/desde 1992\/93 y míralos jugar/i)).toBeInTheDocument();
});

it('has no light theme left: no light-dark(), no light colour-scheme branch, dark colour-scheme declared',async()=>{
  // Vitest no procesa CSS (?raw llega vacío): se leen los ficheros fuente (cwd = web/).
  const moduleName='node:fs',fs=await import(/* @vite-ignore */ moduleName) as {readFileSync(path:string,encoding:'utf8'):string};
  const read=(path:string)=>fs.readFileSync(path,'utf8');
  const [rootCss,centreCss,playbackCss,broadcastLayoutCss,tokensCss,versusCss,indexHtml]=['src/styles.css','src/match-centre/styles.css',
    'src/match-centre/playback-controls.css','src/match-centre/broadcast-layout.css','src/presentation/tokens.css','src/versus/versus.css','index.html'].map(read);
  for(const css of [rootCss,centreCss,playbackCss,broadcastLayoutCss,tokensCss,versusCss]){
    expect(css).not.toMatch(/light-dark\(/);
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).not.toMatch(/color-scheme\s*:\s*light/);
  }
  expect(centreCss).toMatch(/:root\s*\{\s*color-scheme:\s*dark;/);
  expect(rootCss).toMatch(/:root\s*\{\s*color-scheme:\s*dark;/);
  expect(indexHtml).toMatch(/<meta name="color-scheme" content="dark"/);
});
