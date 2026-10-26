// TP253 (25-oct: «mejor al final una crónica», y eligió «IA en Azure, en vivo»): al terminar un partido
// simulado (GRF o TouchLines), el servidor pide su crónica al crew multiagente en Azure (cola → Container Apps Job →
// agentes en Azure AI Foundry → verificador) y la web la consulta hasta que llega, en 1-2 minutos. El servidor revalida
// el informe entero antes de servirlo y aplica el tope de gasto; aquí solo se pide, se espera y se muestra.
// TP262: también al descanso, una crónica de la primera parte con los hechos hasta ese momento.
import { useEffect, useRef, useState } from 'react';
import { defineTexts, type Locale } from '../i18n-catalog';
import { AzurePipeline, noteIn, type CrewReportView } from './CrewReportPanel';
import { namesMode } from '../catalog/fictional';

type Engine = 'grf' | 'touchlines';
type Period = 'half_time' | 'full_time';
type Live = { status: 'none' | 'pending' | 'ready' | 'failed'; code?: string; report?: CrewReportView & { headline: string | null; provenance?: string } };

const TEXT = defineTexts('live-crew', {
  en: { title: 'AI match report', badge: 'Agent Framework · Azure AI Foundry',
    before: 'At half-time and when the match ends, AI agents on Azure will write a report from what the engine recorded.',
    pending: 'AI agents on Azure are writing the report… it usually takes 1–2 minutes.',
    halfPending: 'AI agents on Azure are writing the half-time report…',
    halfTitle: 'Half-time report', fullTitle: 'Full-time report',
    failed: 'The AI report could not be written this time.', busy: 'Another AI report of yours is still being written: try again in a minute.',
    limit: 'You have reached today\'s AI reports.', budget: 'The AI reports budget for the demo is used up.',
    fallback: 'The AI draft did not pass the fact check, so these are the plain match facts.',
    retry: 'Try again', audience: 'Report for', fan: 'Fans', analyst: 'Analysts',
    how: 'Written by AI agents on Azure and checked line by line against the match data.' },
  es: { title: 'Crónica IA del partido', badge: 'Agent Framework · Azure AI Foundry',
    before: 'Al descanso y al acabar el partido, agentes de IA en Azure escribirán una crónica con lo que grabó el motor.',
    pending: 'Los agentes de IA en Azure están escribiendo la crónica… suele tardar 1-2 minutos.',
    halfPending: 'Los agentes de IA en Azure están escribiendo la crónica del descanso…',
    halfTitle: 'Crónica del descanso', fullTitle: 'Crónica del final',
    failed: 'Esta vez no se pudo escribir la crónica IA.', busy: 'Todavía se está escribiendo otra crónica tuya: prueba dentro de un minuto.',
    limit: 'Has llegado a las crónicas IA de hoy.', budget: 'Se ha agotado el presupuesto de crónicas IA de la demo.',
    fallback: 'El borrador de la IA no pasó la comprobación, así que estos son los datos del partido tal cual.',
    retry: 'Reintentar', audience: 'Crónica para', fan: 'Aficionados', analyst: 'Analistas',
    how: 'Escrita por agentes de IA en Azure y comprobada línea a línea con los datos del partido.' },
});

const POLL_MS = 6000, MAX_POLLS = 50;

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* sin cuerpo */ }
  return { ok: response.ok, status: response.status, body };
}

/** Pide una vez la crónica de un periodo y la consulta cada pocos segundos hasta que llega. */
function useCrewReport(active: boolean, engine: Engine, matchId: string, locale: Locale, audience: 'fan' | 'analyst', period: Period, attempt: number) {
  const [live, setLive] = useState<Live>({ status: 'none' });
  const requested = useRef(false);
  // TP259: la crónica nombra lo que se ve en pantalla (liga ficticia o nombres reales).
  const query = `/api/crew/live?engine=${engine}&match_id=${encodeURIComponent(matchId)}&locale=${locale}&names=${namesMode()}&audience=${audience}&period=${period}`;
  useEffect(() => { requested.current = false; setLive({ status: 'none' }); }, [query, attempt]);
  useEffect(() => {
    if (!active) return;
    let alive = true, polls = 0, timer = 0;
    const poll = async () => {
      if (!alive) return;
      const r = await call(query).catch(() => null);
      if (!alive) return;
      const body = (r?.ok ? r.body : null) as Live | null;
      if (body?.status === 'none' && !requested.current) {
        requested.current = true;
        const created = await call('/api/crew/live', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engine, match_id: matchId, locale, names: namesMode(), audience, period }) }).catch(() => null);
        if (!alive) return;
        if (!created?.ok) {
          const code = (created?.body as { detail?: string } | null)?.detail;
          setLive({ status: 'failed', code: created?.status === 429 ? code : 'unavailable' });
          return;
        }
        setLive({ status: 'pending' });
      } else if (body) setLive(body);
      else { setLive({ status: 'failed', code: 'unavailable' }); return; }
      if ((body?.status === 'pending' || body?.status === 'none') && ++polls < MAX_POLLS) timer = window.setTimeout(() => { void poll(); }, POLL_MS);
    };
    void poll();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [active, query, engine, matchId, locale, audience, period, attempt]);
  return live;
}

