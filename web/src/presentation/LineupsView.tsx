// G13 · Alineaciones: once en un mini campo según la formación de la fuente, lista de titulares y banquillo,
// con marcas de gol, tarjeta y cambio solo cuando la fuente las trae (`Announcement[]` ya filtrado por fuente).
// Porta `lineupTeam` de la maqueta objetivo (.local/mockup/v1-2d.html, l.781–818): camisetas con dorsal en el campo
// y lista «dorsal · nombre · POS · país». El país solo aparece si la ficha lo trae; nunca se inventa.
import { useId, useState } from 'react';
import { useLanguage } from '../i18n';
import type { Announcement, AnnouncementKind } from '../match-centre/announcements/announcements';
import type { PlayerView } from '../match-centre/session';
import { NEUTRAL_KIT } from './avatar/portrait-svg';
import { MatchMetaBar, type MatchMetaBarProps } from './MatchMetaBar';
import { usePresentationText } from './messages';
import type { CastEntry, CrestRef, KitSpec, MatchCast } from './types';
import './lineups.css';

const TEXT = {
  en: { formation: 'Formation', formationOf: (team: string | undefined, f: string) => team ? `${team} formation ${f}` : `Formation ${f}`,
    noFormation: 'Formation not in source', starters: 'Starting XI', bench: 'Substitutes', none: 'None in source',
    home: 'Home', away: 'Away', crest: (team: string) => `${team} crest` },
  es: { formation: 'Formación', formationOf: (team: string | undefined, f: string) => team ? `${team} formación ${f}` : `Formación ${f}`,
    noFormation: 'Formación no disponible en la fuente', starters: 'Once inicial', bench: 'Suplentes', none: 'Sin datos en la fuente',
    home: 'Local', away: 'Visitante', crest: (team: string) => `Escudo ${team}` },
} as const;

/** Profundidad (0 portero … 5 delantero) y lado (-1 izquierda … 1 derecha) de un puesto StatsBomb o de motor. */
function slot(role: string | null): { depth: number; lateral: number } {
  if (!role) return { depth: 3, lateral: 0 };
  const engine: Record<string, number> = { GK: 0, DEF: 1, MID: 3, FWD: 5 };
  if (role in engine) return { depth: engine[role], lateral: 0 };
  const depth = /Goalkeeper/.test(role) ? 0 : /Wing Back/.test(role) ? 1.4 : /Back/.test(role) ? 1
    : /Defensive Midfield/.test(role) ? 2 : /Attacking Midfield/.test(role) ? 4 : /Midfield/.test(role) ? 3
      : /Wing/.test(role) ? 4 : /Forward|Striker/.test(role) ? 5 : 3;
  const lateral = /^Right Center/.test(role) ? 0.4 : /^Left Center/.test(role) ? -0.4 : /^Right/.test(role) ? 1 : /^Left/.test(role) ? -1 : 0;
  return { depth, lateral };
}

const ABBR: Readonly<Record<string, string>> = { Goalkeeper: 'GK', Striker: 'ST', 'Secondary Striker': 'SS' };
const abbreviation = (role: string | null) => !role ? null : ABBR[role] ?? (/\s/.test(role) ? role.split(/\s+/).map(w => w[0]).join('') : role);

type Position = { position?: unknown; from_period?: unknown; from?: unknown };
/** Posición inicial de la fuente: `role` (adaptador) o la de 00:00 de la 1.ª parte en `finalDetails.positions`. */
function startRole(p: PlayerView): string | null {
  if (p.role.value) return p.role.value;
  const positions = p.finalDetails?.positions;
  const first = Array.isArray(positions) ? (positions as Position[]).find(x => x.from_period === 1 && x.from === '00:00') : undefined;
  return typeof first?.position === 'string' ? first.position : null;
}
/** Titular solo con evidencia de la fuente: intervalo desde 0, puesto inicial o puesto de motor (todos en el campo). */
export function isStarter(p: PlayerView): boolean {
  return (p.intervals.value ?? []).some(i => i.fromMs === 0) || startRole(p) !== null;
}

/** `'4-2-3-1'` → `[4,2,3,1]`; `null` si no hay formación o sus líneas no suman 10 jugadores de campo. */
export function formationLines(formation: string | null | undefined): number[] | null {
  if (!formation) return null;
  const digits = formation.replace(/[\s-]/g, '');
  if (!/^[1-6]{2,5}$/.test(digits)) return null;
  const lines = [...digits].map(Number);
  return lines.reduce((a, b) => a + b, 0) === 10 ? lines : null;
}

export type PlacedPlayer = Readonly<{ player: PlayerView; line: number; x: number; y: number }>;
/** Coloca 11 titulares: portero en la línea 0 y el resto por profundidad en las líneas de la formación,
 *  ordenado de izquierda a derecha dentro de cada línea. `x`/`y` en % del campo (propia portería abajo). */
