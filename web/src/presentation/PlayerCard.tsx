// G12 · Ficha de jugador (maqueta aprobada, `playerCard()` de .local/mockup/v1-2d.html).
// Dos variantes: `drawer` (cajón con ×, modos histórico y GRF) e `inline` (pantalla «Ficha de jugador», héroe 420 px | cuerpo).
// Identidad desde la ficha pública (QID → Wikidata/Wikipedia); sin ficha, solo los datos de la fila de la fuente.
// Cada cifra lleva su procedencia: Histórico (fuente), Estimado o Simulado. Nada se rellena ni se inventa.
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { defineTexts, intlTag } from '../i18n-catalog';
import type { PlayerSeason, Statistic } from '../api';
import { TeamCrest } from '../catalog/TeamCrest';
import { fictional } from '../catalog/fictional';
import type { PlayerCardRecord } from '../catalog/player-registry';
import { useLanguage } from '../i18n';
import type { MetricView, PlayerView, ViewProvenance } from '../match-centre/session';
import { metricLabel } from '../match/statistics/messages';
import { Portrait } from './avatar/Portrait';
import type { AssetSource, CastEntry, KitSpec, PlayerRecord } from './types';
import './tokens.css';
import './player-card.css';

type Chip = 'hist' | 'est' | 'sim';
/** Habilidad visual de Capitán Hane (TP234) con su fuente; solo la pasa el centro en ese modo. */
export type PlayerCardAbility = Readonly<{ title: string; name: string; source: string; chip: Chip; note: string }>;
type PositionCode = 'GK' | 'DF' | 'MF' | 'FW';

