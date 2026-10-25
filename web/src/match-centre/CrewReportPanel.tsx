// TP246: crónica IA de la demo, escrita antes por el crew multiagente (Agent Framework, gpt-4.1-mini en Azure AI Foundry,
// ejecutado como Container Apps Job) y servida como fichero estático: la IA sigue apagada en el servidor público, así que
// el visitante no dispara llamadas ni gasto. Cada informe va ligado al `trace_hash` de su grabación y a su idioma; el
// texto lo comprobó frase a frase un verificador determinista contra los hechos grabados, y la evaluación de Foundry
// (juez gpt-4.1-mini) se muestra cuando existe. Sin informe para la grabación elegida, una nota lo dice.
import { useEffect, useRef, useState } from 'react';

export type CrewReportView = Readonly<{
  trace_hash: string; locale: 'en' | 'es'; engine: string; headline: string; paragraphs: readonly (readonly string[])[];
  coverage_notes: readonly string[]; model: string; total_cost: string; report_sha256: string;
  evaluation: Readonly<{ groundedness: number; coherence: number; fluency: number }> | null;
}>;
export type CrewReportIndex = Readonly<{ version: 'crew-demo-reports-1'; reports: readonly CrewReportView[] }>;

export const CREW_REPORTS_URL = () => `${import.meta.env.BASE_URL ?? '/'}data/crew/reports.json`;

const TEXT = {
  en: { title: 'AI match report', badge: 'Agent Framework · Azure AI Foundry',
    teaser: 'Written on Azure after the match, from the engine recording: AI agents draft it and a verifier checks every sentence against the recorded facts.',
    facts: (model: string, cost: string) => `${model} · ${cost} USD`, judged: 'Foundry evaluation',
    evalOf: '(English report)',
    howTitle: 'How it is made on Azure',
    steps: ['The match recording is sealed and queued in Azure Storage.',
      'The queue wakes an Azure Container Apps job (scaled by KEDA, managed identity, no keys).',
      'Two Microsoft Agent Framework agents with gpt-4.1-mini on Azure AI Foundry: an analyst picks the facts and a writer drafts the report.',
      'A deterministic verifier checks every sentence against the facts; if one fails, the writer fixes it.',
      'The sealed report is published as a static file and scored with Azure AI evaluation (groundedness, coherence, fluency). Visitors do not trigger any AI call.'],
    open: 'Read the AI report (reveals the result)',
    how: 'Written by AI agents on Azure after the match and checked line by line against the match data.',
    evaluation: 'Foundry evaluation', groundedness: 'groundedness', coherence: 'coherence', fluency: 'fluency',
    otherEngine: 'AI match report: choose the GRF recording of this match to read it.' },
  es: { title: 'Crónica IA del partido', badge: 'Agent Framework · Azure AI Foundry',
    teaser: 'Se escribió en Azure después del partido, a partir de la grabación del motor: agentes de IA la redactan y un verificador comprueba cada frase contra los hechos.',
    facts: (model: string, cost: string) => `${model} · ${cost} USD`, judged: 'Evaluación de Foundry',
    evalOf: '(crónica en inglés)',
    howTitle: 'Cómo se hace en Azure',
    steps: ['La grabación del partido se sella y entra en una cola de Azure Storage.',
      'La cola despierta un job de Azure Container Apps (escala con KEDA, identidad administrada, sin claves).',
      'Dos agentes de Microsoft Agent Framework con gpt-4.1-mini en Azure AI Foundry: un analista elige los hechos y un redactor escribe la crónica.',
      'Un verificador determinista comprueba cada frase contra los hechos; si una falla, el redactor la corrige.',
      'La crónica sellada se publica como fichero estático y se puntúa con la evaluación de Azure AI (fundamentación, coherencia, fluidez). El visitante no dispara ninguna llamada a la IA.'],
    open: 'Leer la crónica IA (revela el resultado)',
    how: 'Escrita por agentes de IA en Azure al acabar el partido y comprobada línea a línea con los datos del partido.',
    evaluation: 'Evaluación de Foundry', groundedness: 'fundamentación', coherence: 'coherencia', fluency: 'fluidez',
    otherEngine: 'Crónica IA: elige la grabación de GRF de este partido para leerla.' },
} as const;

// TP250 (jueces: notas en inglés dentro de la crónica española): traducción de las notas fijas del verificador.
const NOTES_ES: Record<string, string> = {
  'Physical GRF recording: goals and scorers come from engine telemetry.': 'Grabación física de GRF: goles y goleadores salen de la telemetría del motor.',
  'Pass outcomes, recoveries and possession were not exported and are left out.': 'El resultado de los pases, las recuperaciones y la posesión no se exportaron y quedan fuera.',
  'Fictional cross-era simulation: this match never took place.': 'Simulación ficticia entre épocas: este partido nunca se jugó.',
  'TouchLines recording: goals and scorers come from the engine events.': 'Grabación de TouchLines: goles y goleadores salen de los eventos del motor.',
};
export const noteIn = (note: string, locale: 'en' | 'es') => locale === 'es' ? NOTES_ES[note] ?? note : note;

