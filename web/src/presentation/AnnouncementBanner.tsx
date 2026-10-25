// Rótulo de anuncios de emisión (maqueta aprobada, bannerHTML). Nombre y dorsal se resuelven aquí desde
// MatchCast; si el jugador no tiene entrada, nombre de la fuente y «—»: nunca el dorsal de otro.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Announcement, AnnouncementKind } from '../match-centre/announcements/announcements';
import type { MatchSource, PlayerView } from '../match-centre/session';
import { usePresentationText } from './messages';
import type { CrestRef, MatchCast, MatchKits } from './types';
import './tokens.css';
import './broadcast.css';

const REDUCE = '(prefers-reduced-motion: reduce)';
const reduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCE).matches;

/** `true` si el sistema pide reducir el movimiento; se actualiza si cambia la preferencia. */
export function usePrefersReducedMotion(): boolean {
  const [value, setValue] = useState(reduced);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(REDUCE);
    const on = () => setValue(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return value;
}

/** Ancho a partir del cual el rótulo deja de ir sobre el campo y pasa debajo (maqueta v1-2d, @container 600 px). */
export const BANNER_BELOW_QUERY = '(max-width: 600px)';
export type BannerPlacement = 'overlay' | 'below';

/** `below` en teléfonos (≤600 px): el rótulo taparía medio campo; `overlay` en el resto. El shell decide dónde montarlo. */
export function useBannerPlacement(): BannerPlacement {
  const narrow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(BANNER_BELOW_QUERY).matches;
  const [below, setBelow] = useState(narrow);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(BANNER_BELOW_QUERY);
    const on = () => setBelow(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return below ? 'below' : 'overlay';
}

type Accent = { acc: string; ink: string; icon: 'goal' | 'own_goal' | 'save' | 'yellow' | 'red' | 'sub' | null };
const ACCENT: Readonly<Record<AnnouncementKind, Accent>> = {
  goal: { acc: '#f5c518', ink: '#111', icon: 'goal' }, own_goal: { acc: '#f5c518', ink: '#111', icon: 'own_goal' },
  penalty: { acc: '#c2410c', ink: '#fff', icon: null }, shot_saved: { acc: '#1b6d6a', ink: '#fff', icon: 'save' },
  shot_blocked: { acc: '#2a2f3a', ink: '#fff', icon: null }, shot_off_target: { acc: '#2a2f3a', ink: '#fff', icon: null },
  yellow: { acc: '#2a2f3a', ink: '#fff', icon: 'yellow' }, second_yellow: { acc: '#b3122a', ink: '#fff', icon: 'red' },
  red: { acc: '#b3122a', ink: '#fff', icon: 'red' }, substitution: { acc: '#253656', ink: '#fff', icon: 'sub' },
  foul: { acc: '#1c2740', ink: '#fff', icon: null }, offside: { acc: '#1c2740', ink: '#fff', icon: null },
  corner: { acc: '#1c2740', ink: '#fff', icon: null }, half_time: { acc: '#1c2740', ink: '#fff', icon: null },
  full_time: { acc: '#1c2740', ink: '#fff', icon: null }, kick_off: { acc: '#1c2740', ink: '#fff', icon: null },
};

function Icon({ kind }: { kind: Accent['icon'] }) {
  if (!kind) return null;
  const card = (fill: string) => <rect x="6.5" y="3" width="11" height="16" rx="1.8" fill={fill} transform="rotate(8 12 11)" />;
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {kind === 'goal' || kind === 'own_goal' ? <>
      <circle cx="12" cy="12" r="9.5" fill={kind === 'goal' ? '#fff' : '#ff5a6e'} stroke="#111" strokeWidth="1.2" />
      <path d="M12 7.2l3.3 2.4-1.3 3.9h-4l-1.3-3.9z" fill="#111" /></>
      : kind === 'yellow' ? card('#ffd21f') : kind === 'red' ? card('#ff3348')
      : kind === 'sub' ? <g fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 20V6M4 10l4-4 4 4" stroke="#3ee08f" /><path d="M16 4v14M12 14l4 4 4-4" stroke="#ff5a6e" /></g>
      : <path d="M6 13V7a1.5 1.5 0 013 0v4M9 11V5a1.5 1.5 0 013 0v6M12 11V6a1.5 1.5 0 013 0v6M15 12V9a1.5 1.5 0 013 0v5c0 4-3 7-7 7h-1c-2.5 0-4-1.2-5.4-3.2L3.4 14"
        fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>;
}

/** Color de la base del escudo: la camiseta del equipo, salvo que sea casi blanca (no se vería). */
const crestBase = (shirt: string | undefined) => !shirt || /^#f[0-9a-f]f[0-9a-f]f[0-9a-f]$/i.test(shirt) ? '#121212' : shirt;

export type AnnouncementBannerProps = {
  current: Announcement | null;
  source: MatchSource;
  cast: MatchCast | null;
  /** Nombres de la fuente para los jugadores sin entrada en `cast`. */
  players?: readonly PlayerView[];
  homeName: string; awayName: string;
  crests: { home: CrestRef; away: CrestRef };
  kits?: MatchKits | null;
  /** Motor de una partida grabada (`metadata.engine`), p. ej. «TouchLines»: se añade al chip «Simulado». */
  engineLabel?: string | null;
  /** `overlay` (por defecto): sobre la parte baja del campo. `below`: en flujo, debajo del campo (móvil). */
  placement?: BannerPlacement;
};

export function AnnouncementBanner({ current, source, cast, players = [], homeName, awayName, crests, kits, engineLabel = null, placement = 'overlay' }: AnnouncementBannerProps) {
  const t = usePresentationText();
  const still = usePrefersReducedMotion();
  const scoring = current?.kind === 'goal' || current?.kind === 'own_goal';
  return <div className={`tp-banner tp-banner--${placement}`} role="status" aria-live={scoring ? 'assertive' : 'polite'} aria-atomic="true">
    {current && <BannerCard key={current.id} a={current} source={source} cast={cast} players={players}
      names={{ home: homeName, away: awayName }} crests={crests} kits={kits ?? cast?.kits ?? null} animate={!still} t={t} engineLabel={engineLabel} />}
  </div>;
}

type CardProps = {
  a: Announcement; source: MatchSource; cast: MatchCast | null; players: readonly PlayerView[];
  names: { home: string; away: string }; crests: { home: CrestRef; away: CrestRef }; kits: MatchKits | null;
  animate: boolean; t: ReturnType<typeof usePresentationText>; engineLabel: string | null;
};

function BannerCard({ a, source, cast, players, names, crests, kits, animate, t, engineLabel }: CardProps) {
  const who = (id: string | null | undefined) => {
    if (!id) return null;
    const e = cast?.players.get(id);
    return { number: e?.number ?? '—', name: e?.displayName ?? players.find(p => p.id === id)?.name ?? '—' };
  };
  const style = ACCENT[a.kind];
  const team = a.side ? names[a.side] : null;
  const score = a.scoreAfter ? `${a.scoreAfter.home}–${a.scoreAfter.away}` : null;
  const kicker = a.kind === 'own_goal' ? [team, t.ownGoal, score]
    : a.kind === 'shot_saved' && team ? [t.shotBy(team), t.saved]
    : team ? [team, a.kind === 'goal' ? score : null] : [`${names.home} – ${names.away}`];
  const primary = who(a.primaryPlayerId), secondary = who(a.secondaryPlayerId);
  const shirt = (p: { number: string; name: string }) => <><span className="tp-bn-shirtno">{p.number}</span> <span>{p.name}</span></>;
  let sub: ReactNode = primary ? shirt(primary) : null;
  if (a.kind === 'substitution' && primary) sub = <>
    <span className="tp-bn-on"><span aria-hidden="true">▲</span> <span className="tp-sr">{t.on}: </span>{shirt(primary)}</span>
    {secondary && <span className="tp-bn-off"><span aria-hidden="true">▼</span> <span className="tp-sr">{t.off}: </span>{shirt(secondary)}</span>}</>;
  const crest = a.side ? crests[a.side] : null;
  const base = a.side ? crestBase(kits?.[a.side].shirt) : '#121212';
  const chips = source === 'historical'
    ? [<span key="h" className="chip hist">{t.historicalEvent}</span>, <span key="s" className="chip sim">{t.syntheticAnimation}</span>]
    // Partida simulada: el acontecimiento lo produjo el motor; se nombra el motor cuando se conoce, nunca «histórico».
    : [<span key="s" className="chip sim">{[t.engineEvent, t.simulated, source === 'grf' ? 'GRF' : engineLabel].filter(Boolean).join(' · ')}</span>];
  const vars = {
    '--acc': style.acc, '--acc-ink': style.ink, '--bn-dur': `${a.durationMs}ms`,
    '--goal-line': a.kind === 'goal' || a.kind === 'own_goal' ? 'var(--tp-goal)' : 'transparent',
  } as CSSProperties;
  return <div className={`tp-bn-wrap${animate ? ' tp-bn-wrap--animate' : ''}`} style={vars}>
    <div className="tp-bn-foot">{chips}</div>
    <div className={`tp-bn tp-bn--${a.kind}${animate ? ' tp-bn--animate' : ''}`}>
      <div className="tp-bn-crest" style={{ boxShadow: `inset 0 -6px 0 ${base}` }} aria-hidden="true">
        {crest && crest.kind !== 'none' && crest.src ? <img src={crest.src} alt="" /> : null}
      </div>
      <div className="tp-bn-body">
        <div className="tp-bn-kicker">{kicker.filter(Boolean).join(' · ')}</div>
        <div className="tp-bn-title"><Icon kind={style.icon} /><span>{t.titles[a.kind]}</span></div>
        {sub && <div className="tp-bn-sub">{sub}</div>}
      </div>
      <div className="tp-bn-min"><span className="tp-sr">{t.minute} </span><b className="num">{a.minuteLabel}</b></div>
    </div>
  </div>;
}
