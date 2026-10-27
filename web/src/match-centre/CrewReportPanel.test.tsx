import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AzurePipeline, CrewReportPanel, pickReport, reportNames, type CrewReportIndex, type CrewReportView } from './CrewReportPanel';

// TP246: crónica IA pregenerada de la demo, ligada a la grabación (trace_hash) y al idioma.
const report = (locale: 'en' | 'es', evaluation: CrewReportView['evaluation'] = null): CrewReportView => ({
  trace_hash: 'grf-trace', locale, engine: 'grf', headline: locale === 'en' ? 'Arsenal win 6–1' : 'Arsenal gana 6–1',
  paragraphs: [['First sentence.', 'Second sentence.'], ['Third.']], coverage_notes: ['Fictional cross-era simulation.'],
  model: 'gpt-4.1-mini', total_cost: '0.003869', report_sha256: `sha-${locale}`, evaluation,
});
const index: CrewReportIndex = { version: 'crew-demo-reports-1', reports: [report('en', { groundedness: 5, coherence: 5, fluency: 3 }), report('es')] };
const load = () => Promise.resolve(index);

it('adapts displayed identities once without partial names or cascading replacements', () => {
  const display=reportNames([['City','Town'],['Manchester City','City'],['A. Player','B. Player']]);
  expect(display('Manchester City and City; Citywide; A. Player.')).toBe('City and Town; Citywide; B. Player.');
});

it('shows the saved report in fictional mode without altering its receipt or source', async () => {
  const before=JSON.stringify(index);
  render(<CrewReportPanel traceHash="grf-trace" locale="en" open load={load} displayNames={[["Arsenal","North London Reds"]]}/>);
  expect(await screen.findByText('North London Reds win 6–1')).toBeVisible();
  expect(screen.getByText(/verification and evaluation refer to the original text/)).toBeVisible();
  expect(document.querySelector('[data-crew-report]')).toHaveAttribute('data-crew-report','sha-en');
  expect(JSON.stringify(index)).toBe(before);
});

it('keeps the saved story and source warning visible with process, model and evaluation folded away', async () => {
  const view = render(<CrewReportPanel traceHash="grf-trace" locale="en" open load={load} />);
  expect(await screen.findByText('First sentence. Second sentence.')).toBeVisible();
  expect(screen.getByText('Fictional cross-era simulation.')).toBeVisible();
  const metadata = screen.getByText(/0\.0039 USD · Foundry evaluation/);
  const details = metadata.closest('details');
  expect(details).not.toBeNull();
  expect(details).not.toHaveAttribute('open');
  expect(metadata).not.toBeVisible();
  expect(screen.getByText(/do not guarantee the interpretation/)).toBeVisible();
  expect(view.container.querySelectorAll('[data-crew-how]')).toHaveLength(1);
});

it('reports only full-time availability when the selected recording has a saved report', async () => {
  const onAvailability = vi.fn();
  const view = render(<CrewReportPanel traceHash="grf-trace" locale="en" load={load} onAvailability={onAvailability} />);
  expect(onAvailability).toHaveBeenLastCalledWith({ halfTime: false, fullTime: false });
  await waitFor(() => expect(onAvailability).toHaveBeenLastCalledWith({ halfTime: false, fullTime: true }));
  view.rerender(<CrewReportPanel traceHash="missing" locale="en" load={load} onAvailability={onAvailability} />);
  expect(onAvailability).toHaveBeenLastCalledWith({ halfTime: false, fullTime: false });
  view.rerender(<CrewReportPanel traceHash="grf-trace" locale="es" load={load} onAvailability={onAvailability} />);
  expect(onAvailability).toHaveBeenLastCalledWith({ halfTime: false, fullTime: true });
});

it('reports no saved report availability after the report index fails to load', async () => {
  const onAvailability = vi.fn();
  const view = render(<CrewReportPanel traceHash="grf-trace" locale="en" load={load} onAvailability={onAvailability} />);
  await waitFor(() => expect(onAvailability).toHaveBeenLastCalledWith({ halfTime: false, fullTime: true }));
  const failed = () => Promise.reject(new Error('offline'));
  view.rerender(<CrewReportPanel traceHash="grf-trace" locale="en" load={failed} onAvailability={onAvailability} />);
  await act(async () => { await Promise.resolve(); });
  expect(onAvailability).toHaveBeenLastCalledWith({ halfTime: false, fullTime: false });
  expect(view.container).toBeEmptyDOMElement();
});

