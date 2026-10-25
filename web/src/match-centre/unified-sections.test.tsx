import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatchCentre } from './MatchCentre';
import { MatchMaps } from './MatchMaps';
import { MatchMetricTable } from './MatchMetricTable';
import { screenFixture } from './unified-screen-fixtures';
import { LanguageProvider } from '../i18n';
import type { MatchSource } from './session';
import {createGrfSession} from './adapters/grf';
import {modernGrf} from './adapters/test-fixtures';

vi.mock('../historical/HistoricalComparison', () => ({ HistoricalComparisonPanel: () => <div>Owned read-only comparison</div> }));

describe('shared sections retain availability and provenance', () => {
  it('retains input metadata and an explicit retry when final statistics fail', async () => {
    const statistics=vi.fn().mockRejectedValue(new Error('Offline fixture'));
    const adapter=createGrfSession('saved',modernGrf(),{statistics});
    render(<MatchCentre adapter={adapter} visible onBack={()=>{}} initialSection="data"/>);
    await screen.findByRole('heading',{name:'input'});
    fireEvent.click(screen.getByRole('button',{name:'Reveal final analysis'}));
    await waitFor(()=>expect(statistics).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading',{name:'input'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Retry data read'})).toBeInTheDocument();
  });
  it.each<MatchSource>(['historical', 'grf', 'timepitch'])('%s retains definitions, nullable identity and all metric IDs', source => {
    const f = screenFixture(source); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} initialSection="data" />);
    // TP239: en los simulados los datos técnicos también están plegados en la columna del partido (pueden salir dos veces).
    expect(screen.getAllByText('fixture:distinct-definition').length).toBeGreaterThan(0);
    expect(screen.getAllByText('source:ref').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/source_recorded/).length).toBeGreaterThan(0);
    expect(screen.queryByText('future-final-data')).not.toBeInTheDocument();
    // TP226: GRF y TimePitch usan el armazón de emisión; la lista de jugadores vive en «Alineaciones».
    fireEvent.click(screen.getByRole('tab', { name: source === 'historical' ? 'Players' : 'Line-ups' }));
    expect(screen.getByText('unknown-subject')).toBeInTheDocument();
    expect(screen.queryByText('Midfielder')).not.toBeInTheDocument();
    expect(screen.getAllByText('detail-only-new-metric').length).toBeGreaterThan(0);
  });

  it('gates final-only metrics and raw source finals without leaking the future header score', () => {
    const f = screenFixture('grf');
    f.initial.panels.summary = { ...f.panel, scope: 'final', metrics: [{ ...f.panel.metrics[0], id: 'final-only-shots', value: 99 }] };
    render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} initialSection="summary" />);
    expect(screen.queryByText('final-only-shots')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal final analysis' }));
    expect(screen.getByText('final-only-shots')).toBeInTheDocument();
    expect(screen.getAllByText(/Final · independent of playback/).length).toBeGreaterThan(0);
    // TP226: en el armazón el marcador solo está en la emisión.
    fireEvent.click(screen.getByRole('tab', { name: 'Live broadcast' }));
    expect(document.querySelector('[data-unified-scoreboard] .tp-sb-digits')).toHaveTextContent('0–0');
    expect(screen.getByRole('slider')).toHaveValue('0');
  });

  it('historical effort stays unavailable even if a synthetic movement metric is supplied', () => {
    const f = screenFixture(); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} initialSection="effort" />);
    expect(screen.getByText(/No measured tracking/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Player effort' })).not.toBeInTheDocument();
  });

  it('uses source PlayerView role in the pitch inspector instead of its rendering palette', () => {
    const f = screenFixture(); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Inspect player' }), { target: { value: 'test:home:1' } });
    expect(screen.queryByText(/Synthetic home player · Midfielder/)).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Player detail' })).toBeInTheDocument();
  });

  it('renders every plot kind with source coordinate meaning, equivalent rows, and a fallback for future kinds', () => {
    const f = screenFixture(); const { container } = render(<MatchMaps plots={f.panel.plots} onSeek={() => {}} />);
    expect(container.querySelectorAll('[data-unified-plot]')).toHaveLength(f.panel.plots.length);
    for (const plot of f.panel.plots) {
      const article = container.querySelector(`[data-plot-id="${plot.id}"]`) as HTMLElement;
      expect(within(article).getByText(plot.coordinateMeaning)).toBeInTheDocument();
      expect(within(article).getByRole('table')).toBeInTheDocument();
      expect(within(within(article).getByRole('table')).getByText('source:event')).toBeInTheDocument();
    }
  });

  it('never normalizes incompatible metric percentages into a misleading two-team bar', () => {
    const f = screenFixture(); const base = f.panel.metrics[0];
    const { container } = render(<MatchMetricTable metrics={[{ ...base, id: 'receipt-share', unit: '%', value: 62.8 }, { ...base, id: 'receipt-share', unit: '%', value: 50, subject: { kind: 'team', id: 'test:away' } }]} />);
    expect(screen.getByText('62.8 %')).toBeInTheDocument(); expect(screen.getByText('50 %')).toBeInTheDocument();
    expect(container.querySelector('[role="progressbar"]')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-metric-id="receipt-share"]')).toHaveLength(2);
  });

  it('compares non-negative team counts against a shared scale only when definitions and denominators agree', () => {
    const f = screenFixture(); const base = f.panel.metrics[0];
    const metrics = [{ ...base, value: 2 }, { ...base, value: 3, subject: { kind: 'team' as const, id: 'test:away' } }];
    const { rerender } = render(<MatchMetricTable metrics={metrics} />);
    expect(screen.getAllByRole('meter').map(m => [m.getAttribute('value'), m.getAttribute('max')])).toEqual([['2', '3'], ['3', '3']]);
    rerender(<MatchMetricTable metrics={[metrics[0], { ...metrics[1], definition: 'different-definition' }]} />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('navigating and playing has no network creation/model/import side effect', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected read'));
    const f = screenFixture('timepitch'); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    for (const name of ['Summary', 'Player card', 'Line-ups', 'Maps', 'Effort']) fireEvent.click(screen.getByRole('tab', { name }));
    await act(async () => {});
    expect(request).not.toHaveBeenCalled(); request.mockRestore();
    expect(screen.getByText(/Local window explanations are unavailable/)).toBeInTheDocument();
  });

  it('supports Spanish without resetting transport or section', () => {
    localStorage.setItem('timepitch.locale', 'es'); const f = screenFixture();
    render(<LanguageProvider><MatchCentre adapter={f.adapter} visible onBack={() => {}} /></LanguageProvider>);
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Partido', 'Resumen', 'Jugadores', 'Mapas', 'Esfuerzo', 'Datos']);
  });

  it('uses recorded native means for pass links when supplied, instead of drawing schematic players elsewhere', () => {
    const f = screenFixture(); const network = f.panel.plots.find(p => p.kind === 'pass_network')!;
    const { container } = render(<MatchMaps plots={[{ ...network, coordinateMeaning: 'native means in metres', points: [{ id: 'test:home:1', x: 10, y: 20, value: 1, refs: [] }, { id: 'unknown-subject', x: 40, y: 30, value: 1, refs: [] }] }]} onSeek={() => {}} />);
    expect(container.querySelector('svg line')).toHaveAttribute('x1', '10');
    expect(container.querySelector('svg line')).toHaveAttribute('y2', '30');
  });

  it('reveals comparisons only after final analysis and an explicit read request', () => {
    const f = screenFixture('historical', '3754078');
    render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} initialSection="summary" />);
    expect(screen.queryByText('Owned read-only comparison')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Compare with/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal final analysis' }));
    expect(screen.queryByText('Owned read-only comparison')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Compare with/ }));
    expect(screen.getByText('Owned read-only comparison')).toBeInTheDocument();
  });

  it('drops a future cutoff when moving backwards while retaining the focused search control', () => {
    const f = screenFixture('timepitch'); render(<MatchCentre adapter={f.adapter} visible onBack={() => {}} initialSection="summary" />);
    const search = screen.getByRole('searchbox', { name: 'Filter metrics' }); search.focus();
    act(() => f.publish({ ...f.adapter.snapshot(), panels: { ...f.initial.panels, summary: { ...f.panel, cutoff: { elapsedMs: 9000, period: 2, periodMs: 4000 }, metrics: [{ ...f.panel.metrics[0], id: 'future-cutoff' }] } } }));
    expect(screen.queryByText('future-cutoff')).not.toBeInTheDocument();
    expect(search).toHaveFocus();
  });

  it('does not arbitrarily join pass nodes with multiple source positions across phases', () => {
    const f = screenFixture(); const network = f.panel.plots.find(p => p.kind === 'pass_network')!;
    const { container } = render(<MatchMaps plots={[{ ...network, points: [{ id: 'test:home:1', x: 10, y: 20, value: 1, refs: [] }, { id: 'test:home:1', x: 70, y: 20, value: 1, refs: [] }, { id: 'unknown-subject', x: 30, y: 40, value: 1, refs: [] }] }]} onSeek={() => {}} />);
    expect(container.querySelector('svg line')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
