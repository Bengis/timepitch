import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createMatch, getMatches, getMatch, getReplay, importReplay, getTeams, getEngines,createGrfMatch,getGrfMatch,getGrfMatches,getGrfReplay,createTouchLinesMatch,getTouchLinesMatch,getTouchLinesRecord,type TouchLinesRecord,type GrfJob,type GrfReplay,type EngineCapability,type MatchJob, type MatchRecord, type TeamSummary } from './api';
import { isLocalPreview, LanguageSelector, useFlagText, useLanguage } from './i18n';
import { Roster } from './catalog/Roster';
import { LineupPicker } from './match/LineupPicker';
import { useTeam, type TeamSelection } from './match/useTeam';
import { useMatchText } from './match/messages';
import { MatchView } from './match/MatchView';
import {type Engine} from './grf/EngineSelector';
import {ChoiceGroup} from './versus/MatchChoices';
import {TouchLinesMatchView} from './touchlines/TouchLinesMatchView';
import {GrfMatchView} from './grf/GrfMatchView';
import {GrfHistory} from './grf/GrfHistory';
import {useCentreText} from './match-centre/messages';
import {UnsupportedGrfReplayError} from './api';
import {useGrfText} from './grf/messages';
import {TeamCrest,MatchCrests} from './catalog/TeamCrest';
import {readCapabilities,type HistoricalCapabilities} from './historical/api';
import {HistoricalExplorer} from './historical/HistoricalExplorer';
import {HistoricalMatchCentre} from './historical/HistoricalMatchCentre';
import {useHistoricalText} from './historical/messages';
import {WorkspaceShell} from './match-centre/WorkspaceShell';
import {HOME_ROUTE,parseWorkspaceHash,formatWorkspaceHash,type WorkspaceRoute} from './match-centre/navigation';
import type {MatchSection} from './match-centre/session';
import {DemoEntry,DemoMatch,demoEntryText} from './match-centre/DemoMatch';
import {VersusScreen} from './versus/VersusScreen';
import {installGestureUnlock} from './match/audio/engine';
import {useVersusText} from './versus/messages';
import {DEFAULT_RENDERER,pitchStorage,readPitchPreferences,writePitchPreferences} from './match/renderers/preferences';
import type {SelectableRendererId} from './match/renderers/types';
// TP215/TP240: portada propia dentro del build (asset con hash).
import premierArt from './assets/timepitch-premier.webp';
import conceptArt from './assets/timepitch-concept.webp';
import { fictional } from './catalog/fictional';
import { NamesToggle } from './catalog/NamesToggle';

// TP259: la liga ficticia usa la ilustración de jugadores genéricos; la otra recuerda a jugadores reales.
const coverArt = fictional() ? conceptArt : premierArt;

function TeamPanel({ side, selection,grf }: { side: 'home' | 'away'; selection: TeamSelection;grf:boolean }) {
  const { t } = useLanguage();
  const flagText = useFlagText();
  const c=useCentreText();
  const { key, team, failed, retry } = selection;
  return <article className={`team-panel ${side}`} aria-label={t[side]}>
    {failed ? <div role="alert" className="panel-message">{t.loadError} <button onClick={retry}>{t.retry}</button></div> : !team ? <p role="status" className="panel-message">{t.loading}</p> : <>
      <header className="team-heading"><TeamCrest teamKey={key}/><div><span className="season-tag">{team.season_label}</span><h2>{team.name}</h2></div></header>
      {/* TP226: el balance (PJ, GF, GC) ya está en la tarjeta VERSUS de arriba; aquí solo alineación y táctica. */}
      <LineupPicker selection={selection} disableTactics={grf} />
      <details className="squad-details"><summary>{c.squadSources}</summary>
      <div className="squad-provenance"><p>{t.rosterSource}: <strong>{team.source === 'fpl' ? 'Fantasy Premier League' : 'epldata'}</strong></p><p>{t.resultsSource}: <strong>{team.results_sources.map(source => source === 'football-data' ? 'Football-Data.co.uk' : source).join(', ')}</strong></p></div>
      <div className="formation-row"><span>{t.formation}</span>{team.available_formations.map(formation => <span className="formation" key={formation}>{formation}</span>)}</div>
      <details className="quality-notes"><summary>{t.quality} · {team.quality_flags.length}</summary><ul>{team.quality_flags.map(flag => <li key={flag}>{flagText(flag)}</li>)}</ul></details>
      <Roster team={team} />
      </details>
    </>}
  </article>;
}

