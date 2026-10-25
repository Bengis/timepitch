import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CrewReportPanel, pickReport, type CrewReportIndex, type CrewReportView } from './CrewReportPanel';

// TP246: crónica IA pregenerada de la demo, ligada a la grabación (trace_hash) y al idioma.
const report = (locale: 'en' | 'es', evaluation: CrewReportView['evaluation'] = null): CrewReportView => ({
  trace_hash: 'grf-trace', locale, engine: 'grf', headline: locale === 'en' ? 'Arsenal win 6–1' : 'Arsenal gana 6–1',
  paragraphs: [['First sentence.', 'Second sentence.'], ['Third.']], coverage_notes: ['Fictional cross-era simulation.'],
  model: 'gpt-4.1-mini', total_cost: '0.003869', report_sha256: `sha-${locale}`, evaluation,
});
const index: CrewReportIndex = { version: 'crew-demo-reports-1', reports: [report('en', { groundedness: 5, coherence: 5, fluency: 3 }), report('es')] };
const load = () => Promise.resolve(index);

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
  expect(screen.getByText(/multi-agent crew .*gpt-4\.1-mini on Azure AI Foundry, run as an Azure Container Apps job/)).toBeInTheDocument();
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
