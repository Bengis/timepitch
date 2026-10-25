// Marcador de emisión (maqueta aprobada, scoreboard()): tira de equipación, abreviatura, escudo, marcador,
// reloj, parte y rojas. En `compact` (móvil) solo abreviaturas; el nombre completo queda para lector de pantalla.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePrefersReducedMotion } from './AnnouncementBanner';
import { usePresentationText } from './messages';
import type { CrestRef, KitSpec, MatchKits } from './types';
import './tokens.css';
import './broadcast.css';

/** Abreviaturas de emisión cuyo prefijo de tres letras sería ambiguo o engañoso. */
const ABBR: Readonly<Record<string, string>> = {
  'manchester united': 'MUN', 'manchester city': 'MCI', 'west ham united': 'WHU', 'west bromwich albion': 'WBA',
  'aston villa': 'AVL', 'crystal palace': 'CRY', 'sheffield united': 'SHU', 'sheffield wednesday': 'SHW',
  'queens park rangers': 'QPR', 'brighton & hove albion': 'BHA', 'brighton and hove albion': 'BHA',
  'nottingham forest': 'NFO', 'wolverhampton wanderers': 'WOL', 'newcastle united': 'NEW', 'leicester city': 'LEI',
  'tottenham hotspur': 'TOT', 'afc bournemouth': 'BOU',
};

export function teamAbbreviation(name: string): string {
  // «Manchester City 2024/25» → «manchester city»: la temporada no forma parte del nombre del club.
  const key = name.trim().toLowerCase().replace(/\s+\d{4}\/\d{2,4}$/, '');
  if (ABBR[key]) return ABBR[key];
  const first = key.split(/\s+/).find(w => /[a-z]/.test(w)) ?? key;
  return first.replace(/[^a-z]/g, '').slice(0, 3).toUpperCase() || '—';
}

/** Camisetas casi blancas: el degradado del club usaría un blanco cegador; la maqueta usa un blanco tenue. */
const isLight = (hex: string) => {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return false;
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.85;
};

export type ScorebugTeam = { name: string; abbr?: string };

export type BroadcastScorebugProps = {
  home: ScorebugTeam; away: ScorebugTeam;
  /** `null` cuando la fuente no da marcador (p. ej. ventana histórica parcial): se muestran guiones. */
  score: { home: number; away: number } | null;
  clock: string;
  /** Rótulo visible del reloj (p. ej. «Reloj del partido») para distinguirlo del tiempo de reproducción (TP205). */
  clockLabel?: string;
  period: number | null;
  finished?: boolean;
  reds: { home: number; away: number };
  crests: { home: CrestRef; away: CrestRef };
  kits?: MatchKits | null;
  compact?: boolean;
};

function Crest({ crest, label }: { crest: CrestRef; label: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const ok = crest.kind !== 'none' && crest.src && failed !== crest.src;
  return <span className={`tp-sb-crest${ok ? '' : ' tp-sb-crest--none'}`} title={ok ? undefined : label}>
    {ok ? <img src={crest.src} alt="" onError={() => setFailed(crest.src)} /> : <span aria-hidden="true">◇</span>}
  </span>;
}

function KitStrip({ kit }: { kit: KitSpec | undefined }) {
  if (!kit) return null;
  return <span className="tp-sb-kitstrip" aria-hidden="true">
    <i style={{ background: kit.shirt }} /><i style={{ background: kit.trim }} /><i style={{ background: kit.shorts }} /><i style={{ background: kit.socks }} />
  </span>;
}

export function BroadcastScorebug({ home, away, score, clock, clockLabel, period, finished = false, reds, crests, kits, compact = false }: BroadcastScorebugProps) {
  const t = usePresentationText();
  const still = usePrefersReducedMotion();
  const [flash, setFlash] = useState<{ home: number; away: number }>({ home: 0, away: 0 });
  const last = useRef(score);
  useEffect(() => {
    const prev = last.current; last.current = score;
    if (!prev || !score) return;
    if (score.home !== prev.home || score.away !== prev.away) {
      setFlash(f => ({ home: score.home !== prev.home ? f.home + 1 : f.home, away: score.away !== prev.away ? f.away + 1 : f.away }));
    }
  }, [score]);
  const label = score ? `${home.name} ${score.home}, ${away.name} ${score.away}` : `${home.name} – ${away.name}, ${t.unknownScore}`;
  const phase = finished ? t.fullTime : period ? t.half(period) : null;
  const team = (side: 'home' | 'away', info: ScorebugTeam) => {
    const n = reds[side];
    const name = <span className="tp-sb-name">
      <span className="tp-sb-abbr" aria-hidden={compact ? undefined : true}>{info.abbr ?? teamAbbreviation(info.name)}</span>
      {compact ? <span className="tp-sr">{info.name}</span> : <span className="tp-sb-full">{info.name}</span>}
      {n > 0 && <span className="tp-sb-reds" aria-label={t.reds(n)} role="img">{Array.from({ length: n }, (_, i) => <i key={i} />)}</span>}
    </span>;
    const crest = <Crest crest={crests[side]} label={t.noCrest} />;
    const shirt = kits?.[side].shirt;
    const light = !!shirt && isLight(shirt);
    const tint = shirt && !light ? { '--club': shirt } as CSSProperties : undefined;
    return <div className={`tp-sb-team tp-sb-team--${side}${light ? ' tp-sb-team--light' : ''}`} style={tint}>
      <KitStrip kit={kits?.[side]} />
      {side === 'home' ? <>{name}{crest}</> : <>{crest}{name}</>}
    </div>;
  };
  const digit = (side: 'home' | 'away') => <span key={`${side}-${flash[side]}`} className={!still && flash[side] ? 'tp-sb-flash' : undefined}>
    {score ? score[side] : '—'}
  </span>;
  return <div className={`tp-scorebug${compact ? ' tp-sb--compact' : ''}`} role="group" aria-label={`${t.scoreboard}: ${label}`}>
    {team('home', home)}
    <div className="tp-sb-score" aria-hidden="true"><div className="tp-sb-digits num">{digit('home')}<em>–</em>{digit('away')}</div></div>
    {team('away', away)}
    <div className="tp-sb-clock">
      {!finished && <span className={`tp-sb-livedot${still ? '' : ' tp-sb-livedot--pulse'}`} title={t.live} />}
      {clockLabel && <span className="tp-sb-clabel">{clockLabel}</span>}
      <span className="tp-sb-t num">{clock}</span>
      {phase && <span className="tp-sb-half">{phase}</span>}
      {kits?.choice === 'estimated' && <span className="chip est" title={t.estimatedKitsNote}>{t.estimatedKits}</span>}
    </div>
  </div>;
}
