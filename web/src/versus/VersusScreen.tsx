// TP213 · Pantalla principal VERSUS (23-oct: «la rivalidad vende»). Dos equipos-temporada del histórico
// de la Premier, su balance real, su estrella y el cara a cara real entre los clubes. Todo dato lleva su chip:
// Histórico (fuente), Estimado o Ficticio; nada se inventa ni se rellena con ceros.
// TP225 (23-oct: «la pantalla es muy larga y ¿dónde seleccionas los equipos?»): pantalla compacta que cabe
// en un escritorio sin desplazar; las tarjetas SON el selector y el catálogo se abre en una capa por lado.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PlayerSeason, Statistic, TeamSeason, TeamSummary } from '../api';
import { TeamCrest } from '../catalog/TeamCrest';
import { resolveKits } from '../catalog/kits';
import { linkFor, loadSquad, recordFor, type PlayerCardRecord } from '../catalog/player-registry';
import { appearanceFor } from '../catalog/appearance';
import { Portrait } from '../presentation/avatar/Portrait';
import { useLanguage } from '../i18n';
import { getHeadToHead, getTeamRecord, type HeadToHead, type MatchResult, type TeamSeasonRecord } from './api';
import { clubKey, clubsOf, EMPTY_FILTER, ERAS, filterTeams, matchupKind, QUICK_PICKS, type TeamFilter } from './matchup';
import { resultsSourceName, useVersusText, type VersusText } from './messages';
import { pickStar, starStats } from './star';
import '../presentation/tokens.css';
import './versus.css';

type Side = 'home' | 'away';
export type VersusSide = Readonly<{ key: string; setKey: (key: string) => void; team: TeamSeason | null; failed: boolean }>;

export type VersusScreenProps = Readonly<{
  teams: readonly TeamSummary[];
  home: VersusSide;
  away: VersusSide;
  onPlay: () => void;
  /** TP246: enlace en texto (no un segundo botón) a la crónica IA de ejemplo de la demo. */
  onOpenAiReport?: () => void;
  /** TP236: «Jugar partido» simula directamente; `App` pone al lado la elección de gráficos y el estado. */
  playDisabled?: boolean;
  playControls?: ReactNode;
  playStatus?: ReactNode;
  /** TP237: alineaciones y semilla, dentro del único plegable «Más detalles». */
  moreDetails?: ReactNode;
}>;

const PAGE = 36;

type Load<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed' };

function useLoad<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): Load<T> {
  const [result, setResult] = useState<{ key: string | null; value: Load<T> }>({ key: null, value: { state: 'loading' } });
  const loader = useRef(load); loader.current = load;
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    loader.current(controller.signal)
      .then(value => { if (!controller.signal.aborted) setResult({ key, value: { state: 'ready', value } }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, value: { state: 'failed' } }); });
    return () => controller.abort();
  }, [key]);
  return result.key === key ? result.value : { state: 'loading' };
}

const isHex = (c: string | undefined | null): c is string => !!c && /^#[0-9a-fA-F]{6}$/.test(c);
const seasonLabelOf = (key: string) => { const y = Number(key.split(':')[1]); return `${y}/${String(y + 1).slice(-2)}`; };

function Chip({ kind, children }: { kind: 'hist' | 'est' | 'sim' | 'ph'; children: string }) {
  return <span className={`chip ${kind}`}>{children}</span>;
}

// ---------- Estrella (mini ficha) ----------

/** TP225: la tarjeta enseña tres cifras (goles, asistencias, partidos); los minutos pasan a «Fuentes y procedencia». */
const CARD_STATS = new Set(['goals', 'assists', 'appearances']);