const TEXT = defineTexts('player-card', {
  en: {
    dialog: 'Player card', close: 'Close', facts: 'Player facts', number: 'Number', position: 'Position',
    nation: { sport: 'Nationality (national team)', citizenship: 'Nationality (citizenship)', manual: 'Nationality (corrected by hand)' },
    citizenship: 'Citizenship (Wikidata)', born: 'Born', height: 'Height',
    age: (age: number, year: number) => `${age} on 1 Aug ${year}`,
    positions: { GK: 'Goalkeeper', DF: 'Defender', MF: 'Midfielder', FW: 'Forward' } as Record<PositionCode, string>,
    badges: { GK: 'GK', DF: 'DF', MF: 'MF', FW: 'FW' } as Record<PositionCode, string>,
    noRecord: 'No player card for this player: showing source data only.',
    match: 'This match', noMatch: 'No match statistics available.',
    season: (label: string) => `Season ${label} · Premier League`, appearances: 'Appearances', starts: 'Starts',
    minutes: 'Minutes', goals: 'Goals', assists: 'Assists', assistsFpl: 'Assists (Fantasy)', source: 'Source',
    attributes: 'Attributes', attributesNote: 'Model estimates, not measured ratings.',
    sources: 'Sources', chips: { hist: 'Historical', est: 'Estimated', sim: 'Simulated' } as Record<Chip, string>,
    sourcesFictional: 'Fictional league: invented name. Number, position and season statistics come from public records; see the licences page.',
    fields: { display: 'Name', number: 'Number', position: 'Position', nation: 'Nationality', citizenship: 'Citizenship', dob: 'Date of birth', heightCm: 'Height' } as Record<string, string>,
    rev: 'rev', back: 'Back to broadcast',
    appearance: { generic: 'Appearance pending', hand_assigned: 'Unsourced features · assigned by hand' },
    movement: 'Movement in the reconstruction', distance: 'Distance', hsr: 'High intensity (> 5.5 m/s)',
    onPitch: 'Minutes on pitch', topSpeed: 'Top speed', sprints: 'Sprints',
    notRecorded: (names: readonly ('topSpeed' | 'sprints')[]) =>
      `${names.map(n => (n === 'topSpeed' ? 'top speed' : 'sprints')).join(' and ').replace(/^./, c => c.toUpperCase())}: not available in this recording.`,
    noMovement: 'Movement not available in this recording.',
    movementNote: 'Derived from the synthetic movement the engine records: not real tracking and not comparable with measured physical data.',
  },
  es: {
    dialog: 'Ficha de jugador', close: 'Cerrar', facts: 'Datos del jugador', number: 'Dorsal', position: 'Posición',
    nation: { sport: 'Nacionalidad (selección)', citizenship: 'Nacionalidad (ciudadanía)', manual: 'Nacionalidad (corregida a mano)' },
    citizenship: 'Ciudadanía (Wikidata)', born: 'Nacimiento', height: 'Altura',
    age: (age: number, year: number) => `${age} años el 1 ago ${year}`,
    positions: { GK: 'Portero', DF: 'Defensa', MF: 'Centrocampista', FW: 'Delantero' } as Record<PositionCode, string>,
    badges: { GK: 'POR', DF: 'DEF', MF: 'MED', FW: 'DEL' } as Record<PositionCode, string>,
    noRecord: 'Sin ficha para este jugador: solo datos de la fuente.',
    match: 'Este partido', noMatch: 'No hay estadísticas de partido.',
    season: (label: string) => `Temporada ${label} · Premier League`, appearances: 'Partidos', starts: 'Titular',
    minutes: 'Minutos', goals: 'Goles', assists: 'Asistencias', assistsFpl: 'Asistencias (Fantasy)', source: 'Fuente',
    attributes: 'Atributos', attributesNote: 'Estimaciones del modelo, no valoraciones medidas.',
    sources: 'Fuentes', chips: { hist: 'Histórico', est: 'Estimado', sim: 'Simulado' } as Record<Chip, string>,
    sourcesFictional: 'Liga ficticia: nombre inventado. Dorsal, posición y estadísticas de temporada salen de registros públicos; ver la página de licencias.',
    fields: { display: 'Nombre', number: 'Dorsal', position: 'Posición', nation: 'Nacionalidad', citizenship: 'Ciudadanía', dob: 'Fecha de nacimiento', heightCm: 'Altura' } as Record<string, string>,
    rev: 'rev', back: 'Volver a la emisión',
    appearance: { generic: 'Apariencia pendiente', hand_assigned: 'Rasgos sin fuente · asignados a mano' },
    movement: 'Movimiento en la reconstrucción', distance: 'Distancia', hsr: 'Alta intensidad (> 5,5 m/s)',
    onPitch: 'Minutos en el campo', topSpeed: 'V. máx.', sprints: 'Sprints',
    notRecorded: (names: readonly ('topSpeed' | 'sprints')[]) =>
      `${names.map(n => (n === 'topSpeed' ? 'velocidad máxima' : 'sprints')).join(' y ').replace(/^./, c => c.toUpperCase())}: ${names.length > 1 ? 'no disponibles' : 'no disponible'} en esta grabación.`,
    noMovement: 'Movimiento no disponible en esta grabación.',
    movementNote: 'Derivado del movimiento sintético que graba el motor: no es tracking real ni comparable con datos físicos medidos.',
  },
});
type Text = ReturnType<typeof TEXT>;

/** Movimiento del jugador en la grabación (análisis grabado, hasta el cursor). `null` en un campo = el motor no lo graba. */
export type PlayerMovement = Readonly<{
  distanceM: number | null;
  hsrM?: number | null;
  seconds?: number | null;
  topSpeedMps?: number | null;
  sprints?: number | null;
}>;

