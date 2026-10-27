// TP203 · Análisis de partidos grabados en el Match Centre: columna lateral (Resumen y Cronología), marcas en la barra
// de tiempo y secciones Resumen/Mapas/Esfuerzo, siempre con el chip «Simulado · <motor>» y sin inventar lo no grabado.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MatchCentre } from '../MatchCentre';
import { createRecordedSession } from '../adapters/recorded-session';
import { ENGINE_PROFILES } from '../adapters/recorded-replay';
import { normalizeRecording, type RecordedEngineId } from '../adapters/recorded-track';
import { eventsEntryFor, rawRecording } from '../adapters/recorded-fixtures';
import { parseRecordedEvents } from '../adapters/recorded-events';
import { prepareRecordedAnalysis } from './recorded-analysis';

async function recorded(engine: RecordedEngineId) {
  const track = normalizeRecording(rawRecording(engine), ENGINE_PROFILES[engine]);
  const { events, entry } = await eventsEntryFor(engine);
  const sidecar = parseRecordedEvents(events, entry);
  const adapter = createRecordedSession(`${engine}-fixture`, track, sidecar);
  const analysis = prepareRecordedAnalysis({ track, events: adapter.resolveFrame(track.durationMs).events, passes: sidecar.events.filter(e => e.kind === 'pass') });
  return { adapter, analysis };
}
const slider = () => screen.getByRole('slider', { name: 'Match position' });