function StarBlock({ team, teamKey, t, side }: { team: TeamSeason; teamKey: string; t: VersusText; side: Side }) {
  const { locale } = useLanguage();
  const star = useMemo(() => pickStar(team), [team]);
  const squad = useLoad<readonly PlayerCardRecord[]>(teamKey, signal => loadSquad(teamKey, signal));
  if (!star) return <p className="vs-muted vs-star-missing">{t.starUnavailable}</p>;
  const p: PlayerSeason = star.player;
  const link = linkFor(p.key.split(':')[0], p.key);
  const record = squad.state === 'ready' ? recordFor(squad.value, link) : null;
  const look = appearanceFor(link?.qid ?? null, record);
  const kits = resolveKits(teamKey);
  const kit = p.role === 'GK' ? kits.keeper : kits.home;
  const number = record?.number ?? null;
  const nf = new Intl.NumberFormat(locale);
  const labels: Record<string, string> = { goals: t.goals, assists: star.assistsKey === 'assists_fpl' ? t.assistsFpl : t.assistsCard, appearances: t.appearances, minutes: t.minutes };
  const titleId = `vs-star-${side}`;
  return <section className="vs-star" aria-labelledby={titleId}>
    <div className="vs-star-art">
      <Portrait appearance={look.source === 'hand_assigned' ? look.params : null} appearanceSource={look.source}
        kit={kit} number={number} size="card" label={p.name} note={false} />
    </div>
    <div className="vs-star-body">
      <p className="vs-kicker"><span aria-hidden="true">★ </span>{t.star}</p>
      <h3 id={titleId} className="vs-star-name">{record?.display ?? p.name}</h3>
      <p className="vs-star-facts">
        <span>{t.number} <b>{number ?? '—'}</b></span>
        <span>{p.role ? t[p.role] : t.unknownRole}</span>
        {record?.nation && <span>{record.nation}</span>}
      </p>
      <dl className="vs-star-stats">
        {starStats(p, star.assistsKey).filter(s => CARD_STATS.has(s.id)).map(({ id, stat }) => <div key={id} data-stat={id}>
          <dt title={labels[id]}>{labels[id]}</dt>
          <dd><b>{stat?.value == null ? '—' : nf.format(stat.value)}</b>{stat?.status === 'estimated' && stat.value != null && <Chip kind="est">{t.estimated}</Chip>}</dd>
        </div>)}
      </dl>
    </div>
  </section>;
}

// ---------- Tarjeta de cada lado (también es el selector) ----------

function RecordLine({ record, t }: { record: Load<TeamSeasonRecord>; t: VersusText }) {
  const { locale } = useLanguage();
  if (record.state === 'loading') return <p className="vs-muted vs-record-status" role="status">{t.recordLoading}</p>;
  if (record.state === 'failed') return <p className="vs-muted vs-record-status">{t.recordFailed}</p>;
  const r = record.value, nf = new Intl.NumberFormat(locale);
  return <>
    <div className="vs-record-wrap"><dl className="vs-record">
      <div className="vs-record-pos"><dt>{t.position}</dt><dd>{t.ordinal(r.position, r.position_shared)}<small> {t.ofTeams(r.teams)}</small></dd></div>
      <div className="vs-record-pts"><dt>{t.points}</dt><dd>{nf.format(r.points)}{r.deduction && <small> {t.deductionShort(r.deduction.points)}</small>}</dd></div>
      <div className="vs-record-wdl"><dt>{t.record}</dt><dd>{`${r.wins}-${r.draws}-${r.losses}`}</dd></div>
      <div className="vs-record-goals"><dt>{t.goalsForAgainst}</dt><dd>{`${nf.format(r.goals_for)}-${nf.format(r.goals_against)}`}</dd></div>
    </dl></div>
    {r.deduction && <p className="vs-note vs-deduction"><Chip kind="hist">{t.historical}</Chip>
      <span>{t.deductionNote(r.deduction.points, r.raw_points, locale === 'es' ? r.deduction.reason_es : r.deduction.reason)}</span>
      <a className="vs-muted" href={r.deduction.source.url} target="_blank" rel="noreferrer" title={t.deductionSource}>
        {r.deduction.source.title} · rev. {r.deduction.source.revid} · {r.deduction.licence.split(' · ')[0]}</a></p>}
  </>;
}