export default function App() {
  const { t } = useLanguage();
  const m = useMatchText();
  const g = useGrfText();
  const c=useCentreText();
  const h=useHistoricalText();
  const v=useVersusText();
  const {locale}=useLanguage();
  // TP236: gráficos elegidos al lanzar el partido. Sin elección previa, Capitán Hane (lo más vistoso de la demo).
  const [graphics,setGraphics]=useState<SelectableRendererId>(()=>{const p=readPitchPreferences(pitchStorage());return p.rendererChosen?p.renderer:DEFAULT_RENDERER;});
  // TP231: el primer gesto (Ver la demo, Simular, abrir un guardado, Reproducir) desbloquea el sonido del partido.
  useEffect(()=>installGestureUnlock(),[]);
  const [legacyPage,setLegacyPage]=useState<'setup'|'match'|'library'>('setup');
  // TP226: la demo arranca sola cuando se abre desde VERSUS (no desde la biblioteca ni con el enlace directo).
  const [demoAutoplay,setDemoAutoplay]=useState(false);
  // TP246: la demo abierta desde «Crónica IA de ejemplo» baja hasta la crónica y «Volver» lleva a la portada.
  const [demoReport,setDemoReport]=useState(false);
  const [historicalCapabilities,setHistoricalCapabilities]=useState<HistoricalCapabilities|null>(null);
  const [route,setRoute]=useState<WorkspaceRoute>(()=>parseWorkspaceHash(window.location.hash));
  const [historicalRoute,setHistoricalRoute]=useState<Extract<WorkspaceRoute,{mode:'reconstruction'}>>(()=>{const route=parseWorkspaceHash(window.location.hash);return route.mode==='reconstruction'?route:{mode:'reconstruction'};});
  const routeRef=useRef(route),historyRouteRef=useRef(historicalRoute);routeRef.current=route;historyRouteRef.current=historicalRoute;
  const simulationTab=useRef<MatchSection>('match');if(route.mode==='simulation')simulationTab.current=route.tab??'match';
  const twoModes=historicalCapabilities?.two_modes_ui===true;
  const modesRef=useRef(twoModes);modesRef.current=twoModes;
  const navigate=useCallback((next:WorkspaceRoute)=>{
    routeRef.current=next;setRoute(next);
    if(next.mode==='reconstruction'){historyRouteRef.current=next;setHistoricalRoute(next);}
    const hash=formatWorkspaceHash(next);if(window.location.hash!==hash)window.location.hash=hash;
  },[]);
  const setPage=useCallback((value:'setup'|'match'|'library')=>{setLegacyPage(value);if(modesRef.current)navigate(value==='library'?{mode:'library'}:{mode:'simulation',view:value==='match'?'centre':'setup'});},[navigate]);
  const page=route.mode==='demo'?'demo':twoModes?(route.mode==='library'?'library':route.mode==='simulation'?(route.view==='centre'?'match':'setup'):'historical'):legacyPage;
  useEffect(()=>{
    const controller=new AbortController();void readCapabilities(controller.signal).then(value=>{if(!controller.signal.aborted)setHistoricalCapabilities(value);}).catch(()=>{});
    const changed=()=>{const next=parseWorkspaceHash(window.location.hash);routeRef.current=next;setRoute(next);if(next.mode==='reconstruction'){historyRouteRef.current=next;setHistoricalRoute(next);}};
    window.addEventListener('hashchange',changed);return()=>{controller.abort();window.removeEventListener('hashchange',changed);};
  },[]);
  // TP225: primera visita con el enfrentamiento de la demo preseleccionado (Arsenal 2003/04 contra City 2024/25).
  const home = useTeam('arsenal:2003'), away = useTeam('mancity:2024');
  const [jobs, setJobs] = useState<MatchJob[]>([]), [sessionReady, setSessionReady] = useState(false), [sessionFailed, setSessionFailed] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0), [seed, setSeed] = useState('42'), [busy, setBusy] = useState(false);
  const [fixedSeed, setFixedSeed] = useState(false);
  const lastSeed = useRef<number | null>(null);
  // TP242 (24-oct: «pon GRF por defecto»; medido: 17,9 s de «Jugar partido» al partido en la web pública).
  // Si GRF no está disponible, se cae al motor TimePitch sin ofrecerlo en el menú.
  const [engine,setEngine]=useState<Engine>('grf'),[capabilities,setCapabilities]=useState<EngineCapability[]|null>(null),[grfJobs,setGrfJobs]=useState<GrfJob[]>([]);
  const [jobId, setJobId] = useState<{engine:Engine;id:string} | null>(null), [status, setStatus] = useState<MatchJob['state'] | null>(null);
  const [active, setActive] = useState<{engine:'timepitch';id:string;record:MatchRecord}|{engine:'grf';id:string;record:GrfReplay}|{engine:'touchlines';id:string;record:TouchLinesRecord}|null>(null), [error, setError] = useState<'busy' | 'invalid' | 'tooLarge' | 'matchError' | 'physicalUnavailable' | null>(null);
  const historyGeneration=useRef({timepitch:0,grf:0});
  const refreshHistory=useCallback(async(selectedEngine:'timepitch'|'grf',signal?:AbortSignal)=>{
    const generation=++historyGeneration.current[selectedEngine];
    if(selectedEngine==='grf'){
      const value=await getGrfMatches(signal);
      if(!signal?.aborted&&generation===historyGeneration.current.grf)setGrfJobs(value);
    }else{
      const value=await getMatches(signal);
      if(!signal?.aborted&&generation===historyGeneration.current.timepitch)setJobs(value);
    }
  },[]);
  const report = (error: unknown) => setError(error instanceof UnsupportedGrfReplayError ? 'physicalUnavailable' : error instanceof ApiError && error.status === 429 ? 'busy' : error instanceof ApiError && error.status === 422 ? 'invalid' : 'matchError');
  useEffect(() => {
    const controller = new AbortController(); setSessionFailed(false);
    refreshHistory('timepitch',controller.signal).then(() => { if (!controller.signal.aborted) setSessionReady(true); }).catch(e => { if (e.name !== 'AbortError') setSessionFailed(true); });
    return () => controller.abort();
  }, [sessionAttempt,refreshHistory]);
  useEffect(()=>{
    if(!sessionReady)return;
    const controller=new AbortController();
    getEngines(controller.signal).then(value=>{if(!controller.signal.aborted){setCapabilities(value);if(!value.find(v=>v.id==='grf')?.available)setEngine('timepitch');}}).catch(()=>{if(!controller.signal.aborted){setCapabilities([]);setEngine('timepitch');}});
    void refreshHistory('grf',controller.signal).catch(()=>{});
    return()=>controller.abort();
  },[sessionReady,refreshHistory]);
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await (jobId.engine==='grf'?getGrfMatch(jobId.id,controller.signal):jobId.engine==='touchlines'?getTouchLinesMatch(jobId.id,controller.signal):getMatch(jobId.id,controller.signal)); if (controller.signal.aborted) return;
        setStatus(job.state);
        if (job.state === 'ready') {
          if(jobId.engine==='grf'){
            const record=await getGrfReplay(job.id,controller.signal);if(controller.signal.aborted)return;
            setActive({engine:'grf',id:job.id,record});
          }else if(jobId.engine==='touchlines'){
            // TP243: TouchLines en vivo (sin historial propio en la biblioteca).
            const record=await getTouchLinesRecord(job.id,controller.signal);if(controller.signal.aborted)return;
            setActive({engine:'touchlines',id:job.id,record});
          }else{
            const record=await getReplay(job.id,controller.signal);if(controller.signal.aborted)return;
            setActive({engine:'timepitch',id:job.id,record});
          }
          setBusy(false); setJobId(null);
          if(!modesRef.current||routeRef.current.mode==='simulation'){setPage('match');window.scrollTo(0,0);}
          void refreshHistory('timepitch').catch(() => {});
          void refreshHistory('grf').catch(()=>{});
        } else if (job.state === 'failed') { setError('matchError'); setBusy(false); setJobId(null); }
        else timer = setTimeout(poll, 500);
      } catch (e) { if (!controller.signal.aborted) { report(e); setBusy(false); setJobId(null); } }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [jobId,refreshHistory,setPage]);
  const canStart = !busy && sessionReady && !(engine!=='timepitch'&&!capabilities?.find(v=>v.id===engine)?.available) && home.valid && away.valid
    && !(fixedSeed && (seed === '' || !Number.isInteger(Number(seed)) || Number(seed) < 0 || Number(seed) > 4294967295));
  // El centro lee los gráficos guardados al montarse: se guardan antes de crear el partido o abrir la demo.
  const saveGraphics = () => { const storage=pitchStorage();writePitchPreferences(storage,{...readPitchPreferences(storage),renderer:graphics,rendererChosen:true}); };
  const start = async () => {
    saveGraphics();
    setError(null); setBusy(true); setStatus('queued');
    try {
      const selectedEngine=engine;
      let matchSeed = fixedSeed ? Number(seed) : crypto.getRandomValues(new Uint32Array(1))[0];
      if (!fixedSeed && matchSeed === lastSeed.current) matchSeed = (matchSeed + 1) >>> 0;
      lastSeed.current = matchSeed;
      const job = await (selectedEngine==='grf'?createGrfMatch:selectedEngine==='touchlines'?createTouchLinesMatch:createMatch)({ home_key: home.key, away_key: away.key, home_players: home.players, away_players: away.players,
        home_formation: home.formation, away_formation: away.formation, home_tactic: selectedEngine!=='timepitch'?'balanced':home.tactic, away_tactic:selectedEngine!=='timepitch'?'balanced':away.tactic, seed: matchSeed });
      setJobId({engine:selectedEngine,id:job.id});
    } catch (e) { report(e); setBusy(false); }
  };
  const importFile = async (file?: File) => {
    if (!file) return; setError(null);
    if (file.size > 16 * 1024 * 1024) { setError('tooLarge'); return; }
    setBusy(true); setStatus('queued');
    try { const job = await importReplay(JSON.parse(await file.text())); setJobId({engine:'timepitch',id:job.id}); }
    catch (e) { report(e); setBusy(false); }
  };
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    getTeams(controller.signal).then(setTeams).catch(error => { if (error.name !== 'AbortError') setFailed(true); });
    return () => controller.abort();
  }, [attempt]);
  return <div className={`app-shell${twoModes?' two-modes':''}`}>
    {twoModes?<WorkspaceShell route={route} onNavigate={next=>navigate(next.mode==='reconstruction'?historyRouteRef.current:next)} busy={busy} ready={!!active}>{null}</WorkspaceShell>:<header className="topbar"><a className="wordmark" href="/">TIME<span>PITCH</span><i /></a><nav className="workspace-nav" aria-label={c.workspace}>
      <button disabled={busy} aria-current={page==='setup'?'page':undefined} onClick={()=>setPage('setup')}>{c.newMatch}</button>
      <button disabled={busy||!active} aria-current={page==='match'?'page':undefined} onClick={()=>setPage('match')}>{c.matchCentre}</button>
      <button disabled={busy} aria-current={page==='library'?'page':undefined} onClick={()=>setPage('library')}>{c.library}</button>
    </nav><div className="topbar-right">{isLocalPreview()&&<span className="local-label"><b />{t.local}</span>}<NamesToggle /><LanguageSelector /></div></header>}
    <main>
      {twoModes&&<>
        {route.mode==='reconstruction'&&(!(historicalCapabilities?.reconstruction_enabled&&historicalCapabilities.dataset_version)?<p role="alert" className="historical-workspace">{h.unavailable}</p>:!route.matchId?<HistoricalExplorer route={route} datasetVersion={historicalCapabilities.dataset_version} onNavigate={navigate}/>:null)}
        {historicalRoute.matchId&&historicalCapabilities?.reconstruction_enabled&&historicalCapabilities.dataset_version&&<HistoricalMatchCentre key={`${historicalCapabilities.dataset_version}/${historicalRoute.matchId}`} matchId={historicalRoute.matchId} datasetVersion={historicalCapabilities.dataset_version} visible={route.mode==='reconstruction'&&!!route.matchId} tab={historicalRoute.tab} route={historicalRoute} onNavigate={navigate} allowComparison/>}
        {/* TP239: con un partido abierto, su cabecera ya lleva «Nuevo partido»: esta barra solo cuando no hay partido. */}
        {route.mode==='simulation'&&route.view==='centre'&&!active&&<div className="simulation-subnav"><p>{h.simulated}</p><button aria-current={page==='setup'?'page':undefined} onClick={()=>setPage('setup')}>{c.newMatch}</button><button disabled={!active} aria-current={page==='match'?'page':undefined} onClick={()=>setPage('match')}>{c.matchCentre}</button></div>}
        {route.mode==='simulation'&&route.view==='centre'&&!active&&!busy&&<div className="empty-state"><p>{h.chooseSaved}</p><button onClick={()=>navigate({mode:'library'})}>{h.library}</button></div>}
      </>}
      {route.mode==='demo'&&<DemoMatch visible autoplay={demoAutoplay} rendererLocked={demoAutoplay} focusReport={demoReport}
        onBack={()=>{if(demoReport){setDemoReport(false);navigate(HOME_ROUTE);return;}setLegacyPage('library');navigate({mode:'library'});}}/>}
      {active&&<div hidden={page!=='match'}>{active.engine==='touchlines'?<TouchLinesMatchView key={active.id} id={active.id} record={active.record} visible={page==='match'} tab={twoModes?simulationTab.current:undefined} onSectionChange={section=>{if(modesRef.current&&routeRef.current.mode==='simulation')navigate({...routeRef.current,tab:section});}} onBack={()=>setPage('setup')} autoplay/>:active.engine==='grf'?<GrfMatchView key={active.id} id={active.id} record={active.record} visible={page==='match'} tab={twoModes?simulationTab.current:undefined} onSectionChange={section=>{if(modesRef.current&&routeRef.current.mode==='simulation')navigate({...routeRef.current,tab:section});}} onBack={()=>setPage('setup')} autoplay/>:<MatchView key={active.id} id={active.id} record={active.record} visible={page==='match'} tab={twoModes?simulationTab.current:undefined} onSectionChange={section=>{if(modesRef.current&&routeRef.current.mode==='simulation')navigate({...routeRef.current,tab:section});}} onBack={()=>setPage('setup')} autoplay />}</div>}
      <section className="setup-view" hidden={page!=='setup'}>
      {/* TP240 («vuelve a la de ayer»): otra vez la portada con la ilustración y las cifras del catálogo. */}
      <section className="hero vs-hero">
        <figure className="vs-hero-banner"><img src={coverArt} alt={fictional() ? t.coverAltFictional : t.coverAlt} width={1672} height={941} /><figcaption className="art-caption">{t.coverNote}</figcaption></figure>
        <div className="hero-copy"><p className="eyebrow">{t.phase}</p><h1>{t.title}</h1><p className="intro">{t.intro}</p></div>
        {teams && <div className="catalog-numbers"><div><strong>{new Set(teams.map(team => team.season_start)).size}</strong><span>{t.seasons}</span></div><div><strong>{new Set(teams.map(team => team.club)).size}</strong><span>{t.clubs}</span></div><div><strong>{teams.length}</strong><span>{t.combinations}</span></div></div>}
      </section>
      {failed ? <div role="alert" className="panel-message">{t.loadError} <button onClick={() => setAttempt(attempt + 1)}>{t.retry}</button></div> : !teams ? <p role="status" className="panel-message">{t.loading}</p> : <>
        <VersusScreen teams={teams} home={home} away={away}
          // TP236 (24-oct: «el match no debería requerir dos clics»): «Jugar partido» simula directamente.
          onPlay={()=>{void start();}} playDisabled={!canStart}
          // TP253 (25-oct: «pa mi esto sobra, mejor al final una crónica»): sin píldora en la portada; la crónica IA va al final del partido.
          // TP237: a la vista, las dos elecciones que definen el partido: motor y modo gráfico.
          // TP248: las cuatro opciones (dos motores y dos gráficos) a la vista, no en «Opciones».
          playControls={<div className="vs-choices">
            <ChoiceGroup name="engine" title={v.engineTitle} value={engine} disabled={busy||capabilities===null} onChange={setEngine} options={[
              ...(engine==='timepitch'?[{value:'timepitch' as Engine,label:'TimePitch',hint:''}]:[]),
              {value:'grf',label:v.grfLabel,hint:v.grfHint,disabled:!capabilities?.find(c=>c.id==='grf')?.available},
              ...(capabilities?.find(c=>c.id==='touchlines')?.available?[{value:'touchlines' as Engine,label:v.touchlinesLabel,hint:v.touchlinesHint}]:[])]}/>
            <ChoiceGroup name="graphics" title={v.graphicsTitle} value={graphics} disabled={busy} onChange={setGraphics} options={[
              {value:'retro16-1',label:v.retroLabel,hint:v.retroHint},{value:'stylized-3d-1',label:v.threeLabel,hint:v.threeHint}]}/>
            {/* TP250: sin el desplegable de TP248 se perdía el aviso de por qué GRF no está disponible. */}
            {(()=>{const grf=capabilities?.find(c=>c.id==='grf');return !capabilities?<p className="small-note vs-engine-note" role="status">{g.checking}</p>
              :!grf?.available?<p className="small-note vs-engine-note" role="status">{grf?.reason?g[grf.reason as keyof typeof g] as string:g.unavailable}</p>:null;})()}</div>}
          playStatus={page==='setup'&&(busy||error)?<>{busy && <p className="panel-message start-status" role="status">{m.working} {status && m[status]}</p>}
            {error && <p className="panel-message start-status" role="alert">{error==='physicalUnavailable'?g.physicalUnavailable:m[error]}</p>}</>:undefined}
          moreDetails={<section className="advanced-options" id="prepare-match" aria-labelledby="prepare-match-h"><h2 id="prepare-match-h">{v.prepare}</h2>
            <p className="small-note">{v.prepareNote}</p>
            <section className="matchup-grid" aria-label={t.matchup}>
              <TeamPanel side="home" selection={home} grf={engine==='grf'}/><TeamPanel side="away" selection={away} grf={engine==='grf'}/>
            </section>
            <div className="seed-choice"><label className="fixed-seed"><input type="checkbox" checked={fixedSeed} disabled={busy} onChange={e => setFixedSeed(e.target.checked)} />{m.fixedSeed}</label><p className="small-note" id="seed-note">{fixedSeed ? m.fixedSeedNote : m.automaticSeedNote}</p>
            <label>{m.seed}<input type="number" min="0" max="4294967295" step="1" value={fixedSeed ? seed : ''} placeholder={m.automaticSeed} disabled={busy || !fixedSeed} aria-describedby="seed-note" onChange={e => setSeed(e.target.value)} /></label>
            </div></section>}/>
      </>}
      </section>
      {/* TP226/TP236: fuera de la preparación, el estado del partido en curso va aquí. */}
      {(busy||error)&&page!=='setup'&&<>{busy && <p className="panel-message" role="status">{m.working} {status && m[status]}</p>}
      {error && <p className="panel-message" role="alert">{error==='physicalUnavailable'?g.physicalUnavailable:m[error]}</p>}</>}
      {sessionFailed && page!=='demo' && <p role="alert">{m.sessionError}<button onClick={() => setSessionAttempt(v => v + 1)}>{m.retry}</button></p>}
      <section className="library-view" hidden={page!=='library'}><header className="page-heading"><h1>{c.library}</h1><p>{c.libraryNote}</p></header>
      {twoModes&&<div className="library-mode-sections"><button onClick={()=>navigate({mode:'reconstruction',seasonId:historicalRoute.seasonId,teamId:historicalRoute.teamId})}>{h.archive} →</button><h2>{h.mySimulations}</h2></div>}
      <DemoEntry onOpen={()=>{setDemoAutoplay(false);navigate({mode:'demo'});}}/>
      {!jobs.length&&!grfJobs.length&&<p className="empty-state">{c.noMatches}</p>}
      <section className="history"><div className="section-line"><h2>{m.history}</h2><label className="import-control">{m.import}<input type="file" accept="application/json,.json" disabled={!sessionReady || busy} onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></label></div><p className="small-note">{m.historyNote}</p><div className="history-list">{jobs.map(job => <button className="secondary" key={job.id} disabled={busy || job.state === 'failed'} onClick={() => { setError(null); setBusy(true); if(modesRef.current)setPage('match');setJobId({engine:'timepitch',id:job.id}); }}><MatchCrests homeKey={job.config.home_key} awayKey={job.config.away_key}/><span>{job.summary ? `${job.summary.home_name} — ${job.summary.away_name}` : `${job.config.home_key} — ${job.config.away_key}`}</span><small>TimePitch · {job.config.home_key.split(':').at(-1)} / {job.config.away_key.split(':').at(-1)} · {m[job.state]}{job.summary&&` · ${job.summary.metrics.home?.goals??'—'}–${job.summary.metrics.away?.goals??'—'}`}</small></button>)}</div></section>
      <GrfHistory jobs={grfJobs} busy={busy} onOpen={id=>{setError(null);setBusy(true);if(modesRef.current)setPage('match');setJobId({engine:'grf',id});}}/>
      </section>
    </main>
    <footer><span className="wordmark">TIME<span>PITCH</span></span><p>{t.footer}</p><p className="crest-credit">Copyright <a href="https://www.historicalkits.co.uk/" rel="noreferrer">Historical Football Kits</a> and reproduced by kind permission.</p></footer>
  </div>;
}
