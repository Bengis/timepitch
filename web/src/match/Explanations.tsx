import { useEffect, useRef, useState } from 'react';
import { createExplanation, getExplanation, getWindows, type ExplanationJob, type MatchWindow } from '../api';
import { useLanguage } from '../i18n';
import { clockLabel } from './replay';
import type {EventView} from '../match-centre/session';
import { useMatchText } from './messages';
import { metricLabel,unitLabel } from './statistics/messages';

const text = {
  en: { title: 'Local match explanations', mode: 'Explanation mode', fan: 'Fan', analyst: 'Analyst', window: 'Recorded window', moment: 'Highlight', halftime: 'Half-time', fulltime: 'Full-time',
    generate: 'Generate local explanation', retry: 'Retry local AI', pending: 'Local agents are reading the recorded evidence…', ready: 'Validated local AI', unavailable: 'Local AI unavailable', rejected: 'AI output rejected', fallback: 'Deterministic fallback',
    note: 'The analyst selects a supported observation; the narrator selects approved phrasing. Names and numbers come from the engine. Three windows, up to twelve model calls per language and mode.',
    waiting: 'Explanation windows become available as playback reaches them.', failure: 'Could not request this explanation. Playback continues.', evidence: 'Cited events and motion', facts: 'Recorded facts at this window', calls: 'Model roundtrip budget reserved',motion:'Canonical motion samples',
  },
  es: { title: 'Explicaciones locales del partido', mode: 'Modo de explicación', fan: 'Aficionado', analyst: 'Analista', window: 'Ventana registrada', moment: 'Momento destacado', halftime: 'Descanso', fulltime: 'Final',
    generate: 'Generar explicación local', retry: 'Reintentar IA local', pending: 'Los agentes locales están consultando la evidencia registrada…', ready: 'IA local validada', unavailable: 'IA local no disponible', rejected: 'Respuesta de IA rechazada', fallback: 'Texto determinista de respaldo',
    note: 'El analista selecciona una observación respaldada; el narrador elige una formulación aprobada. Nombres y cifras proceden del motor. Tres ventanas y hasta doce llamadas al modelo por idioma y modo.',
    waiting: 'Las ventanas se habilitan cuando la reproducción llega a ellas.', failure: 'No se ha podido solicitar la explicación. La reproducción continúa.', evidence: 'Eventos y movimiento citados', facts: 'Hechos registrados en esta ventana', calls: 'Presupuesto reservado de llamadas al modelo',motion:'Muestras canónicas de movimiento',
  },
};

