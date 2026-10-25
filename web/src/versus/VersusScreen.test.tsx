import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LanguageProvider } from '../i18n';
import type { PlayerSeason, TeamSeason, TeamSummary } from '../api';
import { VersusScreen, type VersusSide } from './VersusScreen';

const summary = (club: string, name: string, year: number): TeamSummary => ({
  key: `${club}:${year}`, club, name, season_start: year, season_label: `${year}/${String(year + 1).slice(-2)}`,
  source: 'epldata', results_sources: ['football-data'], dataset_version: 'fixture', player_count: 2, matches: 38,
  goals_for: 1, goals_against: 1, available_formations: [], coverage: {}, quality_flags: [],
});
const stat = (value: number | null, status: 'measured' | 'estimated' = 'measured') =>
  ({ value, source: 'epldata', status: value == null ? 'unavailable' as const : status, unit: 'count' });
const player = (key: string, name: string, role: PlayerSeason['role'], goals: number, assists: number): PlayerSeason => ({
  key, source_id: key.split(':').at(-1)!, name, role, quality_flags: [],
  stats: { goals: stat(goals), assists: stat(assists), appearances: stat(30), minutes: stat(2500, 'estimated') },
});
const TEAMS = [summary('arsenal', 'Arsenal', 2003), summary('swindon', 'Swindon Town', 1993), summary('arsenal', 'Arsenal', 1992)];
const season = (s: TeamSummary, players: PlayerSeason[]): TeamSeason => ({ ...s, players });
const arsenal = season(TEAMS[0], [player('epldata:2003:arsenal:HENRYT', 'Thierry Henry', 'FWD', 30, 18), player('epldata:2003:arsenal:PIRESR', 'Robert Pires', 'MID', 14, 20)]);
const swindon = season(TEAMS[1], [player('epldata:1993:swindon:X', 'Jan Fjørtoft', 'FWD', 12, 3)]);

// TP214: Swindon lleva una sanción de prueba (dato inventado del fixture) para comprobar cómo se pinta.
const deduction = { club: 'swindon', season_start: 1993, points: 9, reason: 'Fixture reason.', reason_es: 'Motivo de prueba.', licence: 'CC BY-SA 4.0 · English Wikipedia',
  source: { title: '1993–94 FA Premier League', revid: 123, revision_timestamp: '2026-01-01T00:00:00Z', url: 'https://en.wikipedia.org/w/index.php?oldid=123' } };
const record = (key: string, position: number) => ({ key, club: key.split(':')[0], season_start: Number(key.split(':')[1]), season_label: '',
  played: 38, wins: 26, draws: 12, losses: 0, goals_for: 73, goals_against: 26, goal_difference: 47,
  points: key.startsWith('swindon') ? 81 : 90, raw_points: 90, deduction: key.startsWith('swindon') ? deduction : null, position, position_shared: false,
  teams: 20, results_sources: ['football-data'], points_rule: 'win3_draw1', point_deductions: 'applied', deductions_version: 'x', dataset_version: 'x' });
const meeting = { season_start: 1993, date: '1994-01-01', home: 'arsenal', away: 'swindon', home_goals: 1, away_goals: 1, source: 'football-data' };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/record')) return json(record(decodeURIComponent(url.split('/teams/')[1].split('/')[0]), url.includes('swindon') ? 22 : 1));
    if (url.includes('head-to-head')) return json({ club_a: 'arsenal', club_b: 'swindon', played: 2, wins_a: 1, draws: 1, wins_b: 0, goals_a: 5, goals_b: 1,
      first_season: 1993, last_season: 1993, biggest_win_a: { ...meeting, home: 'swindon', away: 'arsenal', home_goals: 0, away_goals: 4 }, biggest_win_b: null,
      last_meeting: meeting, results_sources: ['football-data'], seasons_covered: [1993], dataset_version: 'x' });
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function side(key: string, team: TeamSeason | null, setKey = vi.fn()): VersusSide { return { key, setKey, team, failed: false }; }
function mount(home: VersusSide, away: VersusSide, onPlay = vi.fn(), options?: { controls?: ReactNode }) {
  render(<LanguageProvider><VersusScreen teams={TEAMS} home={home} away={away} onPlay={onPlay} playControls={options?.controls} /></LanguageProvider>);
}

