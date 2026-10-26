// Partido de demostración (G17): Arsenal 2003/04 contra Manchester City 2024/25, simulación ficticia entre épocas
// (decisión del 22-oct). El movimiento sale de grabaciones previas de tres motores, cargadas por el índice
// versionado y verificadas por SHA-256; el selector cambia solo la grabación y conserva parte y reloj.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { defineTexts, isLocale, sourceLocale, type Locale } from '../i18n-catalog';
import { useLanguage } from '../i18n';
import { fictional, showClub } from '../catalog/fictional';
import { MatchCentre } from './MatchCentre';
import { elapsedForPlayhead, movementOptions, movementText, playheadAt, type MovementMatch, type MovementOption, type Playhead } from './adapters/movement-selector';
import { httpReplayReader, loadRecordedReplay, TRACKED_REPLAY_INDEX, type RecordedReplayIndex } from './adapters/recorded-replay';
import { createRecordedSession } from './adapters/recorded-session';
import { loadRecordedEvents } from './adapters/recorded-events';
import { prepareRecordedAnalysis, type RecordedAnalysisModel } from './analysis/recorded-analysis';
import { RecordingError, type RecordedEngineId, type RecordedTrack } from './adapters/recorded-track';
import type { MatchSessionAdapter } from './session';
import { CrewReportPanel } from './CrewReportPanel';
import './broadcast-layout.css';

/** Partido y semilla de la demo; las grabaciones de otra semilla salen «no disponible» (ver TP193). */
export const DEMO_MATCH: MovementMatch = Object.freeze({ home_key: 'arsenal:2003', away_key: 'mancity:2024', seed: 43 });

const TEXT = defineTexts('demo', {
  en: { demo: 'Demo', title: (home: string, away: string) => `${home} v ${away}`, fictional: 'Fictional cross-era simulation',
    note: 'Synthetic movement recorded from a football engine with estimated attributes. Not a real match and not historical tracking.',
    loading: 'Loading recording', failed: 'Recording unavailable', back: 'Back',
    syntheticMovement: 'Synthetic movement', simulatedEvents: 'Simulated events', provenance: ['Simulated match', ''],
    reasons: { no_recording: 'no recording for this match and seed' } as Record<string, string> },
  es: { demo: 'Demo', title: (home: string, away: string) => `${home} – ${away}`, fictional: 'Simulación ficticia entre épocas',
    note: 'Movimiento sintético grabado de un motor de fútbol con atributos estimados. No es un partido real ni seguimiento histórico.',
    loading: 'Cargando grabación', failed: 'Grabación no disponible', back: 'Volver',
    syntheticMovement: 'Movimiento sintético', simulatedEvents: 'Acontecimientos simulados', provenance: ['Partido simulado', ''],
    reasons: { no_recording: 'sin grabación para este partido y semilla' } as Record<string, string> },
});

type Loaded = { engine: RecordedEngineId; track: RecordedTrack; adapter: MatchSessionAdapter; startMs: number; analysis: RecordedAnalysisModel; load: number };

export function MovementSelector({ options, value, onChange, language }: {
  options: readonly MovementOption[]; value: RecordedEngineId | null; onChange: (engine: RecordedEngineId) => void; language: Locale;
}) {
  const m = movementText(sourceLocale(language)), reasons = TEXT(language).reasons;
  return <fieldset className="movement-selector" data-movement-selector>
    <legend><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 17c3-6 6 2 9-4s5-3 7-5" /><circle cx="4" cy="17" r="1.6" fill="currentColor" /><circle cx="20" cy="8" r="1.6" fill="currentColor" /></svg><span className="movement-legend-text">{m.title}</span></legend>
    {options.map(o => <button key={o.engine} type="button" aria-pressed={o.engine === value} disabled={o.status !== 'available'}
      onClick={() => onChange(o.engine)} title={o.status === 'available' ? undefined : `${o.label}: ${m.unavailable}`}>
      {o.label}{o.status !== 'available' && <small>· {m.unavailable}{o.reason && <span className="movement-reason"> ({reasons[o.reason] ?? o.reason})</span>}</small>}
    </button>)}
  </fieldset>;
}