function SideCard({ side, sel, summary, record, open, onChoose, t, buttonRef }: {
  side: Side; sel: VersusSide; summary: TeamSummary | undefined; record: Load<TeamSeasonRecord>; open: boolean; onChoose: () => void; t: VersusText;
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  const kits = resolveKits(sel.key);
  const kit = kits.home;
  const shirt = isHex(kit?.shirt) ? kit!.shirt : '#3a4150';
  const trim = isHex(kit?.trim) ? kit!.trim : '#c9ced6';
  const style = { '--vs-shirt': shirt, '--vs-trim': trim } as CSSProperties;
  const name = summary?.name ?? sel.team?.name ?? sel.key;
  const season = summary?.season_label ?? seasonLabelOf(sel.key);
  const sideName = side === 'home' ? t.home : t.away;
  const team = sel.team?.key === sel.key ? sel.team : null;
  // Toda la tarjeta abre el selector; enlaces, botones y el desplegable de fuentes conservan su propio clic.
  const cardClick = (event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as Element).closest('a, button, summary, details, input, select')) return;
    onChoose();
  };
  return <section className={`vs-side vs-side--${side}${open ? ' is-active' : ''}`} style={style}
    aria-label={`${sideName}: ${name} ${seasonLabelOf(sel.key)}`} onClick={cardClick}>
    <div className="vs-side-band" aria-hidden="true" />
    <header className="vs-side-head">
      <span className="vs-crest"><TeamCrest teamKey={sel.key} /></span>
      <div className="vs-side-id">
        <p className="vs-kicker">{sideName}</p>
        <h2 className="vs-team-name">{name}</h2>
        <p className="vs-season">{season}
          {kit && <span className="vs-swatches" aria-hidden="true">{[kit.shirt, kit.shorts, kit.socks].map((c, i) => <i key={i} style={{ background: c }} />)}</span>}</p>
      </div>
      <button type="button" ref={buttonRef} className="vs-change" aria-haspopup="dialog" aria-expanded={open} onClick={onChoose}>
        <span aria-hidden="true">⇄ </span>{sel.key ? t.changeTeam : t.chooseTeam}</button>
    </header>
    {/* TP240 («vuelve a la de ayer y límpiala»): balance y estrella siempre a la vista; sin etiquetas de
        procedencia ni desplegable de fuentes en la portada. */}
    <div className="vs-side-body">
      <div className="vs-side-record"><RecordLine record={record} t={t} /></div>
      {sel.failed ? <p className="vs-muted vs-star-missing">{t.starUnavailable}</p>
        : team ? <StarBlock team={team} teamKey={sel.key} t={t} side={side} />
          : <p className="vs-muted vs-star-missing" role="status">…</p>}
    </div>
  </section>;
}