export function placeStarters(starters: readonly PlayerView[], lines: readonly number[]): PlacedPlayer[] | null {
  if (starters.length !== 11 || lines.reduce((a, b) => a + b, 0) !== 10) return null;
  const ranked = starters.map((player, i) => ({ player, i, ...slot(startRole(player)) }))
    .sort((a, b) => a.depth - b.depth || a.i - b.i);
  const [keeper, ...outfield] = ranked;
  const placed: PlacedPlayer[] = [{ player: keeper.player, line: 0, x: 50, y: 90 }];
  let from = 0;
  lines.forEach((count, l) => {
    const row = outfield.slice(from, from + count).sort((a, b) => a.lateral - b.lateral || a.i - b.i);
    from += count;
    const spacing = Math.min(24, 84 / count);
    const y = lines.length === 1 ? 50 : 72 - l * (60 / (lines.length - 1));
    row.forEach((r, k) => placed.push({ player: r.player, line: l + 1, x: 50 + (k - (count - 1) / 2) * spacing, y }));
  });
  return placed;
}

type Mark = { key: string; kind: AnnouncementKind; minute: string; label: string; off?: boolean };
const MARKED: ReadonlySet<AnnouncementKind> = new Set(['goal', 'own_goal', 'yellow', 'second_yellow', 'red', 'substitution']);

export type LineupsViewProps = Readonly<{
  side: 'home' | 'away';
  /** Formación de la fuente (`SessionTeam.formation`); sin ella solo se muestran las listas. */
  formation: string | null | undefined;
  /** Jugadores del partido (ambos equipos); se filtran por `side`. */
  players: readonly PlayerView[];
  cast: MatchCast | null;
  /** Anuncios hasta el cursor; solo se marcan los que la fuente produce (`SOURCE_KINDS`). */
  announcements: readonly Announcement[];
  onSelect: (playerId: string) => void;
  teamName?: string;
  /** Escudo resuelto (HD → HFK); sin él, inicial del equipo. */
  crest?: CrestRef | null;
}>;

/** Icono de camiseta de la maqueta (`shirtIcon`) con el dorsal; colores de la equipación del partido. */
function Shirt({ kit, number, shade }: { kit: KitSpec; number: string | null; shade: string }) {
  const body = 'M-16 -12l8-5h16l8 5 6 11-7 4-3-4v20h-24v-20l-3 4-7-4z';
  return (
    <svg className="tp-lu-shirticon" viewBox="-24 -20 48 42" aria-hidden="true">
      <ellipse cx="0" cy="17" rx="15" ry="3.5" fill="#000" opacity=".35" />
      <path d={body} fill={kit.shirt} stroke="rgba(0,0,0,.45)" strokeWidth="1.1" />
      <path d="M-6 -17q6 6 12 0" fill="none" stroke={kit.trim} strokeWidth="2" />
      <path d={body} fill={`url(#${shade})`} />
      <text x="0" y="7" fill={kit.number} textAnchor="middle" className="tp-lu-shirtno">{number ?? '—'}</text>
    </svg>
  );
}