export function Explanations({ id, revision, homeName, awayName, events, time, visible = true, hideFullMatch = false }: { id: string; revision: string; homeName: string; awayName: string; events: readonly EventView[]; time: number; visible?: boolean; hideFullMatch?: boolean }) {
  const { locale } = useLanguage(), m = useMatchText(), s = text[locale];
  const [windows, setWindows] = useState<MatchWindow[]>([]), [failed, setFailed] = useState(false);
  const windowsLoaded = useRef(false);
  const [mode, setMode] = useState<'fan' | 'analyst'>('fan'), [selected, setSelected] = useState('');
  const [results, setResults] = useState<Record<string, ExplanationJob>>({});
  const [request, setRequest] = useState<{ key: string; window: MatchWindow; locale: 'en' | 'es'; mode: 'fan' | 'analyst'; retry: boolean } | null>(null);
  const available = windows.filter(w => w.end_ms <= time && (!hideFullMatch || w.id !== 'fulltime'));
  const window = available.find(w => w.id === selected) ?? available.at(-1);
  const key = `${window?.id}:${locale}:${mode}`;
  const job = results[key];
  useEffect(() => {
    if (!visible || windowsLoaded.current) return;
    const controller = new AbortController();
    getWindows(id, controller.signal).then(value => { if (!controller.signal.aborted) { windowsLoaded.current = true; setWindows(value); } }).catch(e => { if (!controller.signal.aborted && e.name !== 'AbortError') setFailed(true); });
    return () => controller.abort();
  }, [id, visible]);
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    const publish = (value: ExplanationJob) => { if (!controller.signal.aborted) setResults(old => ({ ...old, [request.key]: value })); };
    createExplanation(id, { window_id: request.window.id, revision, locale: request.locale, mode: request.mode, retry: request.retry }, controller.signal)
      .then(publish).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [id, request, revision]);
  useEffect(() => {
    if (!visible || !job || job.state !== 'pending') return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await getExplanation(id, job.id, controller.signal);
        if (controller.signal.aborted) return;
        setResults(old => ({ ...old, [key]: value })); setFailed(false);
        if (value.state === 'pending') timer = setTimeout(poll, 500);
      } catch {
        if (!controller.signal.aborted) {
          setFailed(true);
          // Permit another request for the same cached server job after a network
          // failure; do not strand a pending UI entry with a disabled button.
          setResults(old => { const copy = { ...old }; delete copy[key]; return copy; });
        }
      }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [id, key, job?.id, job?.state, visible]);
  const generate = (retry: boolean) => { if (window) { setFailed(false); setRequest({ key, window, locale, mode, retry }); } };
  return <section className="explanations" aria-label={s.title}><h2>{s.title}</h2><p className="small-note">{hideFullMatch ? (locale==='es'?'Explicaciones locales de momentos y descanso; la crónica completa tiene su propio control.':'Local highlight and half-time explanations; the full-match chronicle has its own control.') : s.note}</p>
    <div className="explanation-controls"><div><label htmlFor="explanation-mode">{s.mode}</label><select id="explanation-mode" value={mode} onChange={e => setMode(e.target.value as 'fan' | 'analyst')}><option value="fan">{s.fan}</option><option value="analyst">{s.analyst}</option></select></div>
      <div><label htmlFor="explanation-window">{s.window}</label><select id="explanation-window" value={window?.id ?? ''} onChange={e => setSelected(e.target.value)} disabled={!window}>{!window && <option value="">{m.none}</option>}{available.map(w => <option key={w.id} value={w.id}>{s[w.id]} · {clockLabel(w.end_ms)}</option>)}</select></div>
      {(!hideFullMatch||available.length>0)&&<button disabled={!window || (job?.state === 'pending') || (!!request && request.key === key && !job && !failed)} onClick={() => generate(false)}>{s.generate}</button>}
    </div>
    {!window && <p className="small-note">{s.waiting}</p>}{failed && <p role="alert">{s.failure}</p>}
    {window && <div className="explanation-facts"><strong>{s.facts} · {clockLabel(window.end_ms)}</strong><p>{homeName} {window.score.home} : {window.score.away} {awayName}</p><p>{m.shots}: {window.metrics.home?.shots} — {window.metrics.away?.shots} · {m.passes}: {window.metrics.home?.passes} — {window.metrics.away?.passes}</p>
      <ul>{(window.statistics?.facts??[]).map(fact=><li key={fact.id}>{fact.player_name??fact.team_name} · {metricLabel(fact.metric_id,locale)}: {new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(fact.value)} {unitLabel(fact.unit,locale)}</li>)}</ul>
    </div>}
    {job && <article className={`explanation-result ${job.state}`}><p role="status">{s[job.state]}</p>{job.state !== 'pending' && <><strong>{job.provenance === 'local_ai' ? s.ready : s.fallback}</strong><p>{job.explanation?.side && <b>{(job.explanation.side === 'home' ? homeName : awayName)} · </b>}{job.text}</p><details><summary>{s.evidence}</summary><ul>{(job.explanation?.event_ids ?? job.window.event_ids).map(ref => { const event = events.find(e => e.id === ref || e.refs.includes(ref)); return <li key={ref}>{event && `${clockLabel(event.elapsedMs??event.periodMs)} · ${event.kind} · `}<code>{ref}</code></li>; })}</ul>
      {job.explanation?.sample_ranges?.map(([start,end],i)=><p key={i} className="motion-evidence" data-sample-start={start} data-sample-end={end}>{s.motion}: {start}–{end}</p>)}
      <p>{job.model} · {job.prompt_version} · {job.latency_ms} ms</p><p>{s.calls}: {job.calls_reserved}/4</p></details>
      {job.provenance !== 'local_ai' && job.attempts < 2 && job.calls_reserved === 0 && <button onClick={() => generate(true)}>{s.retry}</button>}</>}</article>}
  </section>;
}