export function DemoMatch({ visible, onBack, index = TRACKED_REPLAY_INDEX, read, autoplay = false, rendererLocked = false, focusReport = false }: {
  visible: boolean; onBack: () => void; index?: RecordedReplayIndex;
  /** TP246: abierta desde «Crónica IA de ejemplo»: lleva la vista a la crónica cuando aparece. */
  focusReport?: boolean;
  /** TP226: arrancar la primera grabación cargada (al abrir desde VERSUS); al cambiar de motor no se fuerza. */
  autoplay?: boolean;
  /** TP237: desde VERSUS los gráficos ya se eligieron; desde la biblioteca se pueden cambiar en el campo. */
  rendererLocked?: boolean;
  read?: (file: string, signal: AbortSignal) => Promise<ArrayBuffer>;
}) {
  const { locale } = useLanguage(), language = locale, text = TEXT(language);
  const options = useMemo(() => movementOptions(index, DEMO_MATCH), [index]);
  const [engine, setEngine] = useState<RecordedEngineId | null>(() => options.find(o => o.status === 'available')?.engine ?? null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<Playhead | null>(null);
  const reader = useMemo(() => read ?? httpReplayReader(), [read]);
  const current = useRef<MatchSessionAdapter | null>(null);
  const loads = useRef(0);

  useEffect(() => {
    const entry = options.find(o => o.engine === engine)?.entry;
    if (!entry || !visible) return;
    const controller = new AbortController();
    setFailure(null);
    // Cada carga crea un adaptador nuevo y descarta el anterior; la clave por carga (TP203) remonta el Match Centre.
    // Con la misma identidad (mismo motor recargado al volver a ser visible) seguía con el adaptador ya descartado y
    // la reproducción se quedaba «Cargando datos» sin movimiento.
    // El sidecar de acontecimientos es opcional (TP202): si falta o no verifica, la grabación se ve igual, sin ellos.
    const events = loadRecordedEvents(entry, reader, controller.signal).catch(error => {
      if (!controller.signal.aborted) console.warn(`recorded events unavailable for ${entry.id}:`, error);
      return null;
    });
    Promise.all([loadRecordedReplay(entry, reader, controller.signal), events]).then(([track, recorded]) => {
      if (controller.signal.aborted) return;
      const adapter = createRecordedSession(entry.id, track, recorded);
      // Análisis (TP203): una pasada sobre la grabación y los acontecimientos de la sesión; sin sidecar, solo posiciones y goles.
      const analysis = prepareRecordedAnalysis({ track, events: adapter.resolveFrame(track.durationMs).events, passes: recorded?.events.filter(e => e.kind === 'pass') ?? [] });
      current.current?.dispose(); current.current = adapter;
      setLoaded({ engine: entry.engine, track, adapter, startMs: playhead ? elapsedForPlayhead(track, playhead) : 0, analysis, load: ++loads.current });
    }).catch(error => {
      if (controller.signal.aborted) return;
      setFailure(error instanceof RecordingError ? `${error.code}: ${error.message}` : String(error));
    });
    return () => controller.abort();
    // `playhead` se lee al cambiar de motor; no debe recargar la grabación.
  }, [engine, options, reader, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { current.current?.dispose(); current.current = null; }, []);

  const choose = (next: RecordedEngineId) => {
    if (next === engine) return;
    if (loaded) setPlayhead(playheadAt(loaded.track, loaded.adapter.snapshot().presentedCursor.elapsedMs));
    setEngine(next);
  };
  const busy = !!engine && loaded?.engine !== engine && !failure;
  return <section className="demo-match" hidden={!visible} data-demo-match>
    {/* Barra superior de la maqueta v1-2d (.appbar), aligerada en TP211: la marca ya está en la cabecera global; aquí
        quedan Volver, el título, un único chip de procedencia (con la explicación en su ventana) y el motor. */}
    <header className="demo-head demo-appbar" data-demo-appbar>
      <button type="button" className="demo-back" onClick={onBack} aria-label={text.back} title={text.back}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <span className="demo-crumbs"><span className="demo-crumb-demo">{text.demo}</span><span aria-hidden="true">·</span><h1>{demoTitle(text)}</h1></span>
      <DemoProvenance text={text} />
      <span className="demo-spacer" />
      <MovementSelector options={options} value={engine} onChange={choose} language={language} />
    </header>
    {busy && <p className="demo-status" role="status">{text.loading}…</p>}
    {failure && <p className="demo-status" role="alert">{text.failed} · {failure}</p>}
    {loaded && <MatchCentre key={`${loaded.adapter.identity.id}#${loaded.load}`} adapter={loaded.adapter} visible={visible} onBack={onBack}
      matchLabel={text.fictional} initialElapsedMs={loaded.startMs} analysis={loaded.analysis} autoplay={autoplay && loaded.load === 1} rendererLocked={rendererLocked}
      // TP259: las crónicas ya escritas nombran a los jugadores reales; en la liga ficticia no se muestran.
      sideReport={fictional() ? undefined : ({ revealed, reveal }) => <CrewReportPanel traceHash={loaded.track.traceHash} locale={language} open={revealed || focusReport} onOpen={reveal} />} />}
  </section>;
}

/** Chip único de procedencia (TP211): «Ficticio · simulado». Su ventana explica la ficción y queda siempre en el DOM
 *  (descripción del chip para lectores); se abre al pasar el ratón, con el foco del teclado o al pulsarlo. */
function DemoProvenance({ text }: { text: ReturnType<typeof TEXT> }) {
  const [open, setOpen] = useState(false);
  const id = useId(), root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <span className="demo-prov" data-open={open || undefined} ref={root}
    onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); } }}>
    {/* TP250 (jueces: «Ficticio · simulado» en rojo parecía un error): un chip neutro; la explicación sigue en su ventana. */}
    <button type="button" className="chip demo-prov-chip" data-fictional aria-expanded={open} aria-controls={id} aria-describedby={id}
      onClick={() => setOpen(value => !value)}>{text.provenance[0]}<span className="demo-prov-more">{text.provenance[1]}</span></button>
    <span className="demo-prov-pop" id={id} role="note">
      <strong>{text.fictional}</strong>
      <span className="demo-prov-list"><span className="chip sim">{text.syntheticMovement}</span><span className="chip sim">{text.simulatedEvents}</span></span>
      <span className="demo-note">{text.note}</span>
    </span>
  </span>;
}

/** Acceso a la demo desde la portada y la biblioteca, siempre con el rótulo de ficción. */
/** Título y aviso de la demo para la tarjeta destacada de la pantalla VERSUS (TP213). */
// TP266: los nombres van como huecos de la plantilla, no dentro del texto: el catálogo no debe fijar ningún nombre.
const demoTitle = (text: { title: (home: string, away: string) => string }) =>
  text.title(showClub('Arsenal 2003/04'), showClub('Manchester City 2024/25'));

export function demoEntryText(locale: string) { const text = TEXT(isLocale(locale) ? locale : 'en'); return { title: demoTitle(text), fictional: text.fictional }; }

export function DemoEntry({ onOpen }: { onOpen: () => void }) {
  const { locale } = useLanguage(), text = TEXT(locale);
  return <section className="demo-entry" data-demo-entry>
    <button type="button" onClick={onOpen}><strong>{text.demo}: {demoTitle(text)}</strong> <span className="chip ph">{text.fictional}</span></button>
  </section>;
}
