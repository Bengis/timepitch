import statsbombIcon from '../assets/statsbomb.svg?no-inline';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pitch } from '../match/Pitch';
import { HistoricalComparisonPanel } from '../historical/HistoricalComparison';
import type { SceneFrame } from '../match/retroScene';
import { cursorAt, identityKey, type MatchSection, type MatchSessionAdapter, type PanelData, type PlayerView } from './session';
import { useMatchPlayback } from './useMatchPlayback';
import { useMatchSound } from '../match/audio/useMatchSound';
import { matchAudio } from '../match/audio/engine';
import { pitchStorage, readPitchPreferences, readSoundEnabled, writeSoundEnabled } from '../match/renderers/preferences';
import type { SelectableRendererId } from '../match/renderers/types';
import { AnimeCutIns } from '../match/anime/AnimeCutIns';
import { useAnimeAbilities } from '../match/anime/useAnimeAbilities';
import { useHaneArt } from '../match/anime/useHaneArt';
import { ANIME_LABELS, cardAbility, keeperIdsFor, specFor } from '../match/anime/spec';
import { MatchScoreboard } from './MatchScoreboard';
import { PlaybackControls, type TransportMark } from './PlaybackControls';
import { BroadcastSections, MatchSections } from './MatchSections';
import { analysisViews, broadcastViewFor, panelSectionFor, type BroadcastView } from './navigation';
import { PlayerPicker, pickerOptions } from '../presentation/PlayerPicker';
import { MatchMetaBar, matchMetaFromDescriptor } from '../presentation/MatchMetaBar';
import { MatchEventExplorer } from './MatchEventExplorer';
import { MatchMetricTable } from './MatchMetricTable';
import { MatchPlayers, MatchPlayerDetail } from './MatchPlayers';
import { MatchMaps } from './MatchMaps';
import { MatchData } from './MatchData';
import { MatchLayers, MatchLayerEvidence } from './MatchLayers';
import { matchTime, usePlayerText } from './player-messages';
import { Explanations } from '../match/Explanations';
import { ChroniclePanel } from '../chronicles/ChroniclePanel';
import { useLanguage } from '../i18n';
import { defineTexts, L } from '../i18n-catalog';
import { clockFor } from './football-clock';
import type { SequencePresentation } from './sequence/types';
import { SequenceExperience } from './sequence/SequenceExperience';
import { SequenceTransport } from './sequence/SequenceTransport';
import { sequenceCue } from './sequence/depiction';
import { sequenceFocus } from './sequence/focus';
import { useSequenceText } from './sequence/messages';
import { buildAnnouncements } from './announcements/announcements';
import { useAnnouncer } from './useAnnouncer';
import { ENGINE_LABELS } from './adapters/movement-selector';
import { RECORDED_ENGINE_IDS, type RecordedEngineId } from './adapters/recorded-track';
import { useMatchCast } from '../presentation/useMatchCast';
import type {BuiltMatchCast} from '../presentation/cast';
import { AnnouncementBanner, useBannerPlacement } from '../presentation/AnnouncementBanner';
import { CreditsPanel } from '../presentation/CreditsPanel';
import { attributionsFor } from '../presentation/attribution';
import { PlayerCard } from '../presentation/PlayerCard';
import { LineupsPair, isStarter } from '../presentation/LineupsView';
import { analyseUntil, type RecordedAnalysisModel } from './analysis/recorded-analysis';
import { TeamComparison } from './TeamComparison';
import { AnalysisScopeBar } from './AnalysisScopeBar';
import { SimulatedEffort } from './SimulatedEffort';
import { NarrationPanel } from './narration/NarrationPanel';
import type {SummaryCorrection} from './narration/summary-corrections';
import { NarrationVoice } from './narration/NarrationVoice';
import type {ReplayAudioSource} from './narration/ReplayAudio';
import type {SavedSpeechControl} from './narration/SavedSpeechVoice';
import type {SpeechPhase} from './narration/speech-summary';
import {planHighlights,highlightsRemainingMs} from './highlights';
import {HighlightsControls,HighlightsCut} from './HighlightsControls';
import { AnalysisEffortSection, AnalysisMapsSection, AnalysisSummarySection, BreakStats, EventIcon, SummaryMini, TimelinePanel, type AnalysisContext, type TimelineContext } from './analysis/RecordedAnalysisViews';
import { useAnalysisText } from './analysis/messages';
import { teamAbbreviation } from '../presentation/BroadcastScorebug';
import { minuteLabel } from './announcements/announcements';
import { halftimeMs } from './transport';
import { MatchBreak, type BreakScorer } from './MatchBreak';
import { WALKOUT_FOCUS, WALKOUT_STEP_MS, walkoutDuration, walkoutFrame } from './match-phases';
import '../presentation/tokens.css';
import './broadcast-layout.css';

