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
    teaser: 'A multi-agent crew wrote this match report and a verifier checked every sentence against the recorded facts.',
    open: 'Read the AI report (reveals the result)',
    how: (model: string) => `Written by a multi-agent crew (analyst and writer, ${model} on Azure AI Foundry, run as an Azure Container Apps job) and checked sentence by sentence against the recorded facts by a deterministic verifier.`,
    cost: 'Model cost', evaluation: 'Foundry evaluation', groundedness: 'groundedness', coherence: 'coherence', fluency: 'fluency',
    otherEngine: 'AI match report: choose the GRF recording of this match to read it.' },
  es: { title: 'Crónica IA del partido', badge: 'Agent Framework · Azure AI Foundry',
    teaser: 'Un equipo de agentes escribió esta crónica y un verificador comprobó cada frase contra los hechos grabados.',
    open: 'Leer la crónica IA (revela el resultado)',
    how: (model: string) => `Escrita por un equipo de agentes (analista y redactor, ${model} en Azure AI Foundry, ejecutado como job de Azure Container Apps) y comprobada frase a frase contra los hechos grabados por un verificador determinista.`,
    cost: 'Coste del modelo', evaluation: 'Evaluación de Foundry', groundedness: 'fundamentación', coherence: 'coherencia', fluency: 'fluidez',
    otherEngine: 'Crónica IA: elige la grabación de GRF de este partido para leerla.' },
} as const;

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
  return <section ref={section} className="crew-report" data-crew-report={report.report_sha256} data-open={open || undefined}
    lang={report.locale} aria-labelledby="crew-report-title">
    <header className="crew-report-head">
      <h2 id="crew-report-title">{t.title}</h2>
      <span className="chip sim">{t.badge}</span>
    </header>
    {!open ? <>
      <p className="crew-report-teaser">{t.teaser}</p>
      <button type="button" className="crew-report-open" onClick={onOpen}>{t.open}</button>
    </> : <>
      <h3 className="crew-report-headline">{report.headline}</h3>
      {report.paragraphs.map((p, i) => <p key={i}>{p.join(' ')}</p>)}
      {report.coverage_notes.length > 0 && <ul className="crew-report-notes">{report.coverage_notes.map(n => <li key={n}>{n}</li>)}</ul>}
      <footer className="crew-report-foot">
        <p>{t.how(report.model)}</p>
        <p>
          {t.cost}: {Number(report.total_cost).toFixed(4)} USD
          {report.evaluation && <> · {t.evaluation}: {t.groundedness} {report.evaluation.groundedness}/5, {t.coherence} {report.evaluation.coherence}/5, {t.fluency} {report.evaluation.fluency}/5</>}
        </p>
      </footer>
    </>}
  </section>;
}

async function defaultLoad(signal: AbortSignal): Promise<CrewReportIndex> {
  const response = await fetch(CREW_REPORTS_URL(), { signal, credentials: 'omit', cache: 'no-cache' });
  if (!response.ok) throw new Error(`crew reports ${response.status}`);
  return await response.json() as CrewReportIndex;
}