describe('recorded match analysis in the Match Centre', () => {
  it('defaults saved matches to natural highlights and leaves the montage without losing the paused cursor',async()=>{
    const {adapter,analysis}=await recorded('touchlines');
    render(<MatchCentre adapter={adapter} visible onBack={()=>{}} analysis={analysis}/>);
    expect(screen.getByRole('button',{name:'Highlights'})).toHaveAttribute('aria-pressed','true');
    expect(screen.queryByRole('group',{name:'Each half'})).toBeNull();
    fireEvent.change(slider(),{target:{value:'160'}});
    await waitFor(()=>expect(slider()).toHaveValue('160'));
    fireEvent.click(screen.getByRole('button',{name:'Full match'}));
    await waitFor(()=>expect(slider()).toHaveValue('160'));
    expect(screen.getByRole('button',{name:'Play'})).toBeInTheDocument();
    expect(screen.getByRole('group',{name:'Each half'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Restart highlights'}));
    await waitFor(()=>expect(slider()).toHaveValue('0'));
  });
  it('shows running plain-language commentary for saved matches instead of only the Key timeline',async()=>{
    const {adapter,analysis}=await recorded('touchlines');
    render(<MatchCentre adapter={adapter} visible onBack={()=>{}} analysis={analysis}/>);
    const commentary=screen.getByRole('region',{name:'Commentary'});
    expect(commentary).toBeVisible();
    expect(screen.getByRole('group',{name:'Timeline filter'})).not.toBeVisible();
    fireEvent.change(slider(),{target:{value:'160'}});
    await waitFor(()=>expect(commentary).toHaveTextContent('home 9 shoots… and away 0 saves!'));
    expect(commentary).not.toHaveTextContent('GOAL');
    fireEvent.change(slider(),{target:{value:'300'}});
    await waitFor(()=>expect(commentary).toHaveTextContent('GOAL'));
    expect(commentary.querySelector('.is-now')).toHaveTextContent('GOAL');
  });
  it('keeps Timeline and progressively disclosed Summary up to the cursor, labelled as simulated', async () => {
    const { adapter, analysis } = await recorded('touchlines');
    render(<MatchCentre adapter={adapter} visible onBack={() => {}} analysis={analysis} />);
    fireEvent.click(screen.getByText('Timeline',{selector:'summary'}));
    const side = document.querySelector('[data-analysis-side]') as HTMLElement;
    expect(side).toBeInTheDocument();
    const timeline = within(side).getByRole('region', { name: 'Timeline' });
    expect(within(side).queryByRole('region', { name: 'Summary' })).toBeNull();
    expect(within(timeline).getByText('Nothing has happened yet in this recording.')).toBeInTheDocument();
    // Tras el gol (muestra 2): marcador del resumen, fila de gol con dorsal/nombre y marca en la barra.
    fireEvent.change(slider(), { target: { value: '300' } });
    await waitFor(()=>expect(side.querySelector('.tp-side-summary')).not.toBeNull());
    fireEvent.click(within(side).getByText('Summary', { selector: 'summary' }));
    const summary = within(side).getByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('Simulated · TouchLines')).toBeInTheDocument();
    await waitFor(() => expect(summary.querySelector('[data-stat="goals"]')).toHaveTextContent(/^1Goals0$/));
    expect(summary.querySelector('[data-stat="on_target"]')).toHaveTextContent(/^2On target0$/);
    const goal = timeline.querySelector('li[data-kind="goal"]') as HTMLElement;
    expect(goal).toHaveTextContent('Goal');
    expect(goal).toHaveTextContent('home 9');
    // TP205: con goles en la grabación la cronología abre en «Key»; los tiros están en «Chances».
    expect(within(timeline).getByRole('button', { name: 'Key' })).toHaveAttribute('aria-pressed', 'true');
    expect(timeline.querySelector('li[data-kind="shot"]')).toBeNull();
    fireEvent.click(within(timeline).getByRole('button', { name: 'Chances' }));
    expect(timeline.querySelector('li[data-kind="shot"]')).toHaveTextContent('saved');
    // TP205: en el primer minuto la posesión es «—», no 100 % / 0 %.
    expect(summary.querySelector('[data-stat="possession"]')).toHaveTextContent(/^—Possession—$/);
    // TP205/TP251: el marcador lleva su rótulo y la barra habla en minutos de partido y en tiempo real que queda.
    expect(document.querySelector('.tp-sb-clabel')).toHaveTextContent('Match clock');
    expect(document.querySelector('.unified-playback-time')).toHaveTextContent(/^Minute .* · left /);
    expect(document.querySelector('.unified-mark[data-kind="goal"]')).toBeInTheDocument();
    // TouchLines no graba faltas ni tarjetas: se dice, no se muestra 0.
    expect(summary.querySelector('[data-stat="fouls"]')).toBeNull();
    expect(summary.querySelector('[data-not-recorded]')).toHaveTextContent('TouchLines does not record it: Fouls · Cards');
  });

  it('seeks to a timeline event a few seconds before it', async () => {
    const { adapter, analysis } = await recorded('touchlines');
    render(<MatchCentre adapter={adapter} visible onBack={() => {}} analysis={analysis} />);
    fireEvent.click(screen.getByText('Timeline',{selector:'summary'}));
    fireEvent.change(slider(), { target: { value: '700' } });
    const button = await screen.findByRole('button', { name: /^Go to Goal, 1'$/ });
    fireEvent.click(button);
    await waitFor(() => expect(slider()).toHaveValue('0'));
  });

  it('opens the player card from the player named in a timeline row without seeking', async () => {
    const { adapter, analysis } = await recorded('touchlines');
    render(<MatchCentre adapter={adapter} visible onBack={() => {}} analysis={analysis} />);
    fireEvent.click(screen.getByText('Timeline',{selector:'summary'}));
    fireEvent.change(slider(), { target: { value: '700' } });
    fireEvent.click(await screen.findByRole('button', { name: "Open home 9's player card" }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // La ficha es su propia pestaña (maqueta v1-2d) sin barra: al volver a Emisión el cursor sigue donde estaba.
    fireEvent.click(screen.getByRole('tab', { name: /Live broadcast/ }));
    expect(slider()).toHaveValue('700');
  });

  it('opens on Chances when the engine recorded no goal', async () => {
    const { adapter, analysis } = await recorded('open-football');
    const goalless = { ...analysis, events: analysis.events.filter(e => e.kind !== 'goal') };
    render(<MatchCentre adapter={adapter} visible onBack={() => {}} analysis={goalless} />);
    fireEvent.click(screen.getByText('Timeline',{selector:'summary'}));
    const timeline = await waitFor(() => within(document.querySelector('[data-analysis-side]') as HTMLElement).getByRole('region', { name: 'Timeline' }));
    expect(within(timeline).getByRole('button', { name: 'Chances' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('fills Summary, Maps and Effort with the analysis instead of an empty statistics panel', async () => {
    const { adapter, analysis } = await recorded('open-football');
    const view = render(<MatchCentre adapter={adapter} visible onBack={() => {}} analysis={analysis} initialSection="summary" />);
    const summary = await waitFor(() => document.querySelector('[data-analysis-summary]') as HTMLElement);
    expect(within(summary).getByRole('region', { name: 'Team statistics' })).toBeInTheDocument();
    expect(within(summary).getByRole('region', { name: 'Control in 5-minute spells' })).toBeInTheDocument();
    expect(summary).toHaveTextContent('open-football does not record it');
    expect(summary).toHaveTextContent('Cards');
    expect(screen.queryByText(/recorded_replay_has_no_statistics/)).not.toBeInTheDocument();
    // TP205: el chip «Simulated · <motor>» va en cada panel, no repetido en la línea de ámbito.
    expect(document.querySelector('.tpa-scope .chip')).toBeNull();
    expect(within(summary).getAllByText('Simulated · open-football').length).toBeGreaterThan(0);
    view.unmount();
    render(<MatchCentre adapter={(await recorded('open-football')).adapter} visible onBack={() => {}} analysis={analysis} initialSection="maps" />);
    const maps = await waitFor(() => document.querySelector('[data-analysis-maps]') as HTMLElement);
    expect(within(maps).getByRole('region', { name: 'Heat map' })).toBeInTheDocument();
    expect(within(maps).getByRole('region', { name: 'Average positions and shape · Pass network' })).toBeInTheDocument();
  });

  it('effort lists every player with distance and leaves pass network out for GRF', async () => {
    const { adapter, analysis } = await recorded('grf');
    render(<MatchCentre adapter={adapter} visible onBack={() => {}} analysis={analysis} initialSection="effort" />);
    const effort = await waitFor(() => document.querySelector('[data-analysis-effort]') as HTMLElement);
    expect(effort.querySelectorAll('tbody tr')).toHaveLength(22);
    expect(within(effort).getByText('Simulated · GRF')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Maps' }));
    await waitFor(() => expect(document.querySelector('[data-analysis-maps]')).toHaveTextContent('GRF does not record pass receivers: no pass network.'));
  });

  it('keeps the previous layout when no analysis is given', async () => {
    const { adapter } = await recorded('touchlines');
    render(<MatchCentre adapter={adapter} visible onBack={() => {}} />);
    expect(document.querySelector('[data-analysis-side]')).toBeNull();
    expect(document.querySelector('[data-unified-events]')).toBeInTheDocument();
    expect(document.querySelector('.unified-mark')).toBeNull();
  });
});