/** Motor de una sesión, para créditos y el chip de movimiento: el de la grabación (`metadata.engine`) o el de la familia. */
export function sessionEngine(source: string, metadata: Readonly<Record<string, unknown>> | undefined): RecordedEngineId | 'timepitch' | null {
  if (source === 'recorded') return RECORDED_ENGINE_IDS.find(id => id === metadata?.engine) ?? null;
  return source === 'grf' ? 'grf' : source === 'timepitch' ? 'timepitch' : null;
}
const KEEPER = /^(gk|goalkeeper|portero)$/i;
/** Color de equipo para gráficos sobre fondo oscuro: la camiseta, o el ribete si la camiseta es casi negra. */
function teamColour(shirt: string | undefined, trim: string | undefined, fallback: string) {
  const lum = (hex: string | undefined) => { const m = /^#([0-9a-f]{6})$/i.exec(hex ?? ''); if (!m) return null; const n = parseInt(m[1], 16);
    return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  const l = lum(shirt);
  return l === null ? fallback : l < 0.12 ? (lum(trim) !== null ? trim! : fallback) : shirt!;
}
const NO_ANNOUNCEMENTS: readonly never[] = [];
/** «Arsenal 2003/04» → «Arsenal»: la ficha ya muestra la temporada aparte. */
const SEASON_SUFFIX = /\s+\d{4}\/\d{2,4}$/;
/** Temporada del equipo: la del descriptor o la de su clave de catálogo («arsenal:2003» → «2003/04»). */
const seasonOf = (team: { id: string; season?: string }) => {
  if (team.season) return team.season;
  const year = Number(team.id.split(':')[1]);
  return Number.isInteger(year) && year > 1800 ? `${year}/${String(year + 1).slice(-2)}` : '';
};

export type MatchCentreProps = { adapter: MatchSessionAdapter; sequence?: SequencePresentation|null; visible: boolean; onBack: () => void; initialSection?: MatchSection; onSectionChange?: (section: MatchSection) => void; focusEvents?: boolean; actions?: { comparison?: boolean; explanations?: { id: string; revision: string } };
  /** Rótulo del partido para la ficha (p. ej. «Simulación ficticia entre épocas»). */
  matchLabel?: string;
  /** Punto de partida al abrir (cambio de motor de movimiento: se conserva parte y reloj). */
  initialElapsedMs?: number;
  /** Análisis determinista de una grabación de motor (TP203): columna lateral (Resumen, Cronología), marcas en la
   *  barra de tiempo y secciones Resumen/Mapas/Esfuerzo calculadas de lo que el motor grabó. */
  analysis?: RecordedAnalysisModel;
  /** Saved recordings with analysis start at 1× in highlights; other sources retain their initial speed. Con movimiento
   *  reducido no arranca: se ofrece un botón grande de reproducir sobre el campo. */
  autoplay?: boolean;
  /** Locks the legacy settings picker; Retro/3D remains available in the live HUD (TP277). */
  rendererLocked?: boolean;
  /** Explicit DEV-loopback test fixture, never an Azure generation endpoint. */
  testAudio?: ReplayAudioSource;
  savedAudio?: ReplayAudioSource;
  savedAudioCast?:BuiltMatchCast;
  speechCorrections?:readonly SummaryCorrection[];
  /** TP243: grabación de motor jugada en vivo (TouchLines): lleva el armazón de partido simulado, no el de la demo. */
  liveSimulation?: boolean;
  /** TP246: pieza de la columna lateral (crónica IA de la demo); recibe si el resultado ya se reveló y cómo revelarlo. */
  sideReport?: (reveal: Readonly<{ revealed: boolean; reveal: () => void; halfTime?: boolean;
    onAvailability: (value: Readonly<{ halfTime: boolean; fullTime: boolean }>) => void }>) => ReactNode };

/** TP239: métricas que enseña «Esfuerzo» en los partidos simulados (distancia, carrera intensa, sprints, velocidad). */
const EFFORT_METRIC = /distance|hsr|sprint|speed|accel|decel|metres_per_minute/;
/** Velocidad del arranque automático (TP226): 10× deja el partido entero en unos 9 minutos. */
export const AUTOPLAY_SPEED = 10;
/** TP237: con Capitán Hane, 5× (por encima solo hay escenas de gol; ver `allowedKinds`). */
export const ANIME_AUTOPLAY_SPEED = 5;
/** TP252 (25-oct: «que duren 5 min»): el arranque elige la velocidad que deja el partido entero más cerca de
 *  5 minutos reales, sea cual sea el motor (TouchLines graba 5:00 para 90'; la demo GRF, 96:51). Sin duración, lo de antes. */
export const TARGET_MATCH_MS = 5 * 60_000;
export function autoplaySpeedFor(durationMs: number | null): number {
  if (!durationMs || durationMs <= 0) return readPitchPreferences(pitchStorage()).renderer === 'anime-1' ? ANIME_AUTOPLAY_SPEED : AUTOPLAY_SPEED;
  // TP254: la velocidad ya es libre; exactamente 5 minutos (partes de 2,5), sin bajar de 1× (sin cámara lenta).
  return Math.min(120, Math.max(1, durationMs / TARGET_MATCH_MS));
}
/** Nombre del botón grande (distinto de «Reproducir» de la barra, que sigue presente). */
const BIG_PLAY = defineTexts('centre-play', { en: { play: 'Play the match' }, es: { play: 'Reproducir el partido' } });
const DIRECTOR=defineTexts('director',{
  en:{showReplay:'Show replay',hideReplay:'Hide replay',commentary:'Match commentary',showCommentary:'Show commentary',hideCommentary:'Hide commentary'},
  es:{showReplay:'Mostrar repetición',hideReplay:'Ocultar repetición',commentary:'Comentario del partido',showCommentary:'Mostrar narración',hideCommentary:'Ocultar narración'},
});
const prefersReducedMotion = () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

export function MatchCentre(props: MatchCentreProps) {
  return <SessionCentre key={identityKey(props.adapter.identity)} {...props} />;
}

function SessionCentre({ adapter, visible, onBack, initialSection = 'match', onSectionChange, focusEvents = false, actions, sequence, matchLabel, initialElapsedMs, analysis: analysisModel, autoplay = false, rendererLocked = false, liveSimulation = false, sideReport, testAudio,savedAudio,savedAudioCast,speechCorrections }: MatchCentreProps) {
  const [highlightsEnabled,setHighlightsEnabled]=useState(true);
  const highlightPlan=useMemo(()=>!sequence&&analysisModel?planHighlights(analysisModel.track.durationMs,
    analysisModel.events.find(e=>e.kind==='halftime')?.elapsedMs??null,analysisModel.events):null,[analysisModel,sequence]);
  const highlightsActive=!!highlightPlan&&highlightsEnabled;
  const playback = useMatchPlayback(adapter, visible, sequence?.policy??(highlightsActive?highlightPlan!.policy:undefined)), { state, snapshot, view } = playback;
  const t = usePlayerText(), q = useSequenceText(), ta = useAnalysisText(), panelId = useId();
  const profileKey=sequence?.kind==='actions'?sequence.depiction.key:sequence?.policy.id??'ordinary';
  const [settingsTarget,setSettingsTarget]=useState<HTMLDivElement|null>(null);
  const [showReplay,setShowReplay]=useState(false);
  const [reviewingFinal,setReviewingFinal]=useState(false);
  const bannerPlacement = useBannerPlacement();
  const [uiProfile,setUiProfile]=useState(profileKey),[showDetails,setShowDetails]=useState(false);
  const detailsOpen=uiProfile===profileKey&&showDetails;
  const { locale } = useLanguage();
  const [azureEnabled,setAzureEnabled] = useState(false);
  const centre = useRef<HTMLElement>(null);
  const [section, setSection] = useState(initialSection), [screen, setScreen] = useState<BroadcastView>(() => broadcastViewFor(initialSection)), [explicitReveal, setReveal] = useState(false), [showSynthetic, setSynthetic] = useState(true), [showAnchors, setAnchors] = useState(true);
  const [selectedValue, setSelected] = useState<string | null>(null), [comparison, setComparison] = useState(false), [failure, setFailure] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [seekGeneration, setSeekGeneration] = useState(0);
  const playbackSeekToken=seekGeneration+(state.jump?.revision??0);
  const speechControl=useRef<SavedSpeechControl|null>(null),speechRun=useRef(0),spokenPhases=useRef(new Set<string>());
  const explicitSpeechSeek=useRef<number|null>(null);
  const [speechHold,setSpeechHold]=useState<SpeechPhase|null>(null);
  const [restartSpeech,setRestartSpeech]=useState(false);
  const registerSpeech=useCallback((control:SavedSpeechControl|null)=>{speechControl.current=control;},[]);
  const cancelSpeech=()=>{speechRun.current++;speechControl.current?.cancel();setSpeechHold(null);setRestartSpeech(false);};
  const pausePlayback=()=>{cancelSpeech();playback.pause();};
  const [analysisScope,setAnalysisScope] = useState<'cursor'|'final'|null>(null), [watchRequest,setWatchRequest] = useState<{elapsedMs:number;token:number}|null>(null);
  const seekTarget = useRef<number | null>(null);
  const reads = useRef<{ player?: AbortController; events?: AbortController } >({});
  const selected=uiProfile===profileKey?selectedValue:null;
  const revealed = uiProfile===profileKey&&explicitReveal || state.isMatchEnd || reviewingFinal;
  useEffect(()=>{if(uiProfile!==profileKey){setUiProfile(profileKey);setSelected(null);setReveal(false);setShowDetails(false);setSection('match');setScreen('broadcast');setAnalysisScope(null);setWatchRequest(null);setFailure(null);}},[profileKey,uiProfile]);
  const elapsed = view?.cursor.elapsedMs ?? snapshot.presentedCursor.elapsedMs;
  const cutoff = state.wantsPlay ? Math.floor(elapsed / 5000) * 5000 : elapsed;
  const demandMode = state.wantsPlay ? 'playing' : 'paused';
  const finalRequested = revealed && analysisScope !== 'cursor';
  const lastSeek = useRef(-1);
  useEffect(() => {
    if (!visible || state.pendingSeekMs !== null || sequence&&!detailsOpen) return;
    const controller = new AbortController();
    const explicitSeek = lastSeek.current !== seekGeneration;
    lastSeek.current = seekGeneration;
    const requestedCutoff = explicitSeek && seekTarget.current !== null ? seekTarget.current : cutoff;
    void adapter.loadPanel(section, requestedCutoff, finalRequested, controller.signal, { ...playback.demand, explicitSeek }).catch(error => { if (!controller.signal.aborted && error?.name !== 'AbortError') setFailure(t.error); });
    return () => controller.abort();
  }, [adapter, section, cutoff, finalRequested, visible, demandMode, seekGeneration, retry, state.pendingSeekMs, t.error, !!sequence, detailsOpen, playback.demand.endingPeriod]);
  useEffect(() => () => { reads.current.player?.abort(); reads.current.events?.abort(); }, [adapter]);
  useEffect(() => { if (!visible) { reads.current.player?.abort(); reads.current.events?.abort(); } }, [visible]);
  // External route/language changes must not recreate the session or its controller.
  useEffect(() => { setSection(initialSection); setScreen(broadcastViewFor(initialSection)); }, [initialSection]);
  useEffect(() => { if (visible && focusEvents) centre.current?.querySelector<HTMLElement>('[data-unified-events] h2')?.focus(); }, [visible, focusEvents]);
  const seek = (ms: number) => { cancelSpeech();explicitSpeechSeek.current=(playback.seekState?.revision??0)+1;setPause(null); setReportRequested(false); seekTarget.current = Math.max(0, Math.min(ms, snapshot.descriptor.durationMs ?? Infinity)); setSeekGeneration(n => n + 1); const revision=playback.seek(ms);if(typeof revision==='number')explicitSpeechSeek.current=revision;else if(revision===null)explicitSpeechSeek.current=null; };
  // Solo al montar: la sesión nueva de otro motor empieza en el mismo punto del partido.
  useEffect(() => { if (initialElapsedMs && initialElapsedMs > 0) seek(initialElapsedMs); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // TP226: arranque automático una sola vez por sesión, cuando ya hay duración (play() no hace nada sin ella).
  const [reducedMotion] = useState(prefersReducedMotion);
  const autoplayed = useRef(false);
  const [bigPlay, setBigPlay] = useState(() => !autoplay || reducedMotion);
  // TP247: el arranque espera a que el campo esté dibujado (el 3D sin GPU tarda): si no, la salida de los equipos ocurría sin verse.
  const [pitchReady, setPitchReady] = useState(false);
  const autoplayReady = visible && pitchReady && snapshot.descriptor.durationMs !== null && state.status !== 'unavailable';
  useEffect(() => {
    if (!autoplay || reducedMotion || autoplayed.current || !autoplayReady) return;
    autoplayed.current = true; playback.setSpeed(analysisModel?1:autoplaySpeedFor(snapshot.descriptor.durationMs)); playback.play();
  }, [autoplay, reducedMotion, autoplayReady]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state.wantsPlay) setBigPlay(false); }, [state.wantsPlay]);
  const chooseSection = (next: MatchSection) => { setSection(next); onSectionChange?.(next); };
  const safe = (panel: PanelData | undefined) => panel && (panel.scope === 'final' ? finalRequested : !panel.cutoff || panel.cutoff.elapsedMs <= elapsed) ? panel : undefined;
  const panel = safe(snapshot.panels[section]);
  const panelFailure = panel?.availability.reason === 'statistics_failed_retry_required' ? t.error : null;
  // Current panel first: delayed catalog enrichment and backwards seeks retain current facts.
  const playerPanels = [panel, safe(snapshot.panels.players), safe(snapshot.panels.data), safe(snapshot.panels.match)].filter((p): p is PanelData => !!p);
  const currentPlayers = [...new Map(playerPanels.flatMap(p => [...p.playerDetails, ...p.players]).reverse().map(p => [p.id, p])).values()];
  const catalogDetails = Object.values(snapshot.panels).flatMap(p => p?.playerDetails ?? []);
  const players = currentPlayers.map(p => {
    const enriched=catalogDetails.find(item=>item.id===p.id && (item.details?.catalog || item.details?.catalogUnavailable));
    if(!enriched)return p;
    return {...p,estimatedAttributes:enriched.estimatedAttributes,metrics:[...p.metrics.filter(m=>!m.id.startsWith('historical:')),...enriched.metrics.filter(m=>m.id.startsWith('historical:'))],
      details:{...p.details,catalog:enriched.details?.catalog,catalogUnavailable:enriched.details?.catalogUnavailable},availability:enriched.details?.catalogUnavailable?enriched.availability:p.availability};
  });
  const watch = (ms:number) => { playback.pause(); setScreen('broadcast'); chooseSection('match'); seek(ms); setWatchRequest(old=>({elapsedMs:ms,token:(old?.token??0)+1})); };
  const resolvedActions = revealed ? [...new Map(Object.values(snapshot.panels).filter(p=>p?.scope==='final').flatMap(p=>p?.actions??[]).map(e=>[e.id,e])).values()] : [];
  const names = Object.fromEntries([...players.map(p => [p.id, p.name ?? p.id]), ['home', snapshot.descriptor.home.name], ['away', snapshot.descriptor.away.name], [snapshot.descriptor.home.id, snapshot.descriptor.home.name], [snapshot.descriptor.away.id, snapshot.descriptor.away.name]]);
  const choosePlayer = (id: string|null) => {
    if (!visible) return;
    setSelected(id); reads.current.player?.abort();
    if (id === null) return;
    const controller = new AbortController(); reads.current.player = controller;
    void adapter.loadPlayer(id, controller.signal).catch(error => { if (!controller.signal.aborted && error?.name !== 'AbortError') setFailure(t.error); });
  };
  const readWindow = (period: number, from: number, to: number) => {
    if (!visible || to <= from || to - from > 60000) return;
    reads.current.events?.abort(); const controller = new AbortController(); reads.current.events = controller;
    void adapter.loadEvents(period, from, to, controller.signal).catch(error => { if (!controller.signal.aborted && error?.name !== 'AbortError') setFailure(t.error); });
  };
  const source = snapshot.descriptor.identity.source;
  const explanations = source === 'timepitch' && actions?.explanations?.revision === adapter.identity.revision && actions.explanations.id === adapter.identity.id ? actions.explanations : null;
  const historicalMotion = source === 'historical';
  const d = snapshot.descriptor, engine = sessionEngine(source, d.metadata);
  const engineLabel = source === 'recorded' && engine && engine !== 'timepitch' ? ENGINE_LABELS[engine] : null;
  const { cast:loadingCast, crests } = useMatchCast(d, players);
  // The summary preview already resolved and verified its display cast before mounting this session.
  const cast=savedAudio?.manifestUrl==='/speech-summary-preview/manifest.json'&&savedAudioCast?savedAudioCast:loadingCast;
  const lastPeriod = d.periods.some(p => p.period === 4) ? 4 : 2;
  const announcements = useMemo(() => buildAnnouncements(source, snapshot.events, { lastPeriod }), [source, snapshot.events, lastPeriod]);
  const reached = useMemo(() => announcements.filter(a => a.atMs <= elapsed), [announcements, elapsed]);
  const reds = { home: reached.filter(a => a.side === 'home' && (a.kind === 'red' || a.kind === 'second_yellow')).length,
    away: reached.filter(a => a.side === 'away' && (a.kind === 'red' || a.kind === 'second_yellow')).length };
  const announcement = useAnnouncer(sequence ? NO_ANNOUNCEMENTS : announcements, elapsed, seekGeneration, state.pendingSeekMs !== null,state.jump);
  // Sonido del partido (TP231): mismos rótulos y reloj que el rótulo en pantalla; fuera de las secuencias históricas.
  const [soundOn, setSoundOn] = useState(() => readSoundEnabled(pitchStorage()));
  const toggleSound = () => { const next = !soundOn; setSoundOn(next); writeSoundEnabled(pitchStorage(), next); if (next) matchAudio.unlock(); };
  useMatchSound({ events: snapshot.events, announcements, cursorMs: elapsed, speed: state.speed, playing: state.isPlaying,
    seekToken: playbackSeekToken, seeking: state.pendingSeekMs !== null, enabled: soundOn, active: visible && !sequence });
  // Capitán Hane (TP234): el gráfico lo elige Pitch; aquí solo se sabe para escenas y habilidad de la ficha.
  const [rendererId, setRendererId] = useState<SelectableRendererId | null>(null);
  const animeMode = rendererId === 'anime-1' && !sequence;
  const animeData = useAnimeAbilities({ active: animeMode, players, cast, analysis: analysisModel ?? null });
  const haneArt = useHaneArt(animeMode, players);
  const keeperIds = useMemo(() => keeperIdsFor(players, cast), [players, cast]);
  // TP243: las grabaciones guardan pases y recuperaciones aparte (`touches`); la narración los necesita.
  const narrationEvents = useMemo(() => snapshot.touches?.length ? [...snapshot.events, ...snapshot.touches] : snapshot.events, [snapshot.events, snapshot.touches]);
  // TP238: las escenas también leen los toques que la grabación deja fuera de la lista de eventos.
  const animeEvents = useMemo(() => !animeMode || !snapshot.touches?.length ? snapshot.events
    : [...snapshot.events, ...snapshot.touches].sort((x, y) => (x.elapsedMs ?? 0) - (y.elapsedMs ?? 0) || x.sourceIndex - y.sourceIndex),
  [animeMode, snapshot.events, snapshot.touches]);
  const credits = useMemo(() => cast ? attributionsFor({ source, crests: [crests.home, crests.away], kits: cast.kits, cast, engine }, locale) : [], [source, crests, cast, engine, locale]);
  // Análisis grabado (TP203): hasta el cursor o del partido completo si se ha pedido el final. Reproduciendo se
  // recalcula cada medio segundo (≈8 ms por cálculo con 58 000 muestras); en pausa, en el instante exacto.
  const analysisMode = !!analysisModel && !sequence;
  const analysisAt = finalRequested ? d.durationMs ?? elapsed : state.wantsPlay ? Math.floor(elapsed / 500) * 500 : elapsed;
  const analysis = useMemo(() => analysisMode && analysisModel ? analyseUntil(analysisModel, analysisAt) : null, [analysisMode, analysisModel, analysisAt]);
  // Armazón de emisión (maqueta v1-2d): grabaciones de motor con análisis (la demo) y, desde TP226, los partidos
  // simulados de TimePitch y GRF (sin análisis grabado: la columna lleva la lista de eventos y Análisis reutiliza los
  // paneles del adaptador). Histórico y secuencias conservan las seis pestañas y el cajón de la ficha.
  // TP243: un partido TouchLines en vivo llega como grabación sin análisis: también lleva el armazón de simulado.
  const simulatedShell = !sequence && !analysisModel && (source === 'timepitch' || source === 'grf' || source === 'recorded' && liveSimulation);
  const shell = !!analysis && !!engineLabel || simulatedShell;
  const hudEngine = engineLabel ?? (simulatedShell ? (source === 'grf' ? 'GRF' : engine === 'touchlines' ? 'TouchLines' : 'TimePitch') : null);
  const chooseView = (next: BroadcastView) => {
    setScreen(next); chooseSection(panelSectionFor(next));
    if (next === 'card' && !selected && pickerPlayers[0]) choosePlayer(pickerPlayers[0].id);
  };
  /** Elegir jugador en el campo, la cronología o las alineaciones abre su ficha en la pestaña Ficha. */
  const openPlayer = (id: string | null) => { choosePlayer(id); if (shell && id) { setScreen('card'); chooseSection('players'); } };
  // TP239: equipos y jugadores para la cronología, con o sin análisis grabado (los simulados también la llevan).
  const timelineCtx: TimelineContext | null = shell && hudEngine ? {
    engineLabel: engineLabel ?? hudEngine, source, onPlayer: openPlayer,
    teams: { home: { name: d.home.name, abbr: teamAbbreviation(d.home.name), colour: teamColour(cast?.kits.home.shirt, cast?.kits.home.trim, '#e5484d') },
      away: { name: d.away.name, abbr: teamAbbreviation(d.away.name), colour: teamColour(cast?.kits.away.shirt, cast?.kits.away.trim, '#8ec5ff') } },
    player: id => { if (!id) return null; const entry = cast?.players.get(id), view = players.find(p => p.id === id);
      return entry || view ? { number: entry?.number ?? null, name: entry?.displayName ?? view?.name ?? id } : null; },
  } : null;
  const analysisCtx: AnalysisContext | null = analysis && engineLabel && timelineCtx ? { ...timelineCtx, analysis } : null;
  // TP247 (25-oct: «como en FIFA»): salida de los equipos al estadio, descanso y final con las estadísticas.
  const phasesOn = shell && !sequence && visible;
  const [walkoutAt, setWalkoutAt] = useState<number | null>(null), [walkoutMs, setWalkoutMs] = useState(0);
  const [pauseState,setPauseState]=useState<'halftime'|'fulltime'|null>(null);
  const [dismissedStop,setDismissedStop]=useState<string|null>(null);
  const policyPhase=!phasesOn?null:state.stop?.kind==='halftime'?'halftime':state.stop?.kind==='clip-end'&&state.isMatchEnd?'fulltime':null;
  const policyStopKey=state.stop?`${state.stop.kind}:${state.stop.atMs}:${seekGeneration}`:null;
  // A policy stop is authoritative during render, not a second state copied by a passive effect.
  const pause=policyPhase&&dismissedStop!==policyStopKey?policyPhase:pauseState;
  const setPause=(next:'halftime'|'fulltime'|null)=>{setPauseState(next);if(next===null&&policyStopKey)setDismissedStop(policyStopKey);};
  const [reportRequested, setReportRequested] = useState(false);
  const [reportAvailability, setReportAvailability] = useState({ halfTime: false, fullTime: false });
  const onReportAvailability = useCallback((next: Readonly<{ halfTime: boolean; fullTime: boolean }>) => {
    setReportAvailability(current => current.halfTime === next.halfTime && current.fullTime === next.fullTime ? current : next);
  }, []);
  const reportHost = useRef<HTMLDivElement>(null);
  const walkedOut = useRef(false), kickoff = useRef<SceneFrame | null>(null), lastElapsed = useRef(elapsed);
  const htMs = halftimeMs(d.periods, d.durationMs ?? null);
  const summarySpeech=savedAudio?.manifestUrl==='/speech-summary-preview/manifest.json';
  const presentSpeech=(phase:SpeechPhase,after?:()=>void)=>{
    const key=`${phase}:${seekGeneration}`;
    if(!summarySpeech||!speechControl.current||spokenPhases.current.has(key)){after?.();return;}
    cancelSpeech();spokenPhases.current.add(key);playback.pause();setSpeechHold(phase);
    const run=speechRun.current;
    void speechControl.current.present(phase).then(result=>{
      if(run!==speechRun.current)return;setSpeechHold(null);
      if(result==='ended'||result==='skipped')after?.();
    });
  };
  useEffect(()=>{if(!visible)cancelSpeech();},[visible]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>()=>{speechRun.current++;speechControl.current?.cancel();},[]);
  // TP262: la crónica IA del descanso se pide al llegar al descanso (o al pasarlo).
  const halfTime = reviewingFinal || htMs !== null && state.elapsedMs >= htMs;
  // Al arrancar desde el saque inicial: pausa, salida de los equipos y, al terminar (o al saltarla), el partido.
  useEffect(() => {
    if (!phasesOn || walkedOut.current || !state.wantsPlay || elapsed > 2000 || !view?.frame.players.length) return;
    walkedOut.current = true;
    // En las pruebas (jsdom) no hay salida: comprueban el arranque automático del partido tal cual.
    if (reducedMotion || import.meta.env.MODE === 'test') return;

    playback.pause(); seek(0); kickoff.current = view.frame; setWalkoutMs(0); setWalkoutAt(performance.now());
  }, [phasesOn, state.wantsPlay, elapsed, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const endWalkout = () => { setWalkoutAt(null); playback.play(); };
  const resumePlayback=()=>{
    const next=state.stop?.kind==='halftime'||pause==='halftime'?'second-half':state.elapsedMs===0?'opening':null;
    const proceed=()=>{setPause(null);setReportRequested(false);if(walkoutAt!==null)setWalkoutAt(null);
      if(state.stop?.kind==='halftime')playback.continueAfterStop();else playback.play();};
    if(next)presentSpeech(next,proceed);else{cancelSpeech();proceed();}
  };
  useEffect(()=>{
    if(restartSpeech&&state.pendingSeekMs===null&&state.elapsedMs===0&&elapsed===0){setRestartSpeech(false);resumePlayback();}
  },[restartSpeech,state.pendingSeekMs,state.elapsedMs,elapsed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (walkoutAt === null) return;
    const total = kickoff.current ? walkoutDuration(kickoff.current) : 0;
    let id=0;
    const draw=()=>{
      const t = performance.now() - walkoutAt;
      if(t>=total){endWalkout();return;}
      setWalkoutMs(t);id=requestAnimationFrame(draw);
    };
    id=requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [walkoutAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Descanso y final: solo al llegar reproduciendo (no al saltar con la barra).
  // Con el reloj de la reproducción, no con el del fotograma pintado: si el navegador va lento o la pestaña no se ve,
  // el fotograma se queda atrás y el descanso se saltaba.
  const phaseSeek = useRef(playbackSeekToken), clockMs = state.elapsedMs;
  useEffect(() => {
    const before = lastElapsed.current, sought = phaseSeek.current !== playbackSeekToken; lastElapsed.current = clockMs; phaseSeek.current = playbackSeekToken;
    if (!phasesOn || state.stop || sought || state.pendingSeekMs !== null || clockMs <= before || clockMs - before > 600000) return;
    // Highlights already own this exact stop. A retained period-one frame must
    // not create another manual pause when the policy resumes into period two.
    if (htMs !== null && before < htMs && clockMs >= htMs && state.wantsPlay && playback.policyId!=='match-highlights-1') { playback.pause(); setPause('halftime'); }
    else if (d.durationMs != null && before < d.durationMs && clockMs >= d.durationMs) setPause('fulltime');
  }, [clockMs]); // eslint-disable-line react-hooks/exhaustive-deps
  // El reloj puede quedarse a unos milisegundos del final: la tarjeta del final también sale al terminar la reproducción.
  const wasPlaying = useRef(false);
  const wasSpeechIntent=useRef(state.wantsPlay),speechStop=useRef<string|null>(null),speechSeek=useRef(seekGeneration);
  const seenSpeechPolicyStop=useRef(policyStopKey);
  const speechClock=useRef(clockMs),naturalSpeechStop=useRef<string|null>(null);
  // The child prepares the held audio clock in layout first; request the marker in
  // this same commit, rather than painting the phase card before a passive effect.
  useLayoutEffect(()=>{
    const before=speechClock.current,sameSeek=speechSeek.current===seekGeneration;
    const explicitTransition=explicitSpeechSeek.current!==null,confirmed=playback.seekState;
    if(explicitTransition&&confirmed&&confirmed.revision>=explicitSpeechSeek.current!
      &&confirmed.status!=='pending'&&state.pendingSeekMs===null)explicitSpeechSeek.current=null;
    // A settled seek can already have been followed by real playback before React
    // commits its acknowledgement. Only the movement beyond that target counts.
    const settledTransition=explicitTransition&&confirmed?.status==='settled';
    const advanceFrom=settledTransition?confirmed.targetMs:before;
    const advancedAfterSeek=settledTransition&&clockMs>advanceFrom;
    const natural=(wasSpeechIntent.current&&sameSeek||advancedAfterSeek)&&explicitSpeechSeek.current===null&&state.pendingSeekMs===null&&clockMs>advanceFrom;
    wasSpeechIntent.current=state.wantsPlay;speechSeek.current=seekGeneration;speechClock.current=clockMs;
    const key=(phase:'halftime'|'fulltime')=>`${phase}:${phase==='halftime'?htMs:d.durationMs}:${seekGeneration}`;
    if(!sameSeek)naturalSpeechStop.current=null;
    // A policy stop is created only by natural clock advancement; explicit seek clears it.
    // Buffering and automatic montage jumps must not erase this stable arrival evidence.
    if(policyStopKey!==seenSpeechPolicyStop.current&&explicitSpeechSeek.current===null){
      seenSpeechPolicyStop.current=policyStopKey;
      if(policyPhase)naturalSpeechStop.current=key(policyPhase);
    }
    if(natural){
      if(state.isMatchEnd||d.durationMs!=null&&advanceFrom<d.durationMs&&clockMs>=d.durationMs)naturalSpeechStop.current=key('fulltime');
      else if(htMs!==null&&advanceFrom<htMs&&clockMs>=htMs)naturalSpeechStop.current=key('halftime');
    }
    // Full-match playback has no policy stop. Its legacy phase effect can see the
    // seek and natural arrival in one render; retain the arrival and show its card.
    const arrived=naturalSpeechStop.current===key('fulltime')?'fulltime':naturalSpeechStop.current===key('halftime')?'halftime':null;
    if(summarySpeech&&phasesOn&&!pause&&arrived){playback.pause();setPause(arrived);return;}
    if(!summarySpeech||!pause)return;
    const stopKey=key(pause);
    if(speechStop.current===stopKey||naturalSpeechStop.current!==stopKey)return;
    speechStop.current=stopKey;naturalSpeechStop.current=null;presentSpeech(pause);
  },[pause,phasesOn,policyPhase,policyStopKey,clockMs,state.wantsPlay,state.isMatchEnd,state.pendingSeekMs,seekGeneration,htMs,d.durationMs,playback.seekState?.revision,playback.seekState?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phasesOn && !state.stop && state.isMatchEnd && wasPlaying.current && state.pendingSeekMs === null) setPause('fulltime');
    wasPlaying.current = state.wantsPlay;
  }, [state.isMatchEnd, state.wantsPlay]); // eslint-disable-line react-hooks/exhaustive-deps
  // User playback actions close phase cards synchronously. A late playing render must not dismiss a new stop.
  const breakScorers = { home: [] as BreakScorer[], away: [] as BreakScorer[] };
  for (const a of reached) if ((a.kind === 'goal' || a.kind === 'own_goal') && a.side)
    breakScorers[a.side].push({ id: a.id, name: timelineCtx?.player(a.primaryPlayerId)?.name ?? '', minute: a.minuteLabel, ownGoal: a.kind === 'own_goal' });
  // Marcas de la barra: descanso siempre; goles, penaltis y rojas hasta el cursor (o todos con el análisis final visible).
  const marks: TransportMark[] = analysisCtx && analysisModel ? analysisModel.events.filter(e => e.elapsedMs !== null && (e.kind === 'halftime'
    || (e.kind === 'goal' || e.kind === 'penalty' || e.kind === 'card_red') && (finalRequested || e.elapsedMs <= elapsed))).map(e => {
    const minute = e.kind === 'halftime' ? minuteLabel(source, Math.max(1, e.period - 1), e.periodMs, true) : minuteLabel(source, e.period, e.periodMs);
    const who = analysisCtx.player(e.actorId), what = ta.kinds[e.kind === 'goal' && e.outcome === 'own_goal' ? 'own_goal' : e.kind] ?? e.kind;
    const team = e.side ? ` · ${analysisCtx.teams[e.side].abbr}` : '';
    return { id: e.id, atMs: e.elapsedMs!, seekMs: Math.max(0, e.elapsedMs! - (e.kind === 'halftime' ? 0 : 3000)), kind: e.kind,
      label: `${what} ${minute}${who ? ` · ${who.name}` : ''}${team}`, icon: <EventIcon kind={e.kind} /> };
  }) : [];
  const empty: SceneFrame = { clock_ms: elapsed, period: snapshot.presentedCursor.period, score: snapshot.facts.score.value, possession: null, carrier: null, ball: null, players: [] };
  const rawFrame = view?.frame ?? empty, rawPrevious = view?.previous ?? rawFrame;
  const depicted=sequence?.kind==='actions'&&view?sequence.depiction.sample(elapsed,view):null;
  const visualFrame=depicted?.frame??rawFrame,visualPrevious=depicted?.previous??rawPrevious;
  const frame = historicalMotion && !showSynthetic && !sequence ? { ...rawFrame, players: [], ball: null, carrier: null } : visualFrame;
  const previous = historicalMotion && !showSynthetic && !sequence ? { ...rawPrevious, players: [], ball: null, carrier: null } : visualPrevious;
  const finalResult = revealed ? snapshot.descriptor.metadata?.finalResult as { score?: { home: number; away: number } } | undefined : undefined;
  const selectedPlayer: PlayerView | undefined = players.find(p => p.id === selected) ?? (selected ? {
    id: selected, name: frame.players.find(p=>p.key===selected)?.name??null, side: null, sourceRefs: [], role: { value: null, provenance: 'unavailable', refs: [] }, jersey: { value: null, provenance: 'unavailable', refs: [] },
    intervals: { value: null, provenance: 'unavailable', refs: [] }, metrics: [], estimatedAttributes: [], availability: { status: 'unavailable', reason: t.missing },
  } : undefined);
  // Ficha de jugador (G12) cuando hay identidad revisada (ficha o aspecto asignado a mano); si no, el detalle técnico.
  const castEntry = selectedPlayer ? cast?.players.get(selectedPlayer.id) : undefined;
  const cardEntry = castEntry && (castEntry.record || castEntry.appearanceSource === 'hand_assigned') ? castEntry : null;
  const cardSide = selectedPlayer?.side ?? null;
  const cardKit = cast && cardSide ? (KEEPER.test(selectedPlayer?.role.value ?? '') ? cast.kits[cardSide === 'home' ? 'homeKeeper' : 'awayKeeper'] : cast.kits[cardSide]) : null;
  const cardProps = selectedPlayer && cardEntry ? { player: selectedPlayer, entry: cardEntry, kit: cardKit, seasonLabel: cardSide ? seasonOf(d[cardSide]) : '',
    teamKey: cardSide ? d[cardSide].id : null, teamName: cardSide ? d[cardSide].name.replace(SEASON_SUFFIX, '') : null, matchLabel: matchLabel ?? null,
    ability: animeMode ? cardAbility(animeData.get(selectedPlayer.id)?.ability, locale === 'es' ? 'es' : 'en') : null } : null;
  // Pestaña Ficha (armazón de emisión): selector con los titulares (local primero) o, sin once, todos los jugadores con lado.
  const isAnalysisView = (analysisViews as readonly string[]).includes(screen);
  const viewLabel = isAnalysisView ? t[screen as 'summary'] : t.screens[screen as 'broadcast'];
  const sided = players.filter(p => p.side === 'home' || p.side === 'away'), starters = sided.filter(isStarter);
  const pickerPlayers = [...(starters.length ? starters : sided)].sort((a, b) => (a.side === 'home' ? 0 : 1) - (b.side === 'home' ? 0 : 1));
  const picker = pickerPlayers.length > 0 ? <PlayerPicker options={pickerOptions(pickerPlayers, cast)} selectedId={selected} onSelect={choosePlayer} /> : null;
  // Movimiento del jugador hasta el cursor, solo lo que calcula el análisis grabado (sin velocidad máxima ni sprints).
  const moved = selectedPlayer ? analysis?.players.find(p => p.id === selectedPlayer.id) : undefined;
  const cardScreen = <div className="tp-card-screen" data-card-screen>
    {(!selectedPlayer || !cardProps) && picker}
    {selectedPlayer ? cardProps ? <PlayerCard key={selectedPlayer.id} {...cardProps} variant="inline" picker={picker}
        movement={!analysis ? undefined : moved ? { distanceM: moved.distanceM, hsrM: moved.hsrM, seconds: moved.seconds } : null} onClose={() => chooseView('broadcast')} />
      : <MatchPlayerDetail key={selectedPlayer.id} player={selectedPlayer} revealed={revealed} onClose={() => chooseView('broadcast')} />
      : <p className="tp-card-empty" role="status">{t.pickPlayer}</p>}
  </div>;
  const exportHref = snapshot.descriptor.export.href, exportAvailable = !!exportHref && snapshot.descriptor.export.availability.status === 'available';
  // Chronicle event references are goals in the frozen FactPack contract. A pass can
  // cite a goal as its resolution: that shared ref must not seek the pass release.
  const evidenceEvents=[...snapshot.events,...resolvedActions].filter(event=>event.kind==='goal'&&event.elapsedMs!==null);
  const findEvidence=(ref:string)=>evidenceEvents.find(event=>event.id===ref||event.refs.includes(ref)||
    (source==='grf'&&ref.startsWith('grf:')&&event.refs.includes(ref.slice(4))));
  const availableEventRefs=[...new Set(evidenceEvents.flatMap(event=>[event.id,...event.refs,
    ...(source==='grf'?event.refs.filter(ref=>/^\d+$/.test(ref)).map(ref=>`grf:${ref}`):[])]))];
  const seekEvidence=(refs:readonly string[])=>{
    const event=refs.map(findEvidence).find(event=>event?.elapsedMs!==null&&event?.elapsedMs!==undefined);
    if(!event||event.elapsedMs===null)return;
    watch(event.elapsedMs);
    requestAnimationFrame(()=>centre.current?.querySelector<HTMLButtonElement>('[data-unified-transport] .unified-play')?.focus());
  };
  const clock=clockFor(snapshot,state.stop,locale);
  // The ordinary playback cursor already points into period 2 at the break. Only the visible phase label changes.
  const halfTimePresentation = pause === 'halftime' || reportRequested && !state.isMatchEnd && !reviewingFinal;
  const displayClock=sequence||source==='historical'?clock:halfTimePresentation?{state:'halftime' as const,period:1,text:L(locale, 'Half-time', 'Descanso')}:undefined;
  const pilotReady=!!sequence&&playback.policyId===sequence.policy.id&&state.pendingSeekMs===null
    &&(state.stop?.kind!=='halftime'||snapshot.presentedCursor.elapsedMs===state.stop.atMs&&snapshot.presentedCursor.period===state.stop.endingPeriod)
    &&elapsed>=sequence.policy.fromMs&&elapsed<=sequence.policy.toMs
    &&(sequence.kind==='boundary-check'||depicted?.availability==='available');
  const motionReady=pilotReady&&(sequence?.kind==='actions'||!!view);
  // Rótulo de acontecimientos: sobre el campo; en el teléfono del armazón, debajo (maqueta v1-2d a 390 px).
  const bannerBelow = shell && bannerPlacement === 'below';
  const banner = (placement: 'overlay' | 'below') => <AnnouncementBanner current={announcement} source={source} cast={cast} players={players} homeName={d.home.name} awayName={d.away.name} crests={crests} engineLabel={engineLabel} placement={placement}/>;
  const walking = walkoutAt !== null && kickoff.current ? kickoff.current : null;
  const breakStats = !pause ? null : analysisCtx ? <BreakStats ctx={analysisCtx}/> : timelineCtx ? <TeamComparison metrics={panel?.metrics ?? []}
    events={snapshot.events.filter(e => e.elapsedMs !== null && e.elapsedMs <= elapsed)} score={snapshot.facts.score.value}
    teams={{ home: { id: d.home.id, abbr: timelineCtx.teams.home.abbr, colour: timelineCtx.teams.home.colour }, away: { id: d.away.id, abbr: timelineCtx.teams.away.abbr, colour: timelineCtx.teams.away.colour } }} /> : null;
  // TP250: alineaciones en la salida (portero primero, dorsal y nombre) y jugador del partido en el final.
  const ROLE_RANK: Record<string, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
  const lineup = (side: 'home' | 'away') => !walking ? [] : walking.players.filter(p => p.side === side)
    .sort((a, b) => (ROLE_RANK[a.role] ?? 4) - (ROLE_RANK[b.role] ?? 4))
    .map(p => { const who = timelineCtx?.player(p.key); return `${who?.number ?? ''} ${who?.name ?? p.name}`.trim(); });
  const best = (() => {
    if (pause !== 'fulltime' || !analysis) return null;
    const rated = analysis.players.map(p => ({ p, score: p.goals * 10 + p.shots + p.passes * .05 + p.distanceM / 2000 })).sort((a, b) => b.score - a.score)[0];
    if (!rated) return null;
    const who = timelineCtx?.player(rated.p.id), es = locale === 'es';
    const bits = [rated.p.goals ? `${rated.p.goals} ${es ? (rated.p.goals === 1 ? 'gol' : 'goles') : (rated.p.goals === 1 ? 'goal' : 'goals')}` : null,
      `${rated.p.shots} ${es ? 'tiros' : 'shots'}`, `${rated.p.passes} ${es ? 'pases' : 'passes'}`].filter(Boolean);
    return { name: `${who?.number ? `${who.number} ` : ''}${who?.name ?? rated.p.name}`, detail: bits.join(' · ') };
  })();
  // Opening the half-time report must never opt in to final facts. Keep the report mounted so its request lifecycle is unchanged.
  const reportAvailable = pause === 'halftime' ? reportAvailability.halfTime : reportAvailability.fullTime;
  // Final review belongs to the viewing session, not to the current replay cursor.
  const closeBreak = () => { cancelSpeech();if (pause === 'fulltime') setReviewingFinal(true); setPause(null); };
  const restartMatch = () => { setReviewingFinal(false); setShowReplay(false);if(summarySpeech){playback.pause();seek(0);setRestartSpeech(true);}else{seek(0);playback.play();} };
  const readReport = sideReport && reportAvailable ? () => { closeBreak(); setReportRequested(true); } : undefined;
  useLayoutEffect(() => {
    if (!reportRequested) return;
    reportHost.current?.scrollIntoView?.({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' }); reportHost.current?.focus({ preventScroll: true });
  }, [reportRequested, reducedMotion]);
  const reportPriority = reviewingFinal || reportRequested || pause !== null || state.isMatchEnd || halfTime && !state.wantsPlay;
  const postmatch=shell&&(reviewingFinal||state.isMatchEnd)&&pause===null;
  const collapseReplay=postmatch&&!!sideReport&&reportAvailability.fullTime&&!showReplay;
  const director=DIRECTOR(locale);
  const directorPhase=postmatch||pause==='fulltime'?'fulltime':pause==='halftime'||reportRequested&&!state.isMatchEnd?'halftime':walking?'walkout':'live';
  const directCommentary=(content:ReactNode)=><details className="tp-director-commentary" data-director-commentary open={!postmatch}><summary><span className="tp-commentary-show">{director.showCommentary}</span><span className="tp-commentary-hide">{director.hideCommentary}</span></summary>{content}</details>;
  const report = sideReport ? <div ref={reportHost} className="tp-side-report" data-side-report tabIndex={-1} hidden={!reportPriority}>
    {sideReport({ revealed, halfTime, onAvailability: onReportAvailability, reveal: () => { setReveal(true); setAnalysisScope('final'); } })}</div> : null;
  const phaseOverlay = walking ? <MatchBreak phase="walkout" home={d.home.name} away={d.away.name} score={null} onContinue={endWalkout}
      lineups={{ home: lineup('home'), away: lineup('away') }}/>
    : speechHold==='opening'||speechHold==='second-half'?<div className="tp-break tp-break-card-wrap" data-speech-hold={speechHold} role="status"><section className="tp-break-card"><p className="tp-break-kicker">{locale==='es'?(speechHold==='opening'?'Comienza el partido':'Comienza la segunda parte'):(speechHold==='opening'?'Kick-off':'Second-half kick-off')}</p><strong>{d.home.name} · {d.away.name}</strong><p>{locale==='es'?'Presentación hablada · reloj detenido':'Spoken presentation · match clock held'}</p></section></div>
    : pause ? <MatchBreak phase={pause} home={d.home.name} away={d.away.name} score={snapshot.facts.score.value} scorers={breakScorers} stats={breakStats}
      best={best} onReport={readReport} onAnalysis={() => { closeBreak(); chooseView('summary'); }}
      onContinue={resumePlayback} onReplay={restartMatch} onClose={closeBreak}/> : null;
  const field=<div className="sequence-field-host">
    <Pitch frame={walking?walkoutFrame(walking,walkoutMs):frame} previous={walking?walkoutFrame(walking,walkoutMs-WALKOUT_STEP_MS):previous} cue={walking?undefined:sequence?.kind==='actions'?sequenceCue(sequence.source,elapsed):view?.cue} restarting={walking?false:view?.restarting ?? true} home={snapshot.descriptor.home.name} away={snapshot.descriptor.away.name} displayClockLabel={displayClock?.text??matchTime(view?.clockMs ?? snapshot.clockMs)} playerDisplayRoles={new Map(players.map(p => [p.id, p.role]))} selectedPlayerKey={selected} active={visible && (sequence?motionReady:section === 'match')} onPlayerSelect={openPlayer} defaultCamera={sequence?'overview':undefined} settingsLabel={sequence||shell?q.settings:undefined} settingsTarget={sequence||shell?settingsTarget:undefined} presentation={walking?'walkout':undefined} fieldFocus={walking?WALKOUT_FOCUS:sequence?.kind==='actions'?sequenceFocus(sequence.depiction,elapsed,selected,false):undefined} cast={cast}
      onRendererChange={setRendererId} onRendererStatus={status => setPitchReady(status !== 'loading')} rendererLocked={rendererLocked}
      renderAnime={sequence?undefined:({scenes,reducedMotion:still})=><AnimeCutIns events={animeEvents} announcements={announcements} keeperIds={keeperIds} cursorMs={elapsed} speed={state.speed}
        playing={state.isPlaying} seekToken={playbackSeekToken} seeking={state.pendingSeekMs!==null} scenes={scenes} reducedMotion={still} soundOn={soundOn}
        pause={playback.pause} play={playback.play} labels={ANIME_LABELS[locale==='es'?'es':'en']}
        specFor={cut=>specFor(cut,{players,cast,data:animeData,events:snapshot.events,locale:locale==='es'?'es':'en',nameOf:id=>frame.players.find(p=>p.key===id)?.name??null,art:haneArt})}/>}
      hud={sequence||bannerBelow||pause||walking?undefined:banner('overlay')} renderOverlay={projection => sequence?null:<MatchLayers layers={snapshot.layers} projection={projection} elapsedMs={elapsed} showAnchors={showAnchors}/>}
      /* 25-oct: «veo términos repetidos». TP250: sobre el campo, solo las cámaras; la procedencia va en la cabecera. */
      {...(shell&&hudEngine?{cameraTabs:true}:{})}
      overlay={<>{phaseOverlay??(bigPlay&&!state.wantsPlay&&!sequence?<button type="button" className="tp-big-play" data-big-play aria-label={BIG_PLAY(locale).play} title={BIG_PLAY(locale).play}
        disabled={!autoplayReady} onClick={()=>{playback.setSpeed(analysisModel?1:autoplaySpeedFor(snapshot.descriptor.durationMs));resumePlayback();setBigPlay(false);}}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M7 4.5v15a1 1 0 001.5.86l12-7.5a1 1 0 000-1.72l-12-7.5A1 1 0 007 4.5z"/></svg><span>{t.play}</span></button>:undefined)}{highlightsActive&&<HighlightsCut elapsedMs={state.elapsedMs} jump={state.jump}/>}</>} />
    {sequence&&!motionReady&&<p className="sequence-unavailable" role="status">{state.status==='buffering'?q.loading:q.unavailable}</p>}
    {!sequence&&bannerBelow&&section==='match'&&banner('below')}
    {!sequence&&!view&&<p role="status">{t.noMotion}</p>}
  </div>;
  const scoreboard=<MatchScoreboard snapshot={snapshot} elapsedMs={elapsed} clock={displayClock} crests={crests} kits={cast?.kits ?? null} reds={reds} compact={shell}/>;
  const revealBlock=<div className="unified-reveal"><button disabled={revealed} onClick={() => {setReveal(true);setAnalysisScope('final');}}>{t.reveal}</button>{revealed && <><span role="status">{t.revealed}</span><label>{t.analysisScope}<select value={finalRequested?'final':'cursor'} onChange={e=>setAnalysisScope(e.target.value as 'cursor'|'final')}><option value="cursor">{t.cursor}</option><option value="final">{t.final}</option></select></label></>}</div>;
  // TP249: en el armazón de emisión, un solo control para «hasta aquí / partido completo» (revealBlock queda en la vista histórica).
  // Minuto del partido («Hasta el 47'»), no el tiempo de reproducción comprimido.
  const scopeClock = analysisCtx || snapshot.clockMs !== null && !displayClock ? minuteLabel(source, snapshot.presentedCursor.period, snapshot.clockMs ?? 0) : displayClock?.text ?? matchTime(elapsed);
  const scopeBar = (compact = false) => <AnalysisScopeBar revealed={revealed} final={finalRequested} ended={state.isMatchEnd} clock={scopeClock} compact={compact}
    onReveal={() => { setReveal(true); setAnalysisScope('final'); }} onScope={setAnalysisScope} />;
  const transport=<>
    {shell&&!sequence&&(analysisCtx||timelineCtx)&&<NarrationVoice ctx={(analysisCtx||timelineCtx)!} events={narrationEvents} keepers={keeperIds} cursor={savedAudio&&(speechHold||state.isMatchEnd||pause==='halftime')?state.elapsedMs:elapsed} active={visible&&state.isPlaying&&!walking&&!speechHold&&pause===null&&state.pendingSeekMs===null} seekToken={playbackSeekToken} cut={state.jump?.revision??0} speed={state.speed} testAudio={testAudio} savedAudio={savedAudio} onSpeechControl={registerSpeech}
      speechPresentation={savedAudio?{periods:d.periods,durationMs:d.durationMs??0,phase:speechHold??(state.isMatchEnd?'fulltime':pause==='halftime'?'halftime':elapsed===0?'opening':htMs!==null&&elapsed>=htMs&&elapsed<htMs+500?'second-half':'live')}:undefined}/>}
    {highlightPlan&&<HighlightsControls active={highlightsActive} durationMs={highlightPlan.durationMs}
      onMode={active=>{cancelSpeech();playback.setSpeed(1);setHighlightsEnabled(active);if(active){playback.pause();seekTarget.current=0;setSeekGeneration(n=>n+1);setReviewingFinal(false);setReportRequested(false);setShowReplay(false);setPause(null);setBigPlay(true);}}}/>}
    <PlaybackControls state={speechHold?{...state,wantsPlay:true,status:'playing'}:state} descriptor={snapshot.descriptor} cursor={cursorAt(snapshot.descriptor, elapsed)} onPlay={resumePlayback} onPause={pausePlayback} onSeek={seek} seekToken={playbackSeekToken} onSpeed={speed=>{cancelSpeech();playback.setSpeed(speed);}} onReplay={restartMatch} marks={analysisCtx ? marks : undefined} sound={{ enabled: soundOn, onToggle: toggleSound }}
      summaryRemainingMs={highlightsActive?highlightsRemainingMs(highlightPlan!.policy.windows!,state.elapsedMs):undefined}
      clock={shell ? { now: displayClock?.text ?? matchTime(view?.clockMs ?? snapshot.clockMs), end: d.periods.length > 1 ? "90'" : matchTime(d.durationMs) } : undefined} />
  </>;
  const explorer=<MatchEventExplorer snapshot={sequence?{...snapshot,events:snapshot.events.filter(e=>e.elapsedMs!==null&&e.elapsedMs<=elapsed)}:snapshot} players={players} onSeek={watch} onPlayer={openPlayer} onWindow={readWindow} resolvedEvents={resolvedActions} watchRequest={watchRequest} />;
  const filtersUseful=historicalMotion||!!snapshot.layers;
  // TP239: versiones, hashes y fuentes (antes, pestaña «Data»), plegados al final de la columna del partido.
  const technical=<details className="tpa-log" data-technical hidden={shell}><summary>{t.technical}</summary><MatchData panel={safe(snapshot.panels.data)} snapshot={snapshot} revealed={revealed} explanationsAvailable={!!explanations||azureEnabled} /></details>;
  const directedField=shell?<div className="tp-director-field" data-director-field hidden={collapseReplay}>{field}</div>:field;
  const detailPanel=<>
    {!shell&&revealBlock}
    {(failure || snapshot.reason || panelFailure) && <div role="alert"><p>{failure ?? snapshot.reason ?? panelFailure}</p><button onClick={() => { setFailure(null); setRetry(n => n + 1); if (adapter.retry) { const c = new AbortController(); reads.current.events?.abort(); reads.current.events = c; void adapter.retry(elapsed, c.signal).catch(() => { if (!c.signal.aborted) setFailure(t.error); }); } }}>{t.retry}</button></div>}
    <section id={panelId} role="tabpanel" aria-label={shell ? viewLabel : t[section]} className="unified-panel">
      <div className={`unified-match-area${shell?' tpa-stage':''}`} hidden={section!=='match'}>{!sequence&&<div className="unified-stage-main">{(!shell||filtersUseful)&&<div className="unified-filters" aria-label={t.layers}><label><input type="checkbox" checked={showSynthetic} disabled={!historicalMotion} onChange={e => setSynthetic(e.target.checked)} />{t.synthetic}</label><label><input type="checkbox" checked={showAnchors} disabled={!snapshot.layers} onChange={e => setAnchors(e.target.checked)} />{t.anchors}</label></div>}{directedField}<MatchLayerEvidence layers={snapshot.layers}/></div>}
        {analysisCtx&&analysisModel?<aside className="tpa-side" data-analysis-side>
          {report}
          {elapsed > 0 && <details className="tp-side-summary"><summary>{ta.summary}</summary><SummaryMini ctx={analysisCtx}/></details>}
          {directCommentary(<>
            <NarrationPanel ctx={analysisCtx} events={narrationEvents} keepers={keeperIds} untilMs={elapsed} onSeek={seek} speechCorrections={speechCorrections}/>
            <details className="tp-commentary-timeline"><summary>{ta.timeline}</summary>
              <TimelinePanel ctx={analysisCtx} events={analysisModel.events} untilMs={finalRequested?d.durationMs??elapsed:elapsed} onSeek={seek}/>
            </details>
          </>)}
          {scopeBar(true)}
          <details className="tpa-log" hidden={shell}><summary>{ta.events}</summary>{explorer}</details>
          {technical}
        </aside>:shell?<aside className="tpa-side tp-sim-side" data-simulated-side>
          {/* TP253: crónica IA en vivo (crew en Azure) al acabar el partido simulado. */}
          {report}
          {/* TP241 («la acción debería verla narrada»): narración en frases llanas en vez de la cronología de TP239;
              el registro sigue plegado. */}
          {timelineCtx&&directCommentary(<NarrationPanel ctx={timelineCtx} events={narrationEvents} keepers={keeperIds} untilMs={finalRequested?d.durationMs??elapsed:elapsed} onSeek={seek} speechCorrections={speechCorrections}/>)}
          {scopeBar(true)}
          <details className="tpa-log" hidden={shell}><summary>{ta.events}</summary>{explorer}</details>
          {technical}</aside>:explorer}</div>
      {/* Maqueta: la barra de reproducción va en un panel a lo ancho, debajo de la rejilla campo + columna. */}
      {shell && (screen === 'broadcast' || isAnalysisView) && <div className="tp-playback-panel" data-playback-panel>{transport}</div>}
      {/* Ajustes del campo (iluminación, detalle, seguir jugador) plegados bajo la barra: la maqueta deja el campo limpio y la cámara va en el HUD. */}
      {shell && <div ref={setSettingsTarget} className="tp-pitch-settings-host" hidden />}
      {shell && screen === 'card' && cardScreen}
      {shell && screen === 'lineups' && <div className="tp-lineups-screen" data-lineups-screen>
        <MatchMetaBar home={{ name: d.home.name, short: teamAbbreviation(d.home.name), crest: crests.home }} away={{ name: d.away.name, short: teamAbbreviation(d.away.name), crest: crests.away }}
          score={snapshot.facts.score.value} {...matchMetaFromDescriptor(d, locale, { fictional: matchLabel ?? null, kits: cast?.kits ?? null })} />
        {cast && players.some(isStarter) && <LineupsPair
          home={{ side: 'home', formation: d.home.formation, players, cast, announcements: reached, onSelect: openPlayer, teamName: d.home.name, crest: crests.home }}
          away={{ side: 'away', formation: d.away.formation, players, cast, announcements: reached, onSelect: openPlayer, teamName: d.away.name, crest: crests.away }} />}
        <details className="tpa-log"><summary>{t.players}</summary><MatchPlayers players={players} onSelect={openPlayer} /></details>
      </div>}
      {analysisCtx && isAnalysisView && <>
        {/* Resumen, Mapas y Esfuerzo ya llevan el chip en cada panel (TP205). */}
        {section !== 'summary' && section !== 'maps' && section !== 'effort' && <p className="unified-scope tpa-scope"><span className="chip sim">{ta.simulated} · {analysisCtx.engineLabel}</span></p>}
        {scopeBar()}
        {section === 'summary' && analysisModel && <AnalysisSummarySection ctx={analysisCtx} events={analysisModel.events} />}
        {section === 'maps' && <AnalysisMapsSection ctx={analysisCtx} selected={selected} />}
        {section === 'effort' && <AnalysisEffortSection ctx={analysisCtx} />}
        {section === 'data' && <MatchData panel={panel} snapshot={snapshot} revealed={revealed} explanationsAvailable={!!explanations||azureEnabled} />}
      </>}
      {section !== 'match' && !analysisCtx && (!shell || isAnalysisView) && <>
        {/* TP239: en los simulados, solo el instante («hasta 0:30»); el estado técnico del panel queda en la vista histórica. */}
        {shell ? scopeBar() : <p className="unified-scope">{panel?.scope === 'final' ? t.final : t.cursor} · {matchTime(panel?.cutoff?.elapsedMs ?? null)} · {panel?.availability.status ?? t.loading} {panel?.availability.reason}</p>}
        {section === 'summary' && <>
          {finalResult?.score && <p>{t.finalResult}: {finalResult.score.home} : {finalResult.score.away} · {t.final}</p>}
          {/* TP239: en los simulados, primero la comparación tipo retransmisión; la tabla técnica, plegada. */}
          {shell && timelineCtx && <TeamComparison metrics={panel?.metrics ?? []} events={snapshot.events.filter(e => e.elapsedMs !== null && e.elapsedMs <= elapsed)} score={snapshot.facts.score.value} teams={{ home: { id: d.home.id, abbr: timelineCtx.teams.home.abbr, colour: timelineCtx.teams.home.colour }, away: { id: d.away.id, abbr: timelineCtx.teams.away.abbr, colour: timelineCtx.teams.away.colour } }} />}
          {shell ? <details className="tpa-log"><summary>{t.allMetrics}</summary><MatchMetricTable metrics={panel?.metrics ?? []} names={names} />
            <section aria-label={t.standouts}><h2>{t.standouts}</h2>{panel?.standouts.map(s => <article key={s.id}><h3>{s.id}</h3><p>{s.criterion} · {s.availability.status} {s.availability.reason}</p>{s.playerIds.map(id => <button key={id} onClick={() => choosePlayer(id)}>{names[id] ?? id}</button>)}<p>{t.refs}: {s.evidenceIds.join(', ')}</p></article>)}</section></details>
          : <><MatchMetricTable metrics={panel?.metrics ?? []} names={names} />
          <section aria-label={t.standouts}><h2>{t.standouts}</h2>{panel?.standouts.map(s => <article key={s.id}><h3>{s.id}</h3><p>{s.criterion} · {s.availability.status} {s.availability.reason}</p>{s.playerIds.map(id => <button key={id} onClick={() => choosePlayer(id)}>{names[id] ?? id}</button>)}<p>{t.refs}: {s.evidenceIds.join(', ')}</p></article>)}</section></>}
          {revealed && actions?.comparison !== false && source === 'historical' && /^\d+$/.test(adapter.identity.id) && <section><button aria-expanded={comparison} onClick={() => setComparison(v => !v)}>{t.comparison}</button>{comparison && <HistoricalComparisonPanel historicalMatchId={Number(adapter.identity.id)} datasetVersion={adapter.identity.revision} />}</section>}
          {!sequence&&source!=='recorded'&&<ChroniclePanel identity={adapter.identity} locale={locale} completed={snapshot.descriptor.metadata?.completed===true} revealed={revealed&&visible}
            onSeekEvidence={seekEvidence} availableEventRefs={availableEventRefs} onModeChange={setAzureEnabled}/> }
        </>}
        {section === 'players' && <>{cast && players.some(isStarter) && <LineupsPair
          home={{ side: 'home', formation: d.home.formation, players, cast, announcements: reached, onSelect: choosePlayer, teamName: d.home.name }}
          away={{ side: 'away', formation: d.away.formation, players, cast, announcements: reached, onSelect: choosePlayer, teamName: d.away.name }} />}
          <MatchPlayers players={players} onSelect={choosePlayer} /></>}
        {section === 'maps' && <MatchMaps plots={panel?.plots.filter(p => p.kind !== 'effort') ?? []} onSeek={watch} simple={shell} ctx={timelineCtx} />}
        {/* TP239 (jueces: «Esfuerzo» repetía la tabla del Resumen): en los simulados, solo las métricas de esfuerzo. */}
        {section === 'effort' && (historicalMotion ? <p role="status">{t.tracking}</p> : (() => {
          const effortMetrics = [...(panel?.metrics ?? []), ...(panel?.players.flatMap(p => p.metrics) ?? [])].filter(m => !shell || EFFORT_METRIC.test(m.id));
          const technicalEffort = <><MatchMetricTable metrics={effortMetrics} names={names} title={t.effort} /><MatchMaps plots={panel?.plots.filter(p => p.kind === 'effort') ?? []} onSeek={watch} /></>;
          // TP249: en el armazón, panel de retransmisión; la tabla técnica, plegada dentro.
          return shell && timelineCtx ? <SimulatedEffort metrics={effortMetrics} players={players} ctx={timelineCtx} technical={technicalEffort} /> : technicalEffort;
        })())}
        {section === 'data' && <MatchData panel={panel} snapshot={snapshot} revealed={revealed} explanationsAvailable={!!explanations||azureEnabled} />}
      </>}
    </section>
    {explanations && <div hidden={section !== 'summary'}><Explanations id={explanations.id} revision={explanations.revision} homeName={snapshot.descriptor.home.name} awayName={snapshot.descriptor.away.name} events={snapshot.events} time={elapsed} visible={visible && section === 'summary'} hideFullMatch={azureEnabled}/></div>}
  </>;
  const actionTimes=sequence?.kind==='actions'?[...new Set(sequence.source.events.filter(e=>(['Pass','Carry','Shot','Block','Ball Recovery'].includes(e.kind)||e.kind==='Goal Keeper'&&e.outcome==='Shot Saved')&&e.elapsedMs>=sequence.policy.fromMs&&e.elapsedMs<=sequence.policy.toMs).map(e=>e.elapsedMs))].sort((a,b)=>a-b):[];
  const next=actionTimes.find(at=>at>elapsed)??null;
  const pauseSeek=(ms:number)=>{playback.pause();seek(ms);};
  // Studio keeps the field at its natural full width. No viewport-height fit or resize-driven layout writes.
  // Procedencia del partido; en el armazón de los simulados va a la vista en la barra superior (TP226).
  const provenance=<p className="unified-provenance" role="note">{historicalMotion&&<a className="unified-provider" href="https://github.com/hudl/open-data" target="_blank" rel="noreferrer"><img src={statsbombIcon} alt="Hudl Statsbomb" width="24" height="24"/>StatsBomb Open Data</a>}{sequence?`${q.historical} · ${q.source}`:historicalMotion?t.historical:t.simulated}{(engineLabel||simulatedShell)&&<span className="chip sim unified-engine" data-engine={engine ?? undefined}>{t.movement}: {hudEngine}</span>}</p>;
  return <article ref={centre} data-speech-commit={summarySpeech?'startup-1':undefined} className={`unified-centre${sequence?' sequence-centre':''}${shell?' tp-shell':''}`} data-view={shell?screen:undefined} data-director-phase={directorPhase} data-replay-collapsed={collapseReplay||undefined} data-side-priority={reportPriority ? 'report' : 'timeline'} data-unified-match-centre data-source={source} hidden={!visible}>
    {/* En el armazón de emisión «Volver» va en la barra superior de quien lo monta (DemoMatch). */}
    {simulatedShell?<header className="demo-appbar tp-sim-appbar" data-simulated-appbar>
      {/* TP239 (jueces: cuatro barras compitiendo): una sola fila: «Nuevo partido», el partido y un chip de procedencia. */}
      <button type="button" className="demo-back tp-new-match" onClick={onBack}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        <span>{t.newMatch}</span>
      </button>
      <span className="demo-crumbs"><h1>{d.home.name} – {d.away.name}</h1></span>
      <span className="chip sim" data-engine={engine ?? undefined}>{t.simulatedWith(hudEngine ?? '')}</span>
      <span className="demo-spacer" />
      {exportAvailable&&<a className="button-link tp-sim-export" href={exportHref ?? undefined} download>{t.download}</a>}
    </header>:(!shell||exportAvailable)&&<div className="unified-actions">{!shell&&<button onClick={onBack}>{t.back}</button>}{!sequence&&exportAvailable&&<a className="button-link" href={exportHref ?? undefined} download>{t.download}</a>}</div>}
    {shell&&<BroadcastSections value={screen} onChange={chooseView} panelId={panelId} analysis={['summary', 'maps', 'effort']} />}
    {(!sequence||pilotReady)&&(!shell||screen==='broadcast')&&scoreboard}
    {postmatch&&sideReport&&reportAvailability.fullTime&&screen==='broadcast'&&<div className="tp-director-replay-tools"><button type="button" aria-expanded={showReplay} onClick={()=>{if(showReplay)playback.pause();setShowReplay(value=>!value);}}>{showReplay?director.hideReplay:director.showReplay}</button></div>}
    {!simulatedShell&&provenance}
    {sequence?<SequenceExperience ready={pilotReady} times={actionTimes} sequence={sequence} elapsed={pilotReady?elapsed:sequence.policy.fromMs} pitch={field}
      transport={<SequenceTransport state={state} policy={sequence.policy} clock={clock} ready={pilotReady} next={next}
        onPlay={playback.play} onPause={playback.pause} onReplay={()=>pauseSeek(sequence.policy.fromMs)} onNext={()=>{if(next!==null)pauseSeek(next);}}
        onSeek={pauseSeek} onSpeed={playback.setSpeed} onContinue={playback.continueAfterStop}/>}
      onMoment={ms=>pauseSeek(Math.max(sequence.policy.fromMs,ms-1500))} onPlayer={choosePlayer}
      detailsOpen={detailsOpen} onDetails={setShowDetails} details={<>{exportHref&&snapshot.descriptor.export.availability.status==='available'&&<a className="button-link" href={exportHref} download>{t.download}</a>}<div ref={setSettingsTarget}/><MatchSections value={section} onChange={chooseSection} panelId={panelId} />{detailPanel}{section==='data'&&<MatchLayerEvidence layers={snapshot.layers?{...snapshot.layers,anchors:snapshot.layers.anchors.filter(a=>a.elapsedMs!==null&&a.elapsedMs<=elapsed),cuts:snapshot.layers.cuts.filter(c=>c.toMs!==null&&c.toMs<=elapsed)}:undefined}/>}</>}/>
      :shell?detailPanel:<><MatchSections value={section} onChange={chooseSection} panelId={panelId} />{transport}{detailPanel}</>}
    {!shell&&selectedPlayer&&(cardProps?<div className="unified-card-drawer"><PlayerCard key={selectedPlayer.id} {...cardProps} onClose={()=>setSelected(null)}/></div>
      :<MatchPlayerDetail key={selectedPlayer.id} player={selectedPlayer} revealed={revealed} onClose={()=>setSelected(null)}/>)}
    {!sequence&&credits.length>0&&<CreditsPanel lines={credits}/>}
  </article>;
}