/** TP250 (juez del hackathon: «no veo nada que ocurra en la nube»): el camino real de la crónica, paso a paso. */
export function AzurePipeline({ locale }: { locale: 'en' | 'es' }) {
  const t = TEXT[locale];
  return <details className="crew-how" data-crew-how>
    <summary>{t.howTitle}</summary>
    <ol>{t.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
  </details>;
}

/** Informe de la grabación y el idioma pedidos; si no hay en ese idioma, el de otro idioma de la misma grabación. */
export function pickReport(index: CrewReportIndex | null, traceHash: string, locale: 'en' | 'es'): CrewReportView | null {
  if (!index || index.version !== 'crew-demo-reports-1') return null;
  const same = index.reports.filter(r => r.trace_hash === traceHash);
  return same.find(r => r.locale === locale) ?? same[0] ?? null;
}

/**
 * Columna lateral del partido: a la vista desde el principio. Cerrada, solo dice qué es y ofrece leerla (el texto revela
 * el resultado, así que respeta el «Revelar análisis final» del centro); abierta, la crónica entera.
 */
export function CrewReportPanel({ traceHash, locale, open = false, onOpen, load = defaultLoad }: {
  traceHash: string; locale: 'en' | 'es'; load?: (signal: AbortSignal) => Promise<CrewReportIndex>;
  /** Resultado ya revelado, o demo abierta desde «Crónica IA de ejemplo». */
  open?: boolean;
  /** Revela el resultado en el centro del partido (y con ello abre la crónica). */
  onOpen?: () => void;
}) {
  const text = TEXT[locale];
  const [index, setIndex] = useState<CrewReportIndex | null>(null);
  const section = useRef<HTMLElement>(null), focused = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(value => { if (!controller.signal.aborted) setIndex(value); }).catch(() => { /* sin informes: no se muestra nada */ });
    return () => controller.abort();
  }, [load]);
  const report = pickReport(index, traceHash, locale);
  useEffect(() => {
    if (!open || !report || focused.current) return;
    focused.current = true; section.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [open, report]);
  if (!index) return null;
  // Sin informe para esta grabación: si la demo lo tiene con otro motor, se dice dónde está.
  if (!report) return index.reports.length > 0 ? <p className="crew-report-note" data-crew-report="other-engine">{text.otherEngine}</p> : null;
  const t = TEXT[report.locale];
  // La evaluación de Foundry se hizo sobre la crónica inglesa de la misma grabación: se muestra diciéndolo.
  const judged = report.evaluation ? { scores: report.evaluation, other: false }
    : (() => { const e = index.reports.find(r => r.trace_hash === report.trace_hash && r.evaluation)?.evaluation; return e ? { scores: e, other: true } : null; })();
  const scores = judged && <>{t.judged}: {t.groundedness} {judged.scores.groundedness}/5, {t.coherence} {judged.scores.coherence}/5, {t.fluency} {judged.scores.fluency}/5{judged.other ? ` ${t.evalOf}` : ''}</>;
  return <section ref={section} className="crew-report" data-crew-report={report.report_sha256} data-open={open || undefined}
    lang={report.locale} aria-labelledby="crew-report-title">
    <header className="crew-report-head">
      <h2 id="crew-report-title">{t.title}</h2>
      <span className="chip sim">{t.badge}</span>
    </header>
    {!open ? <>
      <p className="crew-report-teaser">{t.teaser}</p>
      <p className="crew-report-facts">{t.facts(report.model, Number(report.total_cost).toFixed(4))}{scores && <> · {scores}</>}</p>
      <button type="button" className="crew-report-open" onClick={onOpen}>{t.open}</button>
      <AzurePipeline locale={report.locale} />
    </> : <>
      <h3 className="crew-report-headline">{report.headline}</h3>
      {report.paragraphs.map((p, i) => <p key={i}>{p.join(' ')}</p>)}
      {report.coverage_notes.length > 0 && <ul className="crew-report-notes">{report.coverage_notes.map(n => <li key={n}>{noteIn(n, report.locale)}</li>)}</ul>}
      <footer className="crew-report-foot">
        <p>{t.how}</p>
        <p>
          {report.model} · {Number(report.total_cost).toFixed(4)} USD
          {scores && <> · {scores}</>}
        </p>
        <AzurePipeline locale={report.locale} />
      </footer>
    </>}
  </section>;
}

async function defaultLoad(signal: AbortSignal): Promise<CrewReportIndex> {
  const response = await fetch(CREW_REPORTS_URL(), { signal, credentials: 'omit', cache: 'no-cache' });
  if (!response.ok) throw new Error(`crew reports ${response.status}`);
  return await response.json() as CrewReportIndex;
}