// ---------- Selector (capa sobre la pantalla) ----------

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function TeamPicker({ teams, side, setSide, home, away, onClose, t }: {
  teams: readonly TeamSummary[]; side: Side; setSide: (s: Side) => void; home: VersusSide; away: VersusSide; onClose: () => void; t: VersusText;
}) {
  const [filter, setFilter] = useState<TeamFilter>(EMPTY_FILTER);
  const [shown, setShown] = useState(PAGE);
  const dialog = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => filterTeams(teams, filter), [teams, filter]);
  const clubs = useMemo(() => clubsOf(teams), [teams]);
  const years = useMemo(() => [...new Set(teams.map(x => x.season_start))].sort((x, y) => y - x), [teams]);
  const byKey = useMemo(() => new Map(teams.map(x => [x.key, x])), [teams]);
  const quick = QUICK_PICKS.map(k => byKey.get(k)).filter((x): x is TeamSummary => !!x);
  const current = side === 'home' ? home : away;
  const update = (patch: Partial<TeamFilter>) => { setFilter(f => ({ ...f, ...patch })); setShown(PAGE); };
  const choose = (key: string) => { current.setKey(key); onClose(); };
  const sideName = (s: Side) => (s === 'home' ? t.home : t.away);

  useEffect(() => {
    search.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  // Escape cierra; Tab y Mayús+Tab no salen de la capa.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab' || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  // Flechas dentro de la rejilla: izquierda/derecha de uno en uno, arriba/abajo por filas; Inicio/Fin.
  const onGridKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const grid = event.currentTarget;
    const options = [...grid.querySelectorAll<HTMLButtonElement>('.vs-option')];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    let next: number;
    if (event.key in step) next = Math.min(options.length - 1, Math.max(0, index + step[event.key]));
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    options[next].focus();
  };
  const option = (team: TeamSummary, quickPick = false) => <button type="button" key={team.key}
    className={`vs-option${quickPick ? ' vs-option--quick' : ''}`} aria-pressed={current.key === team.key}
    onClick={() => choose(team.key)}>
    <TeamCrest teamKey={team.key} compact /><span className="vs-option-name">{team.name}</span><small>{team.season_label}</small>
  </button>;

  return createPortal(<div className="vs-modal-root">
    <div className="vs-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} className={`vs-picker vs-picker--${side}`} id="vs-picker" role="dialog" aria-modal="true"
        aria-labelledby="vs-picker-h" aria-describedby="vs-picking" onKeyDown={onKeyDown}>
        <header className="vs-picker-head">
          <h2 id="vs-picker-h">{t.pick}</h2>
          <div className="vs-sides" role="group" aria-label={t.choosing}>
            {(['home', 'away'] as const).map(s => <button type="button" key={s} aria-pressed={side === s} onClick={() => setSide(s)}
              className={`vs-side-tab vs-side-tab--${s}`}>{sideName(s)} · <b>{byKey.get((s === 'home' ? home : away).key)?.name ?? '—'}</b> {seasonLabelOf((s === 'home' ? home : away).key)}</button>)}
          </div>
          <button type="button" className="vs-close" onClick={onClose} aria-label={t.close}><span aria-hidden="true">×</span></button>
        </header>
        <p className="vs-picking" id="vs-picking" aria-live="polite">{t.pickFor(sideName(side))}<span className="vs-muted"> · {t.pickKeys}</span></p>
        <div className="vs-filters">
          <label>{t.search}<input ref={search} type="search" value={filter.query} placeholder={t.searchPlaceholder}
            onChange={e => update({ query: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && filtered.length) { e.preventDefault(); choose(filtered[0].key); } }} /></label>
          <label>{t.club}<select value={filter.club} onChange={e => update({ club: e.target.value })}>
            <option value="">{t.allClubs}</option>{clubs.map(c => <option key={c.club} value={c.club}>{c.name}</option>)}</select></label>
          <label>{t.season}<select value={filter.season} onChange={e => update({ season: e.target.value })}>
            <option value="">{t.allSeasons}</option>{years.map(y => <option key={y} value={y}>{seasonLabelOf(`x:${y}`)}</option>)}</select></label>
        </div>
        <div className="vs-eras" role="group" aria-label={t.era}>
          {ERAS.map(e => <button type="button" key={e.id} aria-pressed={filter.era === e.id} onClick={() => update({ era: e.id })}>{t.eras[e.id]}</button>)}
        </div>
        <div className="vs-picker-scroll">
          {quick.length > 0 && <div className="vs-quick" role="group" aria-label={t.quick}>
            <p className="vs-kicker">{t.quick} <span className="vs-muted">· {t.quickNote}</span></p>
            <div className="vs-quick-row">{quick.map(team => option(team, true))}</div>
          </div>}
          <p className="vs-count" aria-live="polite">{filtered.length ? t.results(filtered.length, teams.length) : t.noResults}</p>
          <div className="vs-grid" onKeyDown={onGridKey}>{filtered.slice(0, shown).map(team => option(team))}</div>
          {filtered.length > shown && <button type="button" className="vs-more" onClick={() => setShown(n => n + PAGE)}>{t.more(filtered.length - shown)}</button>}
        </div>
      </div>
    </div>
  </div>, document.body);
}

// ---------- Pantalla ----------

/**
 * Primera visita (decisión TP225): el enfrentamiento de la demo, Arsenal 2003/04 contra Manchester City 2024/25, viene
 * preseleccionado (lo fija `App`); así la pantalla nunca abre vacía y cada tarjeta ya invita a «Cambiar equipo».
 */
