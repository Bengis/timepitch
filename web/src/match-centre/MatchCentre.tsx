import statsbombIcon from '../assets/statsbomb.svg?no-inline';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { PitchHudEngine } from '../match/PitchHud';
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
import { AnnouncementBanner, useBannerPlacement } from '../presentation/AnnouncementBanner';
import { CreditsPanel } from '../presentation/CreditsPanel';
import { attributionsFor } from '../presentation/attribution';
import { PlayerCard } from '../presentation/PlayerCard';
import { LineupsPair, isStarter } from '../presentation/LineupsView';
import { analyseUntil, type RecordedAnalysisModel } from './analysis/recorded-analysis';
import { TeamComparison } from './TeamComparison';
import { NarrationPanel } from './narration/NarrationPanel';
import { AnalysisEffortSection, AnalysisMapsSection, AnalysisSummarySection, EventIcon, SummaryMini, TimelinePanel, type AnalysisContext, type TimelineContext } from './analysis/RecordedAnalysisViews';
import { useAnalysisText } from './analysis/messages';
import { teamAbbreviation } from '../presentation/BroadcastScorebug';
import { minuteLabel } from './announcements/announcements';
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
  /** TP226: arrancar la reproducción sola (a `AUTOPLAY_SPEED`) en cuanto la sesión tenga duración. Con movimiento
   *  reducido no arranca: se ofrece un botón grande de reproducir sobre el campo. */
  autoplay?: boolean;
  /** TP237: el modo gráfico se eligió al lanzar (simulación y demo); el campo no ofrece cambiarlo. */
  rendererLocked?: boolean;
  /** TP243: grabación de motor jugada en vivo (TouchLines): lleva el armazón de partido simulado, no el de la demo. */
  liveSimulation?: boolean };

/** TP239: métricas que enseña «Esfuerzo» en los partidos simulados (distancia, carrera intensa, sprints, velocidad). */
const EFFORT_METRIC = /distance|hsr|sprint|speed|accel|decel|metres_per_minute/;
/** Velocidad del arranque automático (TP226): 10× deja el partido entero en unos 9 minutos. */
export const AUTOPLAY_SPEED = 10;
/** TP237: con Capitán Hane, 5× (por encima solo hay escenas de gol; ver `allowedKinds`). */
export const ANIME_AUTOPLAY_SPEED = 5;
const autoplaySpeed = () => readPitchPreferences(pitchStorage()).renderer === 'anime-1' ? ANIME_AUTOPLAY_SPEED : AUTOPLAY_SPEED;
/** Nombre del botón grande (distinto de «Reproducir» de la barra, que sigue presente). */
const BIG_PLAY = { en: 'Play the match', es: 'Reproducir el partido' } as const;
const prefersReducedMotion = () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

export function MatchCentre(props: MatchCentreProps) {
  return <SessionCentre key={identityKey(props.adapter.identity)} {...props} />;
}

