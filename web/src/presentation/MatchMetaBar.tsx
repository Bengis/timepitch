// Cabecera de partido de Alineaciones (maqueta .local/mockup/v1-2d.html, `.match-meta` l.264–265 y l.821):
// escudo pequeño, marcador en display, datos del partido y chips de procedencia. Solo pinta lo que trae la
// fuente: sin fecha, estadio ni árbitro inventados. Los datos llegan ya resueltos (ver `matchMetaFromDescriptor`).
import { useState } from 'react';
import { defineTexts, isLocale, type Locale } from '../i18n-catalog';
import { useLanguage } from '../i18n';
import type { SessionDescriptor } from '../match-centre/session';
import type { CrestRef, MatchKits } from './types';
import './lineups.css';

export type MetaChip = Readonly<{ kind: 'hist' | 'est' | 'sim' | 'ph'; text: string }>;
export type MetaFact = Readonly<{ label?: string | null; value: string | null | undefined }>;
export type MetaTeam = Readonly<{ name: string; short?: string | null; crest?: CrestRef | null }>;

export type MatchMetaBarProps = Readonly<{
  home: MetaTeam; away: MetaTeam;
  /** Marcador hasta el cursor (o final si ya se reveló); sin él solo se muestran los nombres. */
  score?: Readonly<{ home: number; away: number }> | null;
  facts?: readonly MetaFact[];
  chips?: readonly MetaChip[];
}>;

const TEXT = defineTexts('match-meta', {
  en: { label: 'Match details', engine: 'Engine', seed: 'Seed', season: 'Season', lineups: (s: string) => `Lineups · ${s}`,
    simulated: 'Simulated', provisionalKits: 'Provisional colours, source pending', crest: (n: string) => `${n} crest` },
  es: { label: 'Datos del partido', engine: 'Motor', seed: 'Semilla', season: 'Temporada', lineups: (s: string) => `Alineaciones ${s}`,
    simulated: 'Simulado', provisionalKits: 'Colores provisionales, pendiente de fuente', crest: (n: string) => `Escudo ${n}` },
});
const pick = (locale: string): Locale => isLocale(locale) ? locale : 'en';

const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;

/** Datos y chips desde `descriptor.metadata`, solo con los campos que existen.
 *  Histórico (StatsBomb): fecha y hora de la fuente, temporada y chip hist. Grabación de motor: motor, semilla y chip sim.
 *  `fictional` (texto del shell) añade el chip ph de ficción; `kits.choice === 'estimated'`, el de colores provisionales. */
export function matchMetaFromDescriptor(d: Pick<SessionDescriptor, 'metadata'>, locale: string,
  opts: Readonly<{ fictional?: string | null; kits?: Pick<MatchKits, 'choice'> | null }> = {}): { facts: MetaFact[]; chips: MetaChip[] } {
  const t = TEXT(pick(locale));
  const m = d.metadata ?? {};
  const facts: MetaFact[] = [];
  const chips: MetaChip[] = [];
  if (m.synthetic === true) {
    const engine = text(m.engine), version = text(m.engineVersion);
    if (engine) facts.push({ label: t.engine, value: version && !engine.includes(version) ? `${engine} ${version}` : engine });
    const seed = text(m.seed);
    if (seed) facts.push({ label: t.seed, value: seed });
    chips.push({ kind: 'sim', text: engine ? `${t.simulated} · ${engine}` : t.simulated });
  } else {
    const date = text(m.date), kick = text(m.kickOff)?.match(/^\d{1,2}:\d{2}/)?.[0] ?? null;
    if (date) facts.push({ value: kick ? `${date} · ${kick}` : date });
    const season = text(m.season);
    if (season) facts.push({ label: t.season, value: season });
    const source = text(m.source);
    if (source) chips.push({ kind: 'hist', text: t.lineups(source) });
  }
  if (opts.fictional) chips.push({ kind: 'ph', text: opts.fictional });
  if (opts.kits?.choice === 'estimated') chips.push({ kind: 'ph', text: t.provisionalKits });
  return { facts, chips };
}

function SmallCrest({ crest, name, label }: { crest: CrestRef | null | undefined; name: string; label: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const ok = !!crest && crest.kind !== 'none' && !!crest.src && failed !== crest.src;
  return <span className={`tp-crest tp-crest--sm${ok ? '' : ' tp-crest--none'}`}>
    {ok ? <img src={crest!.src} alt={label} onError={() => setFailed(crest!.src)} />
      : <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
  </span>;
}

/** Barra de datos del partido sobre las alineaciones. */
export function MatchMetaBar({ home, away, score = null, facts = [], chips = [] }: MatchMetaBarProps) {
  const { locale } = useLanguage();
  const t = TEXT(pick(locale));
  const shown = facts.filter(f => text(f.value));
  const short = (team: MetaTeam) => team.short ?? team.name;
  return (
    <section className="tp-mm" aria-label={t.label}>
      <SmallCrest crest={home.crest} name={home.name} label={t.crest(home.name)} />
      <b className="tp-mm-score" title={`${home.name} – ${away.name}`}>
        {short(home)} {score ? <span className="tp-mm-num">{score.home} – {score.away}</span> : '–'} {short(away)}
      </b>
      {shown.map((f, i) => <span key={i} className="tp-mm-fact">{f.label ? <>{f.label} <b>{text(f.value)}</b></> : text(f.value)}</span>)}
      {chips.length > 0 && <span className="tp-mm-chips">{chips.map((c, i) => <span key={i} className={`chip ${c.kind}`}>{c.text}</span>)}</span>}
    </section>
  );
}