export function VersusScreen({ teams, home, away, onPlay, onOpenAiReport, playDisabled, playControls, playStatus, moreDetails }: VersusScreenProps) {
  const t = useVersusText();
  const [picking, setPicking] = useState<Side | null>(null);
  const opener = useRef<Record<Side, HTMLButtonElement | null>>({ home: null, away: null });
  const lastSide = useRef<Side>('home');
  const byKey = useMemo(() => new Map(teams.map(x => [x.key, x])), [teams]);
  const homeRecord = useLoad<TeamSeasonRecord>(home.key, signal => getTeamRecord(home.key, signal));
  const awayRecord = useLoad<TeamSeasonRecord>(away.key, signal => getTeamRecord(away.key, signal));
  const open = (s: Side) => { lastSide.current = s; setPicking(s); };
  const close = useCallback(() => {
    setPicking(null);
    // Devuelve el foco al botón del lado que se estaba eligiendo.
    setTimeout(() => opener.current[lastSide.current]?.focus(), 0);
  }, []);
  const ready = !!home.key && !!away.key;
  // TP250 (juez aficionado: «revancha con los campos cambiados» y «partido al azar»): dos atajos junto al lanzamiento.
  const swap = () => { const h = home.key, a = away.key; home.setKey(a); away.setKey(h); };
  const random = () => {
    if (teams.length < 2) return;
    const first = teams[Math.floor(Math.random() * teams.length)];
    const rivals = teams.filter(x => clubKey(x.key) !== clubKey(first.key));
    const second = rivals[Math.floor(Math.random() * rivals.length)] ?? teams.find(x => x.key !== first.key)!;
    home.setKey(first.key); away.setKey(second.key);
  };
  return <section className="vs" aria-label={t.region}>
    <div className="vs-stage">
      <SideCard side="home" sel={home} summary={byKey.get(home.key)} record={homeRecord} open={picking === 'home'} onChoose={() => open('home')} t={t}
        buttonRef={el => { opener.current.home = el; }} />
      <div className="vs-badge" aria-hidden="true"><span>{t.vs}</span></div>
      <SideCard side="away" sel={away} summary={byKey.get(away.key)} record={awayRecord} open={picking === 'away'} onChoose={() => open('away')} t={t}
        buttonRef={el => { opener.current.away = el; }} />
    </div>
    {/* TP240 («quitar todo lo que sobre»): un solo botón; motor, gráficos, alineaciones y semilla, en «Opciones».
        Sin demo, rivalidad ni «Más detalles». */}
    <div className="vs-launch">
      <div className="vs-shortcuts">
        <button type="button" onClick={swap} disabled={!ready}><span aria-hidden="true">⇄</span> {t.swap}</button>
        <button type="button" onClick={random} disabled={teams.length < 2}><span aria-hidden="true">🎲</span> {t.random}</button>
      </div>
      {/* TP248: motor y gráficos a la vista, encima de «Jugar partido». */}
      {playControls}
      <button type="button" className="vs-cta" disabled={!ready || playDisabled} onClick={onPlay}>{t.play} <span aria-hidden="true">▸</span></button>
      {playStatus ?? (!ready && <p className="vs-muted">{t.playWaiting}</p>)}
      {/* TP250 («no se entiende para qué sirve»): dice qué abre y cuándo se escribe la crónica. */}
      {onOpenAiReport && <button type="button" className="vs-ai-link" onClick={onOpenAiReport}><span className="vs-ai-icon" aria-hidden="true">✦</span>
        <span className="vs-ai-text"><span>{t.aiReport} <span aria-hidden="true">→</span></span><small>{t.aiReportNote}</small></span></button>}
      {moreDetails && <details className="vs-options"><summary><span aria-hidden="true">⚙ </span>{t.options}</summary>{moreDetails}</details>}
    </div>
    {picking && <TeamPicker teams={teams} side={picking} setSide={open} home={home} away={away} onClose={close} t={t} />}
  </section>;
}