function SessionCentre({ adapter, visible, onBack, initialSection = 'match', onSectionChange, focusEvents = false, actions, sequence, matchLabel, initialElapsedMs, analysis: analysisModel, autoplay = false, rendererLocked = false, liveSimulation = false }: MatchCentreProps) {
  const playback = useMatchPlayback(adapter, visible, sequence?.policy), { state, snapshot, view } = playback;
  const t = usePlayerText(), q = useSequenceText(), ta = useAnalysisText(), panelId = useId();
  const profileKey=sequence?.kind==='actions'?sequence.depiction.key:sequence?.policy.id??'ordinary';
  const [settingsTarget,setSettingsTarget]=useState<HTMLDivElement|null>(null);
  // TP226: escritorio de poca altura (≤ 1000 px): el marcador pasa a lo alto de la columna lateral para que el campo gane alto.
  const [scoreInSide,setScoreInSide]=useState(false);
  const bannerPlacement = useBannerPlacement();
  const [uiProfile,setUiProfile]=useState(profileKey),[showDetails,setShowDetails]=useState(false);
  const detailsOpen=uiProfile===profileKey&&showDetails;
  const { locale } = useLanguage();
  const [azureEnabled,setAzureEnabled] = useState(false);
  const centre = useRef<HTMLElement>(null);
  const [section, setSection] = useState(initialSection), [screen, setScreen] = useState<BroadcastView>(() => broadcastViewFor(initialSection)), [explicitReveal, setReveal] = useState(false), [showSynthetic, setSynthetic] = useState(true), [showAnchors, setAnchors] = useState(true);
  const [selectedValue, setSelected] = useState<string | null>(null), [comparison, setComparison] = useState(false), [failure, setFailure] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [seekGeneration, setSeekGeneration] = useState(0);
  const [analysisScope,setAnalysisScope] = useState<'cursor'|'final'|null>(null), [watchRequest,setWatchRequest] = useState<{elapsedMs:number;token:number}|null>(null);
  const seekTarget = useRef<number | null>(null);
  const reads = useRef<{ player?: AbortController; events?: AbortController } >({});
  const selected=uiProfile===profileKey?selectedValue:null;
  const revealed = uiProfile===profileKey&&explicitReveal || state.isMatchEnd;
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
  const seek = (ms: number) => { seekTarget.current = Math.max(0, Math.min(ms, snapshot.descriptor.durationMs ?? Infinity)); setSeekGeneration(n => n + 1); playback.seek(ms); };
  // Solo al montar: la sesión nueva de otro motor empieza en el mismo punto del partido.
  useEffect(() => { if (initialElapsedMs && initialElapsedMs > 0) seek(initialElapsedMs); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // TP226: arranque automático una sola vez por sesión, cuando ya hay duración (play() no hace nada sin ella).
  const [reducedMotion] = useState(prefersReducedMotion);
  const autoplayed = useRef(false);
  const [bigPlay, setBigPlay] = useState(() => autoplay && reducedMotion);
  const autoplayReady = visible && snapshot.descriptor.durationMs !== null && state.status !== 'unavailable';
  useEffect(() => {
    if (!autoplay || reducedMotion || autoplayed.current || !autoplayReady) return;
    autoplayed.current = true; playback.setSpeed(autoplaySpeed()); playback.play();
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
  const { cast, crests } = useMatchCast(d, players);
  const lastPeriod = d.periods.some(p => p.period === 4) ? 4 : 2;
  const announcements = useMemo(() => buildAnnouncements(source, snapshot.events, { lastPeriod }), [source, snapshot.events, lastPeriod]);
  const reached = useMemo(() => announcements.filter(a => a.atMs <= elapsed), [announcements, elapsed]);
  const reds = { home: reached.filter(a => a.side === 'home' && (a.kind === 'red' || a.kind === 'second_yellow')).length,
    away: reached.filter(a => a.side === 'away' && (a.kind === 'red' || a.kind === 'second_yellow')).length };
  const announcement = useAnnouncer(sequence ? NO_ANNOUNCEMENTS : announcements, elapsed, seekGeneration, state.pendingSeekMs !== null);
  // Sonido del partido (TP231): mismos rótulos y reloj que el rótulo en pantalla; fuera de las secuencias históricas.
  const [soundOn, setSoundOn] = useState(() => readSoundEnabled(pitchStorage()));
  const toggleSound = () => { const next = !soundOn; setSoundOn(next); writeSoundEnabled(pitchStorage(), next); if (next) matchAudio.unlock(); };
  useMatchSound({ events: snapshot.events, announcements, cursorMs: elapsed, speed: state.speed, playing: state.isPlaying,
    seekToken: seekGeneration, seeking: state.pendingSeekMs !== null, enabled: soundOn, active: visible && !sequence });
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
    requestAnimationFrame(()=>centre.current?.querySelector<HTMLButtonElement>('[data-unified-transport] button')?.focus());
  };
  const clock=clockFor(snapshot,state.stop,locale);
  const displayClock=sequence||source==='historical'?clock:undefined;
  const pilotReady=!!sequence&&playback.policyId===sequence.policy.id&&state.pendingSeekMs===null
    &&(state.stop?.kind!=='halftime'||snapshot.presentedCursor.elapsedMs===state.stop.atMs&&snapshot.presentedCursor.period===state.stop.endingPeriod)
    &&elapsed>=sequence.policy.fromMs&&elapsed<=sequence.policy.toMs
    &&(sequence.kind==='boundary-check'||depicted?.availability==='available');
  const motionReady=pilotReady&&(sequence?.kind==='actions'||!!view);
  // Rótulo de acontecimientos: sobre el campo; en el teléfono del armazón, debajo (maqueta v1-2d a 390 px).
  const bannerBelow = shell && bannerPlacement === 'below';
  const banner = (placement: 'overlay' | 'below') => <AnnouncementBanner current={announcement} source={source} cast={cast} players={players} homeName={d.home.name} awayName={d.away.name} crests={crests} engineLabel={engineLabel} placement={placement}/>;
  const field=<div className="sequence-field-host">
    <Pitch frame={frame} previous={previous} cue={sequence?.kind==='actions'?sequenceCue(sequence.source,elapsed):view?.cue} restarting={view?.restarting ?? true} home={snapshot.descriptor.home.name} away={snapshot.descriptor.away.name} displayClockLabel={displayClock?.text??matchTime(view?.clockMs ?? snapshot.clockMs)} playerDisplayRoles={new Map(players.map(p => [p.id, p.role]))} selectedPlayerKey={selected} active={visible && (sequence?motionReady:section === 'match')} onPlayerSelect={openPlayer} defaultCamera={sequence?'overview':undefined} settingsLabel={sequence||shell?q.settings:undefined} settingsTarget={sequence||shell?settingsTarget:undefined} fieldFocus={sequence?.kind==='actions'?sequenceFocus(sequence.depiction,elapsed,selected,false):undefined} cast={cast}
      onRendererChange={setRendererId} rendererLocked={rendererLocked}
      renderAnime={sequence?undefined:({scenes,reducedMotion:still})=><AnimeCutIns events={animeEvents} announcements={announcements} keeperIds={keeperIds} cursorMs={elapsed} speed={state.speed}
        playing={state.isPlaying} seekToken={seekGeneration} seeking={state.pendingSeekMs!==null} scenes={scenes} reducedMotion={still} soundOn={soundOn}
        pause={playback.pause} play={playback.play} labels={ANIME_LABELS[locale==='es'?'es':'en']}
        specFor={cut=>specFor(cut,{players,cast,data:animeData,events:snapshot.events,locale:locale==='es'?'es':'en',nameOf:id=>frame.players.find(p=>p.key===id)?.name??null,art:haneArt})}/>}
      hud={sequence||bannerBelow?undefined:banner('overlay')} renderOverlay={projection => sequence?null:<MatchLayers layers={snapshot.layers} projection={projection} elapsedMs={elapsed} showAnchors={showAnchors}/>}
      {...(shell&&hudEngine?{hudTopLeft:<><span className="chip sim">{t.synthetic}</span><PitchHudEngine label={hudEngine}/></>,sceneCaption:true,cameraTabs:true}:{})}
      overlay={bigPlay&&!state.wantsPlay&&!sequence?<button type="button" className="tp-big-play" data-big-play aria-label={BIG_PLAY[locale === 'es' ? 'es' : 'en']} title={BIG_PLAY[locale === 'es' ? 'es' : 'en']}
        disabled={!autoplayReady} onClick={()=>{playback.setSpeed(autoplaySpeed());playback.play();setBigPlay(false);}}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M7 4.5v15a1 1 0 001.5.86l12-7.5a1 1 0 000-1.72l-12-7.5A1 1 0 007 4.5z"/></svg><span>{t.play}</span></button>:undefined} />
    {sequence&&!motionReady&&<p className="sequence-unavailable" role="status">{state.status==='buffering'?q.loading:q.unavailable}</p>}
    {!sequence&&bannerBelow&&section==='match'&&banner('below')}
    {!sequence&&!view&&<p role="status">{t.noMotion}</p>}
  </div>;
  const scoreboard=<MatchScoreboard snapshot={snapshot} elapsedMs={elapsed} clock={displayClock} crests={crests} kits={cast?.kits ?? null} reds={reds}/>;
  const revealBlock=<div className="unified-reveal"><button disabled={revealed} onClick={() => {setReveal(true);setAnalysisScope('final');}}>{t.reveal}</button>{revealed && <><span role="status">{t.revealed}</span><label>{t.analysisScope}<select value={finalRequested?'final':'cursor'} onChange={e=>setAnalysisScope(e.target.value as 'cursor'|'final')}><option value="cursor">{t.cursor}</option><option value="final">{t.final}</option></select></label></>}</div>;
  const transport=<PlaybackControls state={state} descriptor={snapshot.descriptor} cursor={cursorAt(snapshot.descriptor, elapsed)} onPlay={playback.play} onPause={playback.pause} onSeek={seek} onSpeed={playback.setSpeed} onReplay={playback.replay} marks={analysisCtx ? marks : undefined} sound={{ enabled: soundOn, onToggle: toggleSound }} />;
  const explorer=<MatchEventExplorer snapshot={sequence?{...snapshot,events:snapshot.events.filter(e=>e.elapsedMs!==null&&e.elapsedMs<=elapsed)}:snapshot} players={players} onSeek={watch} onPlayer={openPlayer} onWindow={readWindow} resolvedEvents={resolvedActions} watchRequest={watchRequest} />;
  const filtersUseful=historicalMotion||!!snapshot.layers;
  // TP239: versiones, hashes y fuentes (antes, pestaña «Data»), plegados al final de la columna del partido.
  const technical=<details className="tpa-log" data-technical><summary>{t.technical}</summary><MatchData panel={safe(snapshot.panels.data)} snapshot={snapshot} revealed={revealed} explanationsAvailable={!!explanations||azureEnabled} /></details>;
  const detailPanel=<>
    {!shell&&revealBlock}
    {(failure || snapshot.reason || panelFailure) && <div role="alert"><p>{failure ?? snapshot.reason ?? panelFailure}</p><button onClick={() => { setFailure(null); setRetry(n => n + 1); if (adapter.retry) { const c = new AbortController(); reads.current.events?.abort(); reads.current.events = c; void adapter.retry(elapsed, c.signal).catch(() => { if (!c.signal.aborted) setFailure(t.error); }); } }}>{t.retry}</button></div>}
    <section id={panelId} role="tabpanel" aria-label={shell ? viewLabel : t[section]} className="unified-panel">
      <div className={`unified-match-area${shell?' tpa-stage':''}`} hidden={section!=='match'}>{!sequence&&<div className="unified-stage-main">{(!shell||filtersUseful)&&<div className="unified-filters" aria-label={t.layers}><label><input type="checkbox" checked={showSynthetic} disabled={!historicalMotion} onChange={e => setSynthetic(e.target.checked)} />{t.synthetic}</label><label><input type="checkbox" checked={showAnchors} disabled={!snapshot.layers} onChange={e => setAnchors(e.target.checked)} />{t.anchors}</label></div>}{field}<MatchLayerEvidence layers={snapshot.layers}/></div>}
        {analysisCtx&&analysisModel?<aside className="tpa-side" data-analysis-side>
          {scoreInSide&&scoreboard}
          <SummaryMini ctx={analysisCtx}/>
          <TimelinePanel ctx={analysisCtx} events={analysisModel.events} untilMs={finalRequested?d.durationMs??elapsed:elapsed} onSeek={seek}/>
          {revealBlock}
          <details className="tpa-log"><summary>{ta.events}</summary>{explorer}</details>
          {technical}
        </aside>:shell?<aside className="tpa-side tp-sim-side" data-simulated-side>{scoreInSide&&scoreboard}
          {/* TP241 («la acción debería verla narrada»): narración en frases llanas en vez de la cronología de TP239;
              el registro sigue plegado. */}
          {timelineCtx&&<NarrationPanel ctx={timelineCtx} events={narrationEvents} keepers={keeperIds} untilMs={finalRequested?d.durationMs??elapsed:elapsed} onSeek={seek}/>}
          {revealBlock}
          <details className="tpa-log"><summary>{ta.events}</summary>{explorer}</details>
          {technical}</aside>:explorer}</div>
      {/* Maqueta: la barra de reproducción va en un panel a lo ancho, debajo de la rejilla campo + columna. */}
      {shell && (screen === 'broadcast' || isAnalysisView) && <div className="tp-playback-panel" data-playback-panel>{transport}</div>}
      {/* Ajustes del campo (iluminación, detalle, seguir jugador) plegados bajo la barra: la maqueta deja el campo limpio y la cámara va en el HUD. */}
      {shell && <div ref={setSettingsTarget} className="tp-pitch-settings-host" hidden={screen !== 'broadcast'} />}
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
        <p className="unified-scope tpa-scope">{/* Resumen, Mapas y Esfuerzo ya llevan el chip en cada panel (TP205). */}
          {section !== 'summary' && section !== 'maps' && section !== 'effort' && <span className="chip sim">{ta.simulated} · {analysisCtx.engineLabel}</span>} {finalRequested ? ta.final : ta.upTo(minuteLabel(source, snapshot.presentedCursor.period, snapshot.clockMs ?? 0))}</p>
        {section === 'summary' && analysisModel && <AnalysisSummarySection ctx={analysisCtx} events={analysisModel.events} />}
        {section === 'maps' && <AnalysisMapsSection ctx={analysisCtx} selected={selected} />}
        {section === 'effort' && <AnalysisEffortSection ctx={analysisCtx} />}
        {section === 'data' && <MatchData panel={panel} snapshot={snapshot} revealed={revealed} explanationsAvailable={!!explanations||azureEnabled} />}
        {revealBlock}
      </>}
      {section !== 'match' && !analysisCtx && (!shell || isAnalysisView) && <>
        {shell && revealBlock}
        {/* TP239: en los simulados, solo el instante («hasta 0:30»); el estado técnico del panel queda en la vista histórica. */}
        <p className="unified-scope">{shell ? (panel?.scope === 'final' ? ta.final : ta.upTo(displayClock?.text ?? matchTime(elapsed)))
          : <>{panel?.scope === 'final' ? t.final : t.cursor} · {matchTime(panel?.cutoff?.elapsedMs ?? null)} · {panel?.availability.status ?? t.loading} {panel?.availability.reason}</>}</p>
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
        {section === 'maps' && <MatchMaps plots={panel?.plots.filter(p => p.kind !== 'effort') ?? []} onSeek={watch} simple={shell} />}
        {/* TP239 (jueces: «Esfuerzo» repetía la tabla del Resumen): en los simulados, solo las métricas de esfuerzo. */}
        {section === 'effort' && (historicalMotion ? <p role="status">{t.tracking}</p> : <><MatchMetricTable metrics={[...(panel?.metrics ?? []), ...(panel?.players.flatMap(p => p.metrics) ?? [])].filter(m => !shell || EFFORT_METRIC.test(m.id))} names={names} title={t.effort} /><MatchMaps plots={panel?.plots.filter(p => p.kind === 'effort') ?? []} onSeek={watch} /></>)}
        {section === 'data' && <MatchData panel={panel} snapshot={snapshot} revealed={revealed} explanationsAvailable={!!explanations||azureEnabled} />}
      </>}
    </section>
    {explanations && <div hidden={section !== 'summary'}><Explanations id={explanations.id} revision={explanations.revision} homeName={snapshot.descriptor.home.name} awayName={snapshot.descriptor.away.name} events={snapshot.events} time={elapsed} visible={visible && section === 'summary'} hideFullMatch={azureEnabled}/></div>}
  </>;
  const actionTimes=sequence?.kind==='actions'?[...new Set(sequence.source.events.filter(e=>(['Pass','Carry','Shot','Block','Ball Recovery'].includes(e.kind)||e.kind==='Goal Keeper'&&e.outcome==='Shot Saved')&&e.elapsedMs>=sequence.policy.fromMs&&e.elapsedMs<=sequence.policy.toMs).map(e=>e.elapsedMs))].sort((a,b)=>a-b):[];
  const next=actionTimes.find(at=>at>elapsed)??null;
  const pauseSeek=(ms:number)=>{playback.pause();seek(ms);};
  // TP226: en escritorio la emisión cabe en una pantalla. Se mide dónde acaba la barra de reproducción y el alto que
  // queda (--tp-fit-h) limita el ancho del campo (mantiene su proporción) y la columna lateral.
  useLayoutEffect(() => {
    const el = centre.current;
    if (!shell || !visible || screen !== 'broadcast' || !el) return;
    const update = () => {
      const field = el.querySelector<HTMLElement>('.tpa-stage .retro-field'), bar = el.querySelector<HTMLElement>('.tp-playback-panel');
      const side = window.innerWidth > 860 && window.innerHeight <= 1000 && el.clientWidth > 1000;
      setScoreInSide(side);
      if (window.innerWidth <= 860 || !field) { delete el.dataset.fit; el.style.removeProperty('--tp-fit-h'); return; }
      // Lo que sobra (o falta) bajo la barra respecto al alto de la ventana se resta (o suma) al alto actual del campo.
      const bottom = (bar ?? field).getBoundingClientRect().bottom + window.scrollY, height = field.getBoundingClientRect().height;
      const fit = Math.max(280, Math.floor(height - (bottom + 8 - window.innerHeight)));
      el.dataset.fit = '';
      // Al cambiar, se vuelve a medir poco después (no con requestAnimationFrame, que se detiene
      // en pestañas en segundo plano) hasta que el valor se estabiliza (la columna lateral o
      // los avisos bajo el campo pueden mover la barra la primera vez).
      if (Math.abs((parseFloat(el.style.getPropertyValue('--tp-fit-h')) || 0) - fit) > 2 && settle++ < 4) { el.style.setProperty('--tp-fit-h', `${fit}px`); frame = window.setTimeout(update, 60); }
    };
    let settle = 0, frame = 0;
    const remeasure = () => { settle = 0; update(); };
    remeasure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure);
    observer?.observe(el); window.addEventListener('resize', remeasure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', remeasure); window.clearTimeout(frame); };
  }, [shell, visible, screen]);
  // Procedencia del partido; en el armazón de los simulados va a la vista en la barra superior (TP226).
  const provenance=<p className="unified-provenance" role="note">{historicalMotion&&<a className="unified-provider" href="https://github.com/hudl/open-data" target="_blank" rel="noreferrer"><img src={statsbombIcon} alt="Hudl Statsbomb" width="24" height="24"/>StatsBomb Open Data</a>}{sequence?`${q.historical} · ${q.source}`:historicalMotion?t.historical:t.simulated}{(engineLabel||simulatedShell)&&<span className="chip sim unified-engine" data-engine={engine ?? undefined}>{t.movement}: {hudEngine}</span>}</p>;
  return <article ref={centre} className={`unified-centre${sequence?' sequence-centre':''}${shell?' tp-shell':''}`} data-view={shell?screen:undefined} data-unified-match-centre data-source={source} hidden={!visible}>
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
    {(!sequence||pilotReady)&&(!shell||screen==='broadcast')&&!(shell&&scoreInSide)&&scoreboard}
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
