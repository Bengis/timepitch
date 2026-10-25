import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '../i18n';
import { useMatchText } from './messages';
import { clockLabel } from './replay';
import { type CameraMode, type VisualCue, type SceneFrame } from './retroScene';
import { pointerToProjection } from './renderers/projection';
import { drawingRendererFor, type Appearance, type DetailLevel, type PitchProjection, type PitchRenderInput, type SelectableRendererId } from './renderers/types';
import type { MatchCast } from '../presentation/types';
import { pitchStorage, readAnimeScenes, readPitchPreferences, writeAnimeScenes, writePitchPreferences, type AnimeScenesSetting, type PitchPreferences } from './renderers/preferences';
import './anime/anime-mode.css';
import { usePitchRenderer } from './renderers/usePitchRenderer';
import { useGraphicsText } from './renderers/messages';
import { inspectorOptions } from './inspector-options';
import { PitchHud } from './PitchHud';


export function Pitch({ frame, previous = frame, cue, restarting = false, home, away, displayClockMs, displayClockLabel, ariaLabel, fieldClassName='', renderOverlay, showPlayerRole=true, playerDisplayRoles, onPlayerSelect, selectedPlayerKey, active = true, fieldFocus,defaultCamera,settingsLabel,settingsTarget, cast = null, hud, hudTopLeft, sceneCaption, cameraTabs = false, overlay, renderAnime, onRendererChange, rendererLocked = false }: {
  frame: SceneFrame; previous?: SceneFrame; cue?: VisualCue; restarting?: boolean; home: string; away: string; displayClockMs?:number;
  displayClockLabel?:string; ariaLabel?:string; fieldClassName?:string; renderOverlay?:(projection:PitchProjection)=>ReactNode; showPlayerRole?:boolean;
  playerDisplayRoles?:ReadonlyMap<string,{value:string|null;provenance:string}>; onPlayerSelect?:(key:string|null)=>void;
  selectedPlayerKey?:string|null; active?:boolean;
  fieldFocus?:Readonly<{x:number;y:number}>|null;defaultCamera?:CameraMode;settingsLabel?:string;settingsTarget?:Element|null;
  /** Identidad visual (equipaciones, dorsales, apariencia) para los renderizadores que la usan (G16/G17). */
  cast?: MatchCast | null;
  /** Capa de emisión superpuesta al campo (marcador y rótulos); no recibe clics. */
  hud?: ReactNode;
  /** HUD de emisión (opt-in): chips de procedencia arriba a la izquierda, que aporta el shell. */
  hudTopLeft?: ReactNode;
  /** Rótulo de escena con el reloj real; `true` usa la nota del motor sintético, un texto la sustituye. */
  sceneCaption?: boolean | string;
  /** Pestañas glass de cámara (Emisión = follow, Táctica = overview) sobre el campo. */
  cameraTabs?: boolean;
  /** Control superpuesto que sí recibe clics (p. ej. el botón grande de reproducir con movimiento reducido, TP226). */
  overlay?: ReactNode;
  /** Capitán Hane (TP234): capa de escenas anime, solo con ese modo elegido y el campo activo. */
  renderAnime?: (options: { scenes: AnimeScenesSetting; reducedMotion: boolean }) => ReactNode;
  /** Avisa del gráfico elegido (el centro lo usa para la habilidad de la ficha en Capitán Hane). */
  onRendererChange?: (id: SelectableRendererId) => void;
  /** TP237: el modo gráfico se eligió al lanzar (simulación y demo); aquí no se ofrece cambiarlo. */
  rendererLocked?: boolean;
}) {
  const [reducedMotion,setReducedMotion]=useState(()=>typeof window!=='undefined'&&(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false));
  useEffect(()=>{
    const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');if(!media)return;
    const changed=()=>setReducedMotion(media.matches);changed();media.addEventListener?.('change',changed);
    return ()=>media.removeEventListener?.('change',changed);
  },[]);
  const [localSelected, setLocalSelected] = useState<string|null>(null);
  const selected = selectedPlayerKey === undefined ? localSelected : selectedPlayerKey;
  const [preferences, setPreferences] = useState(() => readPitchPreferences(pitchStorage(),defaultCamera));
  // «Retro 16 bits» de serie (TP223); el 3D sigue elegible y, si se elige, queda guardado como elección. El 2D `retro-1`
  // solo aparece como respaldo automático si el 3D falla.
  const { camera, appearance, detail } = preferences, requested = preferences.renderer, drawn = drawingRendererFor(requested), anime = requested === 'anime-1';
  const [animeScenes, setAnimeScenes] = useState<AnimeScenesSetting>(() => readAnimeScenes(pitchStorage()));
  const chooseScenes = (value: AnimeScenesSetting) => { setAnimeScenes(value); writeAnimeScenes(pitchStorage(), value); };
  useEffect(() => { onRendererChange?.(requested); }, [requested, onRendererChange]);
  const change = (value: Partial<PitchPreferences>) => { setPreferences(previous => ({ ...previous, ...value })); };
  useEffect(() => { writePitchPreferences(pitchStorage(), preferences); }, [preferences]);
  const m = useMatchText(), g = useGraphicsText(), { t } = useLanguage();
  const clock = displayClockLabel ?? clockLabel(displayClockMs ?? frame.clock_ms);
  const input = useMemo<PitchRenderInput>(() => ({ frame, previous, cue, restarting, selectedPlayerKey: selected, camera:reducedMotion?'overview':camera, fieldFocus,
    appearance, detail, labels: { home, away, clock, goal: m.goal }, cast, style: anime ? 'hane' : null }),
  [frame, previous, cue, restarting, selected, camera, reducedMotion, fieldFocus, appearance, detail, home, away, clock, m.goal, cast, anime]);
  const container = useRef<HTMLDivElement>(null);
  const graphics = usePitchRenderer({ container, active, requested: drawn, input });
  useLayoutEffect(() => {
    const canvas = container.current?.querySelector('canvas');
    if (canvas) { canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', ariaLabel ?? m.pitch); }
  }, [ariaLabel, m.pitch, graphics.effectiveId, graphics.projection]);
  const choosePlayer = (key: string|null) => {
    if (selectedPlayerKey === undefined) setLocalSelected(key);
    onPlayerSelect?.(key);
  };
  const player = frame.players.find(p => p.key === selected);
  const inspectable = useMemo(() => inspectorOptions(frame.players, cast), [frame.players, cast]);
  const playerName = player ? inspectable.options.find(o => o.key === player.key)?.name ?? player.name : '';
  const broadcastHud = Boolean(hudTopLeft || sceneCaption || cameraTabs);
  const statusText = graphics.status === 'loading' ? (drawn === 'retro16-1' ? g.loadingRetro16 : g.loading) : graphics.status === 'fallback' ? (drawn === 'retro16-1' ? g.fallbackRetro16 : g.fallback) : graphics.status === 'failed' ? g.failed : graphics.effectiveId === 'stylized-3d-1' ? g.ready : graphics.effectiveId === 'retro16-1' ? (anime ? `${g.animeReady} ${g.retro16Ready}` : g.retro16Ready) : '';
  const cameraPicker=<label>{m.camera}<select value={camera} onChange={e => change({ camera: e.target.value as CameraMode })}>
      <option value="follow">{m.followPlay}</option><option value="overview">{m.fullPitch}</option>
    </select></label>;
  const toolbar=<div className="pitch-toolbar"><span className="retro-label">TIMEPITCH</span>
      {!rendererLocked && <label>{g.graphics}<select value={requested} onChange={e => { const next = e.target.value as SelectableRendererId; change({ renderer: next, rendererChosen: true }); }}>
        <option value="retro16-1">{g.styleRetro16}</option><option value="stylized-3d-1">{g.style3d}</option>
      </select></label>}
      {anime && <span className="hane-mode-label" data-anime-fictional>{g.animeFictional}</span>}
      {anime && <label>{g.animeScenes}<select value={animeScenes} onChange={e => chooseScenes(e.target.value as AnimeScenesSetting)}>
        <option value="all">{g.animeAll}</option><option value="goals">{g.animeGoals}</option><option value="none">{g.animeNone}</option>
      </select></label>}
      {!settingsLabel&&cameraPicker}
      <label>{g.lighting}<select value={appearance} onChange={e => change({ appearance: e.target.value as Appearance })}>
        <option value="daylight">{g.daylight}</option><option value="floodlights">{g.floodlights}</option>
      </select></label><label>{g.detail}<select value={detail} onChange={e => change({ detail: e.target.value as DetailLevel })}>
        <option value="standard">{g.standard}</option><option value="low">{g.low}</option>
      </select></label>
    </div>;
  const inspector=<><div className="pitch-inspector"><label>{m.choosePlayer}<select value={frame.players.some(p=>p.key===selected)?selected??'':''} onChange={e => choosePlayer(e.target.value || null)}><option value="">{m.none}</option>{inspectable.options.map(p => <option key={p.key} value={p.key}>{p.side === 'home' ? t.home : t.away} · {p.label}</option>)}</select></label>
      {(player || !inspectable.realNumbers) && <p className="small-note">{player ? `${playerName}${playerDisplayRoles ? (playerDisplayRoles.get(player.key)?.value ? ` · ${playerDisplayRoles.get(player.key)!.value} (${playerDisplayRoles.get(player.key)!.provenance})` : '') : showPlayerRole ? ` · ${t[player.role]}` : ''} · ${player.side === 'home' ? home : away}` : m.playerNote}</p>}</div>
    <p className="small-note camera-note">{m.cameraNote}</p>
    <details className="pitch-graphics-help"><summary>{g.help}</summary><p className="small-note">{g.limitations}</p>{(drawn === 'retro16-1' || graphics.effectiveId === 'retro16-1') && <p className="small-note">{g.limitationsRetro16}</p>}{anime && <p className="small-note">{g.animeHelp}</p>}</details></>;
  return <section className="pitch-section" data-renderer={graphics.effectiveId ?? undefined} data-requested-renderer={requested}
    data-effective-renderer={graphics.effectiveId ?? undefined} data-renderer-status={graphics.status}>
    {!settingsLabel&&toolbar}
    {settingsLabel&&!cameraTabs&&<div className="pitch-style-selector">{cameraPicker}</div>}
    <div className={`retro-field pitch-surface ${broadcastHud ? 'pitch-hud-wrap ' : ''}${fieldClassName}`} hidden={!active}>
      <div ref={container} className="pitch-canvas-container" onClick={e => {
        if (!graphics.projection || !container.current) return;
        const point = pointerToProjection(e.clientX, e.clientY, container.current.getBoundingClientRect(), graphics.projection.viewport);
        const key = point && graphics.pickPlayer(point); if (key) choosePlayer(key);
      }} />
      {active && graphics.projection && renderOverlay?.(graphics.projection)}
      {active && broadcastHud && <PitchHud topLeft={hudTopLeft}
        caption={sceneCaption ? { clock, note: typeof sceneCaption === 'string' ? sceneCaption : undefined } : null}
        camera={cameraTabs ? { value: camera, onChange: mode => change({ camera: mode }) } : null} />}
      {active && hud && <div className="pitch-hud">{hud}</div>}
      {active && overlay}
      {/* TP239 (jueces: la tarjeta tapaba el campo al empezar): etiqueta fija y pequeña; la explicación, al pasar el ratón y para lectores de pantalla. */}
      {active && anime && <p className="hane-badge" data-anime-intro title={g.animeIntro}>{g.styleAnime} · {g.animeFictional}<span className="sr-only"> {g.animeIntro}</span></p>}
      {active && anime && renderAnime?.({ scenes: animeScenes, reducedMotion })}
    </div>
    <div className="pitch-status" aria-live="polite" aria-atomic="true">
      {active && (statusText || graphics.artFailed) && <p role="status" className="small-note">{statusText}{graphics.artFailed && ` ${m.artUnavailable}`}</p>}
    </div>
    {active && (graphics.status === 'fallback' || graphics.status === 'failed') && <button type="button" onClick={graphics.retry}>{drawn === 'retro16-1' ? g.retryRetro16 : g.retry}</button>}
    {/* TP237: los ajustes, tras un icono ⚙ pequeño (el nombre sigue para lectores de pantalla). */}
    {settingsTarget!==undefined?(settingsTarget?createPortal(<details className="pitch-settings"><summary title={settingsLabel}><span aria-hidden="true">⚙</span> <span className="pitch-settings-label">{settingsLabel}</span></summary>{toolbar}{inspector}</details>,settingsTarget):null):settingsLabel?<details className="pitch-settings"><summary title={settingsLabel}><span aria-hidden="true">⚙</span> <span className="pitch-settings-label">{settingsLabel}</span></summary>{toolbar}{inspector}</details>:inspector}
  </section>;
}