function TeamCrest({ crest, name, label }: { crest: CrestRef | null | undefined; name: string; label: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const ok = !!crest && crest.kind !== 'none' && !!crest.src && failed !== crest.src;
  return <span className={`tp-crest${ok ? '' : ' tp-crest--none'}`}>
    {ok ? <img src={crest!.src} alt={label} onError={() => setFailed(crest!.src)} />
      : <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
  </span>;
}

/** Alineación de un equipo (G13): mini campo con la formación, once inicial y suplentes. */
export function LineupsView({ side, formation, players, cast, announcements, onSelect, teamName, crest }: LineupsViewProps) {
  const { locale } = useLanguage();
  const t = TEXT[locale === 'es' ? 'es' : 'en'];
  const pt = usePresentationText();
  const ids = useId();
  const shade = `tp-lu-shade-${ids.replace(/[^\w-]/g, '')}`;
  const own = players.filter(p => p.side === side);
  const starters = own.filter(isStarter);
  const bench = own.filter(p => !isStarter(p));
  const lines = formationLines(formation);
  const placed = lines ? placeStarters(starters, lines) : null;
  const kits = cast?.kits ?? null;
  const outfieldKit: KitSpec = kits ? (side === 'home' ? kits.home : kits.away) : NEUTRAL_KIT;
  const keeperKit: KitSpec = kits ? (side === 'home' ? kits.homeKeeper : kits.awayKeeper) : NEUTRAL_KIT;

  const marksOf = (id: string): Mark[] => announcements.flatMap((a): Mark[] => {
    if (!MARKED.has(a.kind)) return [];
    if (a.kind === 'substitution') {
      const dir = a.primaryPlayerId === id ? pt.on : a.secondaryPlayerId === id ? pt.off : null;
      return dir ? [{ key: a.id, kind: a.kind, minute: a.minuteLabel, label: `${pt.titles.substitution} · ${dir} ${a.minuteLabel}`,
        off: dir === pt.off }] : [];
    }
    return a.primaryPlayerId === id ? [{ key: a.id, kind: a.kind, minute: a.minuteLabel, label: `${pt.titles[a.kind]} ${a.minuteLabel}` }] : [];
  });

  const surname = (full: string) => full.trim().split(/\s+/).at(-1) ?? full;
  const ident = (p: PlayerView) => {
    const entry: CastEntry | undefined = cast?.players.get(p.id);
    return { number: entry?.number ?? p.jersey.value ?? null, name: entry?.displayName ?? p.name ?? '—',
      nation: entry?.record?.nation ?? null };
  };
  const markIcons = (marks: Mark[], withMinute: boolean) => marks.map(m => (
    <span key={m.key} className={`tp-lu-mark tp-lu-mark--${m.kind}${m.off ? ' tp-lu-mark--off' : ''}`}
      role="img" aria-label={m.label} title={m.label}>{withMinute && <span aria-hidden="true">{m.minute}</span>}</span>
  ));

  const row = (p: PlayerView, starter: boolean) => {
    const { number, name, nation } = ident(p);
    const pos = starter ? abbreviation(startRole(p)) : null;
    const sub = [pos, nation].filter(Boolean).join(' · ');
    return (
      <li key={p.id}>
        <button type="button" className="tp-lu-row" onClick={() => onSelect(p.id)}>
          <span className="tp-lu-n">{number ?? '—'}</span>{' '}
          <span className="tp-lu-who"><span className="tp-lu-name">{name}</span>{sub && <>{' '}<span className="tp-lu-pos">{sub}</span></>}</span>
          <span className="tp-lu-ev">{markIcons(marksOf(p.id), true)}</span>
        </button>
      </li>
    );
  };

  const list = (label: string, items: readonly PlayerView[], starter: boolean, key: string) => (
    <>
      <h5 id={`${ids}-${key}`}>{label}</h5>
      {items.length ? <ul aria-labelledby={`${ids}-${key}`}>{items.map(p => row(p, starter))}</ul>
        : <p className="tp-lu-empty">{t.none}</p>}
    </>
  );

  return (
    <section className={`tp-lu-team${placed ? '' : ' tp-lu-team--list'}`} data-side={side} aria-label={teamName}>
      <header className="tp-lu-head">
        <TeamCrest crest={crest} name={teamName ?? '?'} label={t.crest(teamName ?? '')} />
        <div className="tp-lu-title">{teamName && <h3>{teamName}</h3>}<div className="tp-lu-sub">{side === 'home' ? t.home : t.away}</div></div>
        <div className="tp-lu-form"><small>{t.formation}</small>{lines ? formation : '—'}</div>
        <span className="tp-lu-kitstrip" aria-hidden="true">
          {(['shirt', 'trim', 'shorts', 'socks'] as const).map(k => <i key={k} style={{ background: outfieldKit[k] }} />)}
        </span>
      </header>
      {placed ? (
        <div className="tp-lu-pitch" role="group" aria-label={t.formationOf(teamName, formation!)}>
          <svg className="tp-lu-lines" viewBox="0 0 320 400" aria-hidden="true" preserveAspectRatio="none">
            <defs><linearGradient id={shade} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#000" stopOpacity=".22" />
              <stop offset=".35" stopColor="#000" stopOpacity="0" /><stop offset=".7" stopColor="#fff" stopOpacity=".10" />
              <stop offset="1" stopColor="#000" stopOpacity=".18" /></linearGradient></defs>
            <g fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5">
              <rect x="12" y="12" width="296" height="376" rx="2" /><path d="M12 200H308" /><circle cx="160" cy="200" r="38" />
              <rect x="90" y="328" width="140" height="60" /><rect x="130" y="366" width="60" height="22" /><path d="M134 328a34 34 0 0 1 52 0" />
              <rect x="90" y="12" width="140" height="60" /><rect x="130" y="12" width="60" height="22" />
            </g>
          </svg>
          {placed.map(({ player: p, line, x, y }) => {
            const { number, name } = ident(p);
            const kit = line === 0 ? keeperKit : outfieldKit;
            return (
              <button key={p.id} type="button" className="tp-lu-spot" data-line={line} style={{ left: `${x}%`, top: `${y}%` }}
                data-shirt={kit.shirt} data-number={number ?? '—'} onClick={() => onSelect(p.id)}>
                <Shirt kit={kit} number={number} shade={shade} />
                <span className="tp-lu-flags">{markIcons(marksOf(p.id), false)}</span>
                {/* Como la maqueta, en el campo solo el apellido (no se pisan); el nombre completo queda para lectores. */}
                <span className="tp-lu-label" aria-hidden="true" title={name}>{surname(name)}</span><span className="sr-only">{name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="tp-lu-note">{t.noFormation}</p>
      )}
      <div className="tp-lu-list">
        {list(t.starters, placed ? placed.map(x => x.player) : starters, true, 'xi')}
        {list(t.bench, bench, false, 'bench')}
      </div>
    </section>
  );
}

/** Cabecera de partido opcional y las dos alineaciones lado a lado (una columna por debajo de 900 px). */
export function LineupsPair({ home, away, meta }: Readonly<{ home: LineupsViewProps; away: LineupsViewProps; meta?: MatchMetaBarProps }>) {
  return (
    <div className="tp-lu-wrap">
      {meta && <MatchMetaBar {...meta} />}
      <div className="tp-lu-pair"><LineupsView {...home} /><LineupsView {...away} /></div>
    </div>
  );
}
