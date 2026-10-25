// TP249: pantallas de análisis con aspecto de retransmisión (posesión que suma 100, barras desde el centro, botón grande
// al final, un solo control de «hasta aquí / partido completo» y mapas de los simulados con colores y leyenda).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { comparisonRows, possessionShare } from './TeamComparison';
import { StatBar } from './analysis/RecordedAnalysisViews';
import { PlaybackControls } from './PlaybackControls';
import { AnalysisScopeBar } from './AnalysisScopeBar';
import { MatchMaps } from './MatchMaps';
import type { MetricView, PlotView, SessionDescriptor } from './session';
import type { PlaybackState } from './playback';

const teams = { home: { id: 'home', abbr: 'ARS', colour: '#e5484d' }, away: { id: 'away', abbr: 'MCI', colour: '#8ec5ff' } };
const ok = { status: 'available' as const, reason: null };
const metric = (id: string, side: 'home' | 'away', value: number, unit = 'count'): MetricView =>
  ({ id, definition: `d:${id}`, value, unit, provenance: 'simulated', availability: ok, evidenceIds: [], subject: { kind: 'team', id: side } });

describe('Estadísticas de retransmisión', () => {
  it('reparte la posesión entre los dos equipos en enteros que suman 100, con «%» y nombre llano', () => {
    const rows = comparisonRows([metric('possession_pct', 'home', 29.65, 'percent'), metric('possession_pct', 'away', 31.14, 'percent'), metric('goals', 'home', 1), metric('goals', 'away', 0)], teams, 'en');
    expect(rows.find(r => r.id === 'possession_pct')).toMatchObject({ label: 'Possession', home: 49, away: 51, unit: '%' });
    expect(rows.find(r => r.id === 'goals')).toMatchObject({ label: 'Goals', unit: '' });
    expect(comparisonRows([metric('goals', 'home', 1), metric('goals', 'away', 0)], teams, 'es')[0].label).toBe('Goles');
    expect(possessionShare(0, 0)).toBeNull();
  });
  it('la barra crece desde el centro: con 1–0 la mitad local llena y la visitante vacía', () => {
    const { container } = render(<StatBar home={1} away={0} homeColour="red" awayColour="blue" />);
    const [home, away] = [...container.querySelectorAll<HTMLElement>('.tpa-half i')];
    expect(home.style.width).toBe('100%'); expect(away.style.width).toBe('0%');
  });
});