describe('VersusScreen (TP213)', () => {
  it('shows record and star at once, one Play button and the rest in Options; no demo, rivalry or "More details" (TP240)', async () => {
    mount(side('arsenal:2003', arsenal), side('swindon:1993', swindon), vi.fn(), { controls: <label>Engine<select /></label> });
    expect(screen.getByRole('heading', { name: 'Thierry Henry' })).toBeInTheDocument();
    expect(await screen.findByText('1st')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Play match/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Watch the demo|More details/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Rivalry' })).toBeNull();
    const options = screen.getByText('Options').closest('details')!;
    expect(options).not.toHaveAttribute('open');
    expect(within(options).getByLabelText('Engine')).toBeInTheDocument();
  });
  it('shows both teams, their real season record, the star player and the real head-to-head', async () => {
    const onPlay = vi.fn();
    mount(side('arsenal:2003', arsenal), side('swindon:1993', swindon), onPlay);
    const home = screen.getByRole('region', { name: 'Home: Arsenal 2003/04' });
    expect(await within(home).findByText('1st')).toBeInTheDocument();
    expect(within(home).getByRole('heading', { name: 'Thierry Henry' })).toBeInTheDocument();
    // TP240: sin etiquetas de procedencia en la portada.
    expect(home.querySelector('.chip')).toBeNull();
    const away = screen.getByRole('region', { name: 'Away: Swindon Town 1993/94' });
    expect(await within(away).findByText('22nd')).toBeInTheDocument();
    expect(within(away).queryByText('No player card')).toBeNull();
    // TP214: puntos tras la sanción, nota breve y fuente con revisión; sin sanción no hay nota.
    expect(within(away).getByText('81')).toBeInTheDocument();
    expect(within(away).getByText('−9 deducted')).toBeInTheDocument();
    expect(within(away).getByText(/9-point deduction \(90 points by results\)\. Fixture reason\./)).toBeInTheDocument();
    expect(within(away).getByRole('link', { name: /1993–94 FA Premier League · rev\. 123 · CC BY-SA 4\.0/ })).toHaveAttribute('href', deduction.source.url);
    expect(within(home).queryByText(/deducted/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Play match/ }));
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it('never asks for the head-to-head: the rivalry strip is gone (TP240)', async () => {
    mount(side('arsenal:2003', arsenal), side('swindon:1993', swindon));
    expect(await screen.findAllByText(/1st|22nd/)).not.toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('head-to-head'))).toBe(false);
  });

  it('picks for the active side from the full catalogue; shortcuts never limit it', () => {
    const setHome = vi.fn(), setAway = vi.fn();
    mount(side('arsenal:2003', arsenal, setHome), side('swindon:1993', swindon, setAway));
    // TP225: el selector no está en la pantalla; lo abre el botón de cada tarjeta.
    expect(screen.queryByRole('dialog')).toBeNull();
    const home = screen.getByRole('region', { name: 'Home: Arsenal 2003/04' });
    fireEvent.click(within(home).getByRole('button', { name: 'Change team' }));
    const picker = screen.getByRole('dialog', { name: 'Choose a team' });
    expect(picker).toHaveAttribute('aria-modal', 'true');
    expect(within(picker).getByRole('searchbox', { name: 'Search club or season' })).toHaveFocus();
    expect(within(picker).getByText('Choosing the home team')).toBeInTheDocument();
    expect(within(picker).getByText('3 of 3 team-seasons')).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('button', { name: '1992–99' }));
    expect(within(picker).getByRole('button', { name: '1992–99' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(picker).getByRole('button', { name: /^Away/ }));
    expect(within(picker).getByText('Choosing the away team')).toBeInTheDocument();
    fireEvent.change(within(picker).getByRole('searchbox', { name: 'Search club or season' }), { target: { value: '1992' } });
    fireEvent.click(within(picker).getByRole('button', { name: /Arsenal.*1992\/93/ }));
    expect(setAway).toHaveBeenCalledWith('arsenal:1992');
    expect(setHome).not.toHaveBeenCalled();
    // Elegir cierra la capa.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('opens from a click anywhere on the card; Escape closes, focus is trapped and returns to the card button (TP225)', async () => {
    const setAway = vi.fn();
    mount(side('arsenal:2003', arsenal), side('swindon:1993', swindon, setAway));
    const away = screen.getByRole('region', { name: 'Away: Swindon Town 1993/94' });
    fireEvent.click(within(away).getByRole('heading', { name: 'Swindon Town' }));
    const picker = screen.getByRole('dialog', { name: 'Choose a team' });
    expect(within(away).getByRole('button', { name: 'Change team' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(picker).getByText('Choosing the away team')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    // Tab desde el último elemento vuelve al primero (y Mayús+Tab al revés).
    const focusables = [...picker.querySelectorAll<HTMLElement>('button:not([disabled]), input, select')];
    focusables.at(-1)!.focus();
    fireEvent.keyDown(focusables.at(-1)!, { key: 'Tab' });
    expect(focusables[0]).toHaveFocus();
    fireEvent.keyDown(focusables[0], { key: 'Tab', shiftKey: true });
    expect(focusables.at(-1)).toHaveFocus();
    // Escape cierra sin elegir y devuelve el foco al botón de la tarjeta.
    const search = within(picker).getByRole('searchbox', { name: 'Search club or season' });
    fireEvent.change(search, { target: { value: 'Swindon' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(setAway).not.toHaveBeenCalled();
    await waitFor(() => expect(within(away).getByRole('button', { name: 'Change team' })).toHaveFocus());
    // Intro en la búsqueda elige el primer resultado.
    fireEvent.click(within(away).getByRole('button', { name: 'Change team' }));
    const again = screen.getByRole('dialog', { name: 'Choose a team' });
    fireEvent.change(within(again).getByRole('searchbox'), { target: { value: 'Swindon' } });
    fireEvent.keyDown(within(again).getByRole('searchbox'), { key: 'Enter' });
    expect(setAway).toHaveBeenCalledWith('swindon:1993');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('speaks Spanish', async () => {
    localStorage.setItem('timepitch.locale', 'es');
    try {
      mount(side('arsenal:2003', arsenal), side('swindon:1993', swindon));
      expect(screen.getByRole('button', { name: /Jugar partido/ })).toBeInTheDocument();
      expect(await screen.findByText('1.º')).toBeInTheDocument();
      expect(await screen.findByText('−9 sanción')).toBeInTheDocument();
      expect(screen.getByText(/Sanción de 9 puntos \(90 puntos por resultados\)\. Motivo de prueba\./)).toBeInTheDocument();
      expect([...document.querySelectorAll('.vs-star .vs-kicker')].map(e => e.textContent)).toEqual(['★ Estrella', '★ Estrella']);
    } finally { localStorage.removeItem('timepitch.locale'); }
  });
  it('keeps the W-D-L record on one line in narrow cards (TP217)', async () => {
    mount(side('arsenal:2003', arsenal), side('swindon:1993', swindon), vi.fn());
    const home = screen.getByRole('region', { name: 'Home: Arsenal 2003/04' });
    expect(await within(home).findByText('26-12-0')).toBeInTheDocument();
    expect(within(home).getByText('26-12-0').closest('div')).toHaveClass('vs-record-wdl');
    expect(home.querySelector('.vs-record-wrap > .vs-record')).not.toBeNull();
    // TP225: la línea de balance trae posición, puntos, G-E-P y GF-GC.
    expect([...home.querySelectorAll('.vs-record dt')].map(e => e.textContent)).toEqual(['Position', 'Points', 'W-D-L', 'GF-GA']);
    expect(within(home).getByText('73-26')).toBeInTheDocument();
    // Vitest no procesa CSS: se lee la hoja fuente (cwd = web/).
    const moduleName = 'node:fs', fs = await import(/* @vite-ignore */ moduleName) as { readFileSync(path: string, encoding: 'utf8'): string };
    const css = fs.readFileSync('src/versus/versus.css', 'utf8');
    expect(css).toMatch(/\.vs-record-wrap\s*\{\s*container:\s*vs-rec \/ inline-size;/);
    expect(css).toMatch(/\.vs-record dd\s*\{\s*white-space:\s*nowrap;/);
    expect(css).toMatch(/@container vs-card \(max-width: 470px\)/);
  });
});