function ReportBody({ live, locale }: { live: Live; locale: Locale }) {
  const t = TEXT(locale), report = live.report;
  if (!report) return null;
  return <>
    {report.headline && <h3 className="crew-report-headline">{report.headline}</h3>}
    {report.provenance && report.provenance !== 'crew_ai_draft_checked' && <p className="crew-report-teaser">{t.fallback}</p>}
    {report.paragraphs.map((p, i) => <p key={i}>{p.join(' ')}</p>)}
    {report.coverage_notes.length > 0 && <ul className="crew-report-notes">{report.coverage_notes.map(n => <li key={n}>{noteIn(n, locale)}</li>)}</ul>}
    <footer className="crew-report-foot">
      <p>{t.how}</p>
      <p>{report.model ?? 'gpt-4.1-mini'} · {Number(report.total_cost).toFixed(4)} USD</p>
    </footer>
  </>;
}

export function LiveCrewPanel({ engine, matchId, locale, ended, halfTime = false }: { engine: Engine; matchId: string; locale: Locale; ended: boolean; halfTime?: boolean }) {
  const t = TEXT(locale);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  // TP260: la misma crónica escrita para aficionados (por defecto) o para analistas; cada público es un informe aparte.
  const [audience, setAudience] = useState<'fan' | 'analyst'>('fan');
  // TP262: la del descanso se pide al llegar al descanso; si el partido se revela sin pasar por él, solo la del final.
  const [sawHalf, setSawHalf] = useState(false);
  useEffect(() => { if (halfTime && !ended) setSawHalf(true); }, [halfTime, ended]);
  const half = useCrewReport(!!available && sawHalf, engine, matchId, locale, audience, 'half_time', attempt);
  const full = useCrewReport(!!available && ended, engine, matchId, locale, audience, 'full_time', attempt);

  useEffect(() => {
    let alive = true;
    void call('/api/crew/live/status').then(r => { if (alive) setAvailable(r.ok && (r.body as { available?: boolean })?.available === true); })
      .catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, []);

  if (!available) return null;
  const live = ended ? full : half;
  const report = live.status === 'ready' ? live.report : undefined;
  const failure = live.code === 'one_in_flight' ? t.busy : live.code === 'daily_limit' ? t.limit : live.code === 'budget_exhausted' ? t.budget : t.failed;
  const pending = ended || sawHalf ? live.status !== 'ready' && live.status !== 'failed' : false;
  // Si la del descanso no se pudo escribir (un motor sin descanso grabado, por ejemplo), no se muestra nada de ella.
  const halfUnavailable = !ended && live.status === 'failed' && live.code === 'unavailable';
  return <section className="crew-report crew-report-live" data-crew-report={report?.report_sha256 ?? 'live'} data-live-status={live.status}
    data-live-period={ended ? 'full_time' : sawHalf ? 'half_time' : undefined}
    data-open={report ? true : undefined} lang={locale} aria-labelledby="crew-live-title" aria-busy={live.status === 'pending'} tabIndex={-1}>
    <header className="crew-report-head">
      <h2 id="crew-live-title">{t.title}</h2>
      <span className="chip sim">{t.badge}</span>
    </header>
    {!ended && !sawHalf && <p className="crew-report-teaser">{t.before}</p>}
    {(ended || sawHalf) && !halfUnavailable && <>
      <div className="crew-audience" role="group" aria-label={t.audience}>{t.audience}:
        {(['fan', 'analyst'] as const).map(a => <button key={a} type="button" aria-pressed={audience === a} disabled={live.status === 'pending'}
          onClick={() => { if (a !== audience) setAudience(a); }}>{t[a]}</button>)}
      </div>
      {sawHalf && <p className="crew-report-period">{ended ? t.fullTitle : t.halfTitle}</p>}
      {pending && <p className="crew-report-teaser crew-live-pending" role="status">
        <span className="crew-live-spinner" aria-hidden="true" />{ended ? t.pending : t.halfPending}</p>}
      {live.status === 'failed' && <p className="crew-report-teaser" role="status">{failure}
        {live.code !== 'daily_limit' && live.code !== 'budget_exhausted' && <> <button type="button" className="crew-report-open"
          onClick={() => setAttempt(n => n + 1)}>{t.retry}</button></>}</p>}
      <ReportBody live={live} locale={locale} />
      {ended && half.status === 'ready' && <details className="crew-report-half">
        <summary>{t.halfTitle}</summary>
        <ReportBody live={half} locale={locale} />
      </details>}
    </>}
    <AzurePipeline locale={locale} />
  </section>;
}