it('distinguishes the saved report process from a visitor requested live report', () => {
  const view = render(<AzurePipeline locale="en" mode="static" />);
  expect(screen.getByText(/Visitors do not trigger any AI call/)).toBeInTheDocument();
  view.rerender(<AzurePipeline locale="en" mode="live" />);
  expect(screen.queryByText(/Visitors do not trigger any AI call/)).toBeNull();
  expect(screen.queryByText(/published as a static file/)).toBeNull();
  expect(screen.getByText(/requested for this match/)).toBeInTheDocument();
  expect(screen.getByText(/not live progress of individual agents/)).toBeInTheDocument();
});

it('picks the report of the recording in the visitor language, falling back to the other language', () => {
  expect(pickReport(index, 'grf-trace', 'es')?.report_sha256).toBe('sha-es');
  expect(pickReport({ ...index, reports: [report('en')] }, 'grf-trace', 'es')?.report_sha256).toBe('sha-en');
  expect(pickReport(index, 'other-trace', 'en')).toBeNull();
  expect(pickReport({ ...index, version: 'other' } as unknown as CrewReportIndex, 'grf-trace', 'en')).toBeNull();
});

it('closed, says what it is and offers to read it, revealing the result through the match centre', async () => {
  const opened: number[] = [];
  render(<CrewReportPanel traceHash="grf-trace" locale="en" load={load} onOpen={() => opened.push(1)} />);
  expect(await screen.findByRole('heading', { name: 'AI match report' })).toBeInTheDocument();
  expect(screen.getByText('Agent Framework · Azure AI Foundry')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Arsenal win 6–1' })).toBeNull();
  screen.getByRole('button', { name: 'Read the AI report (reveals the result)' }).click();
  expect(opened).toEqual([1]);
});

it('open, shows the checked AI report with how it was made, its cost and the Foundry evaluation', async () => {
  render(<CrewReportPanel traceHash="grf-trace" locale="en" open load={load} />);
  expect(await screen.findByRole('heading', { name: 'AI match report' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Arsenal win 6–1' })).toBeInTheDocument();
  expect(screen.getByText('First sentence. Second sentence.')).toBeInTheDocument();
  expect(screen.getByText(/Written by AI agents on Azure after the match and checked line by line/)).toBeInTheDocument();
  expect(screen.getByText(/0\.0039 USD · Foundry evaluation: groundedness 5\/5, coherence 5\/5, fluency 3\/5/)).toBeInTheDocument();
});

it('in Spanish shows the Spanish report, with the Foundry evaluation of the English one said as such (TP250)', async () => {
  render(<CrewReportPanel traceHash="grf-trace" locale="es" open load={load} />);
  expect(await screen.findByRole('heading', { name: 'Crónica IA del partido' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Arsenal gana 6–1' })).toBeInTheDocument();
  expect(screen.getByText(/Evaluación de Foundry: fundamentación 5\/5.*\(crónica en inglés\)/)).toBeInTheDocument();
  expect(screen.getByText('Cómo se hace en Azure')).toBeInTheDocument();
});

it('for another engine says where the report is; with no reports or a failed load it shows nothing', async () => {
  const { unmount } = render(<CrewReportPanel traceHash="touchlines-trace" locale="en" load={load} />);
  expect(await screen.findByText(/choose the GRF recording of this match/)).toBeInTheDocument();
  unmount();
  const empty = render(<CrewReportPanel traceHash="grf-trace" locale="en" load={() => Promise.resolve({ ...index, reports: [] })} />);
  await Promise.resolve();
  expect(empty.container).toBeEmptyDOMElement();
  empty.unmount();
  const failed = render(<CrewReportPanel traceHash="grf-trace" locale="en" load={() => Promise.reject(new Error('offline'))} />);
  await Promise.resolve();
  expect(failed.container).toBeEmptyDOMElement();
});