export type PlayerCardProps = Readonly<{
  player: PlayerView;
  entry: CastEntry | null;
  kit: KitSpec | null;
  /** Temporada del equipo del jugador, p. ej. «2003/04» (la edad se calcula al 1 de agosto de su año inicial). */
  seasonLabel: string;
  teamKey?: string | null;
  teamName?: string | null;
  /** Estadísticas de temporada del catálogo (fila enlazada por G16); su `status` decide el chip. */
  season?: PlayerSeason | null;
  /** Rótulo del partido, p. ej. «Simulación ficticia entre épocas». */
  matchLabel?: string | null;
  /** `drawer` (por defecto): cajón con × y Escape. `inline`: pantalla de ficha; con `onClose`, botón «Volver a la emisión». */
  variant?: 'drawer' | 'inline';
  /** Selector de jugadores (p. ej. `<PlayerPicker>`), arriba del cuerpo. */
  picker?: ReactNode;
  /** Movimiento simulado de la grabación. `undefined` = sin bloque; `null` = bloque con aviso de no disponible. */
  movement?: PlayerMovement | null;
  /** Capitán Hane (TP234): habilidad visual con «Fuente: <stat> = <valor> (<procedencia>)». */
  ability?: PlayerCardAbility | null;
  onClose?: () => void;
}>;

/** Edad cumplida el 1 de agosto del año inicial de la temporada; `null` si falta la fecha o la temporada. */
export function ageOnFirstAugust(dob: string | null, seasonLabel: string): number | null {
  const birth = dob ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob) : null;
  const season = /^(\d{4})/.exec(seasonLabel);
  if (!birth || !season) return null;
  const year = Number(season[1]);
  const [y, m, d] = [Number(birth[1]), Number(birth[2]), Number(birth[3])];
  return year - y - (m > 8 || (m === 8 && d > 1) ? 1 : 0);
}

const isHex = (c: string | undefined): c is string => !!c && /^#[0-9a-fA-F]{6}$/.test(c);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function positionCode(value: string | null | undefined): PositionCode | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (/^(gk|goalkeeper)$|goalkeeper/.test(v)) return 'GK';
  if (/^(df|def)$|back|defender/.test(v)) return 'DF';
  if (/^(mf|mid)$|midfield/.test(v)) return 'MF';
  if (/^(fw|fwd)$|forward|striker|wing/.test(v)) return 'FW';
  return null;
}

export function chipFor(provenance: ViewProvenance | Statistic['status']): Chip | null {
  switch (provenance) {
    case 'source_recorded': case 'derived_from_events': case 'measured': case 'partial': return 'hist';
    case 'estimated': return 'est';
    case 'simulated': case 'synthetic_motion': case 'native_observed': return 'sim';
    default: return null;
  }
}

function sourceText(source: AssetSource, t: Text): string {
  const parts = source.kind === 'wikipedia'
    ? [source.title, source.revid != null ? `${t.rev} ${source.revid}` : null]
    : source.kind === 'wikidata'
      ? [`Wikidata ${source.qid ?? ''}`.trim(), source.revision != null ? `${t.rev} ${source.revision}` : null]
      : [source.title ?? source.kind];
  return [...parts, source.licence].filter(Boolean).join(' · ') + (source.note ? ` (${source.note})` : '');
}

function Chips({ kinds, t }: { kinds: readonly Chip[]; t: Text }) {
  const unique = (['hist', 'est', 'sim'] as const).filter(k => kinds.includes(k));
  return <span className="tp-pc-chips">{unique.map(k => <span key={k} className={`chip ${k}`}>{t.chips[k]}</span>)}</span>;
}

function Block({ id, title, chips, t, children }: { id: string; title: ReactNode; chips: readonly Chip[]; t: Text; children: ReactNode }) {
  return <section className="tp-pc-blk" aria-labelledby={id}>
    <div className="tp-pc-blk-h"><h3 id={id}>{title}</h3><Chips kinds={chips} t={t} /></div>
    {children}
  </section>;
}

type Cell = { key: string; label: string; value: string; chip: Chip | null; small?: string };