describe('Zona de reproducción', () => {
  const state = (over: Partial<PlaybackState>) => ({ elapsedMs: 120_000, pendingSeekMs: null, speed: 1, wantsPlay: false, isPlaying: false, status: 'ended', ...over }) as PlaybackState;
  const descriptor = { durationMs: 120_000, periods: [{ period: 1, startMs: 0, durationMs: 120_000 }] } as unknown as SessionDescriptor;
  it('al acabar, el botón grande vuelve a empezar (no queda apagado) y no hay otro «Repetir»', () => {
    const onReplay = vi.fn();
    render(<PlaybackControls state={state({})} descriptor={descriptor} cursor={{ elapsedMs: 120_000, period: 1, periodMs: 120_000 }} onPlay={vi.fn()} onPause={vi.fn()} onSeek={vi.fn()} onSpeed={vi.fn()} onReplay={onReplay} />);
    const replay = screen.getByRole('button', { name: 'Replay' });
    expect(replay).toBeEnabled(); expect(replay).toHaveClass('pbk-play');
    fireEvent.click(replay); expect(onReplay).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });
  it('un solo control: revelar, después «hasta aquí / partido completo»; al final, solo «Partido completo»', () => {
    const onReveal = vi.fn(), onScope = vi.fn();
    const view = render(<AnalysisScopeBar revealed={false} final={false} ended={false} clock="63'" onReveal={onReveal} onScope={onScope} />);
    expect(screen.getByText("Up to 63'")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal final analysis' })); expect(onReveal).toHaveBeenCalledOnce();
    expect(screen.queryByRole('combobox')).toBeNull();
    view.rerender(<AnalysisScopeBar revealed final ended={false} clock="63'" onReveal={onReveal} onScope={onScope} />);
    const group = screen.getByRole('group', { name: 'Analysis scope' });
    expect(within(group).getByRole('button', { name: 'Full match' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: "Up to 63'" })); expect(onScope).toHaveBeenCalledWith('cursor');
    expect(screen.queryByRole('button', { name: 'Reveal final analysis' })).toBeNull();
    view.rerender(<AnalysisScopeBar revealed final ended clock="90'" onReveal={onReveal} onScope={onScope} />);
    expect(screen.getByRole('status')).toHaveTextContent('Full match'); expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Mapas de los simulados', () => {
  const ctx = { engineLabel: 'GRF', teams: { home: { name: 'Arsenal', abbr: 'ARS', colour: '#e5484d' }, away: { name: 'Manchester City', abbr: 'MCI', colour: '#8ec5ff' } }, player: () => null };
  const base = { coordinateMeaning: 'metres', definition: 'd', provenance: 'native_observed' as const, availability: ok, columns: [], rows: [] };
  it('tiros con el color de cada equipo, local hacia la derecha, goles rellenos y leyenda con recuentos', () => {
    const shot = (seq: number, side: 'home' | 'away', x: number, outcome: string) => ({ id: String(seq), x, y: 34, value: null, refs: [], scope: { side, phase: 1, outcome, seq } });
    const plot: PlotView = { ...base, id: 'shots', kind: 'shots', points: [shot(1, 'home', 10, 'goal'), shot(2, 'home', 12, 'unresolved'), shot(3, 'away', 95, 'unresolved')] };
    const { container } = render(<MatchMaps plots={[plot]} onSeek={vi.fn()} simple ctx={ctx} />);
    const dots = [...container.querySelectorAll('circle[data-outcome]')];
    expect(dots.map(d => d.getAttribute('stroke'))).toEqual(['#e5484d', '#e5484d', '#8ec5ff']);
    // El local tiraba hacia x = 10 en esa parte: se refleja para que ataque a la derecha; el visitante, a la izquierda.
    expect(Number(dots[0].getAttribute('cx'))).toBe(95); expect(Number(dots[2].getAttribute('cx'))).toBe(10);
    expect(dots[0].getAttribute('fill')).toBe('#e5484d'); expect(dots[1].getAttribute('fill')).not.toBe('#e5484d');
    expect(screen.getByText(/2 shots · 1 goal/)).toBeInTheDocument(); expect(screen.getByText(/1 shot · 0 goals/)).toBeInTheDocument();
  });
  it('posiciones por partes con los dos equipos y sin repetir el campo de la red de pases', () => {
    const pos = (id: string, side: 'home' | 'away', phase: number, x: number) => ({ id, x, y: 30, value: 1, refs: [], scope: { side, phase, player_id: id } });
    const points = [pos('a', 'home', 1, 30), pos('b', 'away', 1, 70), pos('a', 'home', 2, 70), pos('b', 'away', 2, 30)];
    const rows = points.map(p => p.scope);
    const network: PlotView = { ...base, id: 'pass_edges', kind: 'pass_network', nodeLayout: 'positions', rows, points, edges: [{ from: 'a', to: 'b', value: 3, scope: { side: 'home', phase: 1 } }] };
    const positions: PlotView = { ...base, id: 'positions', kind: 'average_positions', rows, points };
    const { container } = render(<MatchMaps plots={[network, positions]} onSeek={vi.fn()} simple ctx={ctx} />);
    expect(container.querySelectorAll('[data-plot-id]')).toHaveLength(1);
    const half = screen.getByRole('group', { name: 'Half' });
    expect(within(half).getByRole('button', { name: '1st half' })).toHaveAttribute('aria-pressed', 'true');
    expect([...container.querySelectorAll('.tpa-node circle')].map(c => c.getAttribute('cx'))).toEqual(['30', '70']);
    fireEvent.click(within(half).getByRole('button', { name: '2nd half' }));
    expect([...container.querySelectorAll('.tpa-node circle')].map(c => c.getAttribute('cx'))).toEqual(['70', '30']);
    expect(screen.queryByText(/ambiguous/i)).toBeNull();
  });
});
