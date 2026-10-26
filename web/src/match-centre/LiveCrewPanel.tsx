// TP253 (25-oct: «mejor al final una crónica», y eligió «IA en Azure, en vivo»): al terminar un partido
// simulado (GRF o TouchLines), el servidor pide su crónica al crew multiagente en Azure (cola → Container Apps Job →
// agentes en Azure AI Foundry → verificador) y la web la consulta hasta que llega, en 1-2 minutos. El servidor revalida
// el informe entero antes de servirlo y aplica el tope de gasto; aquí solo se pide, se espera y se muestra.
import { useEffect, useRef, useState } from 'react';
import { AzurePipeline, noteIn, type CrewReportView } from './CrewReportPanel';
import { namesMode } from '../catalog/fictional';

type Engine = 'grf' | 'touchlines';
type Live = { status: 'none' | 'pending' | 'ready' | 'failed'; code?: string; report?: CrewReportView & { headline: string | null; provenance?: string } };

const TEXT = {
  en: { title: 'AI match report', badge: 'Agent Framework · Azure AI Foundry',
    before: 'When the match ends, AI agents on Azure will write its report from what the engine recorded.',
    pending: 'AI agents on Azure are writing the report… it usually takes 1–2 minutes.',
    failed: 'The AI report could not be written this time.', busy: 'Another AI report of yours is still being written: try again in a minute.',
    limit: 'You have reached today\'s AI reports.', budget: 'The AI reports budget for the demo is used up.',
    fallback: 'The AI draft did not pass the fact check, so these are the plain match facts.',
    retry: 'Try again', audience: 'Report for', fan: 'Fans', analyst: 'Analysts',
    how: 'Written by AI agents on Azure after the match and checked line by line against the match data.' },
  es: { title: 'Crónica IA del partido', badge: 'Agent Framework · Azure AI Foundry',
    before: 'Cuando acabe el partido, agentes de IA en Azure escribirán su crónica con lo que grabó el motor.',
    pending: 'Los agentes de IA en Azure están escribiendo la crónica… suele tardar 1-2 minutos.',
    failed: 'Esta vez no se pudo escribir la crónica IA.', busy: 'Todavía se está escribiendo otra crónica tuya: prueba dentro de un minuto.',
    limit: 'Has llegado a las crónicas IA de hoy.', budget: 'Se ha agotado el presupuesto de crónicas IA de la demo.',
    fallback: 'El borrador de la IA no pasó la comprobación, así que estos son los datos del partido tal cual.',
    retry: 'Reintentar', audience: 'Crónica para', fan: 'Aficionados', analyst: 'Analistas',
    how: 'Escrita por agentes de IA en Azure al acabar el partido y comprobada línea a línea con los datos del partido.' },
} as const;

const POLL_MS = 6000, MAX_POLLS = 50;

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* sin cuerpo */ }
  return { ok: response.ok, status: response.status, body };
}

export function LiveCrewPanel({ engine, matchId, locale, ended }: { engine: Engine; matchId: string; locale: 'en' | 'es'; ended: boolean }) {
  const t = TEXT[locale];
  const [available, setAvailable] = useState<boolean | null>(null);
  const [live, setLive] = useState<Live>({ status: 'none' });
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(false);
  // TP260: la misma crónica escrita para aficionados (por defecto) o para analistas; cada público es un informe aparte.
  const [audience, setAudience] = useState<'fan' | 'analyst'>('fan');
  // TP259: la crónica nombra lo que se ve en pantalla (liga ficticia o nombres reales).
  const query = `/api/crew/live?engine=${engine}&match_id=${encodeURIComponent(matchId)}&locale=${locale}&names=${namesMode()}&audience=${audience}`;

  useEffect(() => {
    let alive = true;
    void call('/api/crew/live/status').then(r => { if (alive) setAvailable(r.ok && (r.body as { available?: boolean })?.available === true); })
      .catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, []);

  // Al acabar el partido (o al revelar el final): se pide una vez y se consulta cada pocos segundos hasta que llega.
  useEffect(() => {
    if (!available || !ended) return;
    let alive = true, polls = 0, timer = 0;
    const poll = async () => {
      if (!alive) return;
      const r = await call(query).catch(() => null);
      if (!alive) return;
      const body = (r?.ok ? r.body : null) as Live | null;
      if (body?.status === 'none' && !requested.current) {
        requested.current = true;
        const created = await call('/api/crew/live', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engine, match_id: matchId, locale, names: namesMode(), audience }) }).catch(() => null);
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
  }, [available, ended, query, engine, matchId, locale, audience, attempt]);

  if (!available) return null;
  const report = live.status === 'ready' ? live.report : undefined;
  const failure = live.code === 'one_in_flight' ? t.busy : live.code === 'daily_limit' ? t.limit : live.code === 'budget_exhausted' ? t.budget : t.failed;
  return <section className="crew-report crew-report-live" data-crew-report={report?.report_sha256 ?? 'live'} data-live-status={live.status}
    data-open={report ? true : undefined} lang={locale} aria-labelledby="crew-live-title" aria-busy={live.status === 'pending'} tabIndex={-1}>
    <header className="crew-report-head">
      <h2 id="crew-live-title">{t.title}</h2>
      <span className="chip sim">{t.badge}</span>
    </header>
    {!ended && <p className="crew-report-teaser">{t.before}</p>}
    {ended && <div className="crew-audience" role="group" aria-label={t.audience}>{t.audience}:
      {(['fan', 'analyst'] as const).map(a => <button key={a} type="button" aria-pressed={audience === a} disabled={live.status === 'pending'}
        onClick={() => { if (a !== audience) { requested.current = false; setLive({ status: 'none' }); setAudience(a); } }}>{t[a]}</button>)}
    </div>}
    {ended && live.status !== 'ready' && live.status !== 'failed' && <p className="crew-report-teaser crew-live-pending" role="status">
      <span className="crew-live-spinner" aria-hidden="true" />{t.pending}</p>}
    {live.status === 'failed' && <p className="crew-report-teaser" role="status">{failure}
      {live.code !== 'daily_limit' && live.code !== 'budget_exhausted' && <> <button type="button" className="crew-report-open"
        onClick={() => { requested.current = false; setLive({ status: 'none' }); setAttempt(n => n + 1); }}>{t.retry}</button></>}</p>}
    {report && <>
      {report.headline && <h3 className="crew-report-headline">{report.headline}</h3>}
      {report.provenance && report.provenance !== 'crew_ai_draft_checked' && <p className="crew-report-teaser">{t.fallback}</p>}
      {report.paragraphs.map((p, i) => <p key={i}>{p.join(' ')}</p>)}
      {report.coverage_notes.length > 0 && <ul className="crew-report-notes">{report.coverage_notes.map(n => <li key={n}>{noteIn(n, locale)}</li>)}</ul>}
      <footer className="crew-report-foot">
        <p>{t.how}</p>
        <p>{report.model ?? 'gpt-4.1-mini'} · {Number(report.total_cost).toFixed(4)} USD</p>
      </footer>
    </>}
    <AzurePipeline locale={locale} />
  </section>;
}