function StatGrid({ cells, className }: { cells: readonly Cell[]; className?: string }) {
  return <div className={className ? `tp-pc-statgrid ${className}` : 'tp-pc-statgrid'}>{cells.map(c =>
    <div key={c.key} data-provenance={c.chip ?? 'none'}>
      <div className="k">{c.label}</div><div className="v">{c.value}{c.small && <small>{c.small}</small>}</div>
    </div>)}</div>;
}

export function PlayerCard({ player, entry, kit, seasonLabel, teamKey, teamName, season, matchLabel, variant = 'drawer', picker, movement, ability, onClose }: PlayerCardProps) {
  const { locale } = useLanguage();
  const t = TEXT(locale);
  const inline = variant === 'inline';
  const close = useRef<HTMLButtonElement>(null);
  const idBase = `tp-pc-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  useEffect(() => {
    if (inline) return;
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [inline]);

  const record: PlayerRecord | null = entry?.record ?? null;
  const card = record && 'nationBasis' in record ? record as PlayerCardRecord : null;
  const name = entry?.displayName ?? record?.display ?? player.name ?? player.id;
  const words = name.trim().split(/\s+/);
  const last = words.length > 1 ? words[words.length - 1] : name;
  const first = words.length > 1 ? words.slice(0, -1).join(' ') : '';
  const number = entry?.number ?? record?.number ?? player.jersey.value ?? null;
  const rawPosition = record?.position ?? player.role.value ?? null;
  const code = positionCode(rawPosition);
  const positionText = record?.position && code ? t.positions[code] : rawPosition;
  const nf = new Intl.NumberFormat(locale);
  const seasonYear = /^(\d{4})/.exec(seasonLabel)?.[1];

  const shirt = isHex(kit?.shirt) ? kit!.shirt : '#3a4150';
  const trim = isHex(kit?.trim) ? kit!.trim : '#c9ced6';
  const heroStyle = {
    '--tp-pc-shirt': shirt, '--tp-pc-trim': trim,
    '--tp-pc-bignum': luminance(shirt) > 0.6 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.08)',
  } as CSSProperties;

  const facts: { k: string; v: string }[] = [];
  if (record) {
    if (record.nation) {
      const basis = card?.nationBasis ?? 'sport';
      facts.push({ k: t.nation[basis], v: record.nation });
    }
    if (card && card.citizenship.length > 0) facts.push({ k: t.citizenship, v: card.citizenship.join(' / ') });
    if (record.dob) {
      const date = new Intl.DateTimeFormat(intlTag(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${record.dob}T00:00:00Z`)).replace('.', '');
      const age = ageOnFirstAugust(record.dob, seasonLabel);
      facts.push({ k: t.born, v: age != null && seasonYear ? `${date} · ${t.age(age, Number(seasonYear))}` : date });
    }
    if (record.heightCm != null) facts.push({ k: t.height, v: `${nf.format(record.heightCm)} cm` });
  }

  const shownMetrics = player.metrics.filter(m => m.value != null && m.availability.status !== 'unavailable' && chipFor(m.provenance));
  // Las métricas `historical:*` son totales de temporada del catálogo (minutos, titularidades…), no de este partido:
  // van al bloque de temporada con su nombre traducido, nunca bajo «Este partido».
  const isCatalog = (m: MetricView) => m.id.startsWith('historical:');
  const matchMetrics = shownMetrics.filter(m => !isCatalog(m)), catalogMetrics = shownMetrics.filter(isCatalog);
  const metricCell = (m: MetricView): Cell => ({
    key: m.id, label: metricLabel(m.id, locale), value: nf.format(m.value!), chip: chipFor(m.provenance),
    small: m.unit && m.unit !== 'count' ? m.unit : undefined,
  });
  const attributes = player.estimatedAttributes.filter(m => m.value != null);

  const fantasy = !!season?.stats.assists_fpl && !season.stats.assists;
  const seasonCells: Cell[] = season ? ([
    ['appearances', t.appearances], ['starts', t.starts], ['minutes', t.minutes], ['goals', t.goals],
    [fantasy ? 'assists_fpl' : 'assists', fantasy ? t.assistsFpl : t.assists],
  ] as const).flatMap(([id, label]) => {
    const stat = season.stats[id] ?? (id === 'starts' ? season.advanced_stats?.starts : undefined);
    if (!stat || stat.value == null || stat.status === 'unavailable') return [];
    return [{ key: id, label, value: nf.format(stat.value), chip: chipFor(stat.status) }];
  }) : [];
  const catalogNames: Record<string, string> = { appearances: t.appearances, starts: t.starts, minutes: t.minutes, goals: t.goals, assists: t.assists, assists_fpl: t.assistsFpl };
  if (!seasonCells.length) for (const m of catalogMetrics) {
    const id = m.id.slice('historical:'.length);
    seasonCells.push({ ...metricCell(m), label: catalogNames[id] ?? metricLabel(id, locale) });
  }
  const seasonSources = season ? [...new Set(Object.values(season.stats).map(s => s.source).filter(Boolean))] : [];

  const fieldEntries = record ? Object.entries(record.fields) : [];
  const appearanceSource = entry?.appearance && entry.appearanceSource === 'hand_assigned' ? 'hand_assigned' : 'generic';

  const movementCells: Cell[] = [];
  const notRecorded: ('topSpeed' | 'sprints')[] = [];
  if (movement) {
    const one = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    if (movement.distanceM != null) movementCells.push({ key: 'distance', label: t.distance, value: one.format(movement.distanceM / 1000), chip: 'sim', small: 'km' });
    if (movement.hsrM != null) movementCells.push({ key: 'hsr', label: t.hsr, value: nf.format(Math.round(movement.hsrM)), chip: 'sim', small: 'm' });
    if (movement.seconds != null) movementCells.push({ key: 'seconds', label: t.onPitch, value: nf.format(Math.floor(movement.seconds / 60)), chip: 'sim' });
    if (movement.topSpeedMps != null) movementCells.push({ key: 'top', label: t.topSpeed, value: one.format(movement.topSpeedMps * 3.6), chip: 'sim', small: 'km/h' });
    else notRecorded.push('topSpeed');
    if (movement.sprints != null) movementCells.push({ key: 'sprints', label: t.sprints, value: nf.format(movement.sprints), chip: 'sim' });
    else notRecorded.push('sprints');
  }
  const movementBlock = movement !== undefined && <Block id={`${idBase}-move`} t={t} chips={['sim']} title={t.movement}>
    {movementCells.length > 0
      ? <><StatGrid cells={movementCells} className="tp-pc-statgrid--sim" />
        {notRecorded.length > 0 && <p className="tp-pc-src">{t.notRecorded(notRecorded)}</p>}
        <p className="tp-pc-note">{t.movementNote}</p></>
      : <p className="tp-pc-missing">{t.noMovement}</p>}
  </Block>;
  const attributesBlock = attributes.length > 0 && <Block id={`${idBase}-attrs`} t={t} chips={['est']} title={t.attributes}>
    {attributes.map(a => {
      const pct = Math.max(0, Math.min(100, a.value!));
      return <div className="tp-pc-attr" key={a.id}><span>{metricLabel(a.id, locale)}</span>
        <span className="b" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span><span className="val">{nf.format(a.value!)}</span></div>;
    })}
    <p className="tp-pc-src">{t.attributesNote}</p>
  </Block>;

  return <article className={`tp-pc tp-pc--${variant}`} role={inline ? 'region' : 'dialog'} aria-modal={inline ? undefined : false}
    aria-label={`${t.dialog}: ${name}`}
    onKeyDown={inline || !onClose ? undefined : e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    {!inline && onClose && <button ref={close} type="button" className="tp-pc-close" aria-label={t.close} onClick={onClose}>×</button>}
    {inline && onClose && <button type="button" className="tp-pc-back" onClick={onClose}><span aria-hidden="true">← </span>{t.back}</button>}
    <div className="tp-pc-layout">
    <header className="tp-pc-hero" style={heroStyle}>
      <div className="tp-pc-stripes" aria-hidden="true" />
      <div className="tp-pc-bignum" aria-hidden="true">{number ?? ''}</div>
      <div className="tp-pc-crest">
        {teamKey && <TeamCrest teamKey={teamKey} />}
        <div><small>{[teamName, seasonLabel].filter(Boolean).join(' · ')}</small></div>
      </div>
      <div className="tp-pc-avnote"><span className="chip ph">{t.appearance[appearanceSource]}</span></div>
      <div className="tp-pc-avatar">
        <Portrait appearance={entry?.appearance ?? null} appearanceSource={entry?.appearanceSource ?? 'generic'}
          kit={kit} number={number} size="card" label={name} note={false} />
      </div>
      <div className="tp-pc-nameplate">
        <h2><span className="tp-pc-np-top">{code && <span className="tp-pc-posbadge" aria-hidden="true">{t.badges[code]}</span>}
          {first && <span className="tp-pc-first">{first}</span>}</span>{first && ' '}<span className="tp-pc-last">{last}</span></h2>
        <div className="tp-pc-meta">
          <span>{t.number} <b>{number ?? '—'}</b></span>
          {positionText && <span>{t.position} <b>{positionText}</b></span>}
          {record?.nation && <span>{t.fields.nation} <b>{record.nation}</b></span>}
        </div>
      </div>
    </header>

    <div className="tp-pc-body">
      {picker}
      {record
        ? <ul className="tp-pc-facts" aria-label={t.facts}>
          {facts.map(f => <li key={f.k}><span className="k">{f.k}</span><b>{f.v}</b></li>)}
        </ul>
        : <p className="tp-pc-missing">{t.noRecord}</p>}

      {matchMetrics.length > 0
        ? <Block id={`${idBase}-match`} t={t} chips={matchMetrics.map(m => chipFor(m.provenance)!)}
          title={<>{t.match}{matchLabel && <span className="tp-pc-sub"> · {matchLabel}</span>}</>}>
          <StatGrid cells={matchMetrics.map(metricCell)} />
        </Block>
        : <p className="tp-pc-missing">{t.noMatch}</p>}

      {seasonCells.length > 0 && <Block id={`${idBase}-season`} t={t} chips={seasonCells.map(c => c.chip!).filter(Boolean)} title={t.season(seasonLabel)}>
        <StatGrid cells={seasonCells} />
        {seasonSources.length > 0 && <p className="tp-pc-src">{t.source}: {seasonSources.join(', ')}</p>}
      </Block>}

      {ability && <Block id={`${idBase}-ability`} t={t} chips={[ability.chip]} title={ability.title}>
        <p className="tp-pc-ability" data-anime-ability><b>{ability.name}</b></p>
        <p className="tp-pc-src">{ability.source}</p>
        <p className="tp-pc-note">{ability.note}</p>
      </Block>}

      {(attributesBlock || movementBlock) && <div className="tp-pc-pair">{attributesBlock}{movementBlock}</div>}

      {fieldEntries.length > 0 && <section className="tp-pc-blk tp-pc-sources" aria-labelledby={`${idBase}-src`}>
        <div className="tp-pc-blk-h"><h3 id={`${idBase}-src`}>{t.sources}</h3></div>
        {/* TP259: en la liga ficticia las fuentes por ficha (artículo de la temporada, QID) delatarían al jugador real. */}
        {fictional() ? <p>{t.sourcesFictional}</p> : <ul>{fieldEntries.map(([field, source]) =>
          <li key={field}><span className="k">{t.fields[field] ?? field}</span> {sourceText(source, t)}</li>)}</ul>}
      </section>}
    </div>
    </div>
  </article>;
}
