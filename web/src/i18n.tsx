import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Locale = 'en' | 'es';
const en = {
  language: 'Language', local: 'LOCAL PREVIEW', phase: 'HISTORICAL MATCH SIMULATOR',
  title: 'Football, across eras.', intro: 'Pick any two Premier League teams since 1992/93 and watch them play each other.',
  coverAlt: 'TimePitch: artwork of Thierry Henry and Erling Haaland', coverNote: 'Generated artwork · not a photograph', matchup: 'Matchup', rosterSource: 'Squad source', resultsSource: 'Results source',
  seasons: 'complete seasons', clubs: 'clubs', combinations: 'team-seasons',
  home: 'Home team', away: 'Away team', search: 'Search club or season', searchPlaceholder: 'Arsenal, Manchester, 2003…',
  season: 'Season', allSeasons: 'All seasons', teamSeason: 'Team and season', choose: 'Choose a team…',
  outsideFilters: 'Your selected team is outside these filters.', noTeams: 'No teams match these filters.',
  options: 'matching team-seasons', source: 'Source', played: 'Played', goalsFor: 'Goals for', goalsAgainst: 'Goals against',
  participants: 'league participants', roster: 'Season squad', rosterNote: 'Players with recorded league appearances; this is not a starting XI from a particular match.',
  player: 'Player', position: 'Position', appearances: 'Apps', minutes: 'Minutes', goals: 'Goals', assists: 'Assists',
  assistsFantasy: 'Assists (FPL)', GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward', unknown: 'Unknown position',
  measured: 'Measured', estimated: 'Estimated', unavailable: 'Unavailable', partial: 'Partial',
  loading: 'Loading historical data…', loadError: 'Could not load the local catalogue.', retry: 'Try again',
  formation: 'Eligible formations', quality: 'Data notes', advanced: 'Advanced fields vary by source and season; inspect their coverage below. Missing values are never replaced with zero.',
  historical: 'Historical data', historicalNote: 'Source records and estimates are shown separately. Team results use the audited match-results source.',
  next: 'Next: bring the matchup to life', nextNote: 'The match engine and local AI commentary will follow in the next phases. This preview lets you explore the real catalogue.',
  footer: 'Independent local prototype · No official club endorsement', flags: 'Data requiring review',
  minutes_estimated: 'Minutes estimated from substitution records.', unknown_roles: 'Some players have no recorded position.',
  unknown_role: 'Position not recorded; not eligible for an automatic starting XI.',
  source_scores_disagree: 'Some source match scores disagree; use the audited results.',
  source_dates_disagree: 'Some match dates differ between sources.',
  goal_events_need_review: 'Some goal events need review before calibrating ratings.',
  assists_fpl_definition: 'Fantasy assists use the FPL definition and are kept separate.',
  minutes_snapshot_disagrees: 'Appearance minutes differ from the annual snapshot.',
  quarantined_rows: 'Conflicting source rows were quarantined.',
  xg_partial_2022: '2022/23 match-level xG starts at gameweek 16; earlier zeros are not measurements.',
  sound: 'Sound', soundMute: 'Mute match sound', soundUnmute: 'Turn match sound on',
} as const;

type Messages = { [K in keyof typeof en]: string };
const es: Messages = {
  language: 'Idioma', local: 'VISTA LOCAL', phase: 'SIMULADOR DE PARTIDOS HISTÓRICOS',
  title: 'Fútbol entre épocas.', intro: 'Elige dos equipos cualesquiera de la Premier League desde 1992/93 y míralos jugar entre ellos.',
  coverAlt: 'TimePitch: ilustración de Thierry Henry y Erling Haaland', coverNote: 'Ilustración generada · no es una fotografía', matchup: 'Enfrentamiento', rosterSource: 'Fuente de plantilla', resultsSource: 'Fuente de resultados',
  seasons: 'temporadas completas', clubs: 'clubes', combinations: 'equipos-temporada',
  home: 'Equipo local', away: 'Equipo visitante', search: 'Buscar club o temporada', searchPlaceholder: 'Arsenal, Manchester, 2003…',
  season: 'Temporada', allSeasons: 'Todas las temporadas', teamSeason: 'Equipo y temporada', choose: 'Elige un equipo…',
  outsideFilters: 'El equipo seleccionado queda fuera de estos filtros.', noTeams: 'Ningún equipo coincide con estos filtros.',
  options: 'equipos-temporada encontrados', source: 'Fuente', played: 'Partidos', goalsFor: 'Goles a favor', goalsAgainst: 'Goles en contra',
  participants: 'participantes en liga', roster: 'Plantilla de la temporada', rosterNote: 'Jugadores con participaciones registradas en liga; no es el once titular de un partido concreto.',
  player: 'Jugador', position: 'Posición', appearances: 'PJ', minutes: 'Minutos', goals: 'Goles', assists: 'Asistencias',
  assistsFantasy: 'Asistencias (FPL)', GK: 'Portero', DEF: 'Defensa', MID: 'Centrocampista', FWD: 'Delantero', unknown: 'Posición desconocida',
  measured: 'Medido', estimated: 'Estimado', unavailable: 'No disponible', partial: 'Parcial',
  loading: 'Cargando datos históricos…', loadError: 'No se ha podido cargar el catálogo local.', retry: 'Reintentar',
  formation: 'Formaciones posibles', quality: 'Notas sobre los datos', advanced: 'Los campos avanzados varían según la fuente y temporada; consulta su cobertura debajo. Los valores ausentes no se sustituyen por cero.',
  historical: 'Datos históricos', historicalNote: 'Los registros de las fuentes y las estimaciones se distinguen. Los resultados de los equipos proceden de los marcadores auditados.',
  next: 'Después: dar vida al enfrentamiento', nextNote: 'El motor de partidos y los comentarios de IA local llegarán en las siguientes fases. Esta vista permite explorar el catálogo real.',
  footer: 'Prototipo local independiente · Sin respaldo oficial de clubes', flags: 'Datos pendientes de revisión',
  minutes_estimated: 'Minutos estimados a partir de los cambios.', unknown_roles: 'Algunos jugadores no tienen posición registrada.',
  unknown_role: 'Posición sin registrar; no elegible para un once automático.',
  source_scores_disagree: 'Hay marcadores distintos entre fuentes; se usan los resultados auditados.',
  source_dates_disagree: 'Algunas fechas de partidos difieren entre fuentes.',
  goal_events_need_review: 'Hay eventos de gol que deben revisarse antes de calibrar atributos.',
  assists_fpl_definition: 'Las asistencias Fantasy usan la definición FPL y se mantienen separadas.',
  minutes_snapshot_disagrees: 'Los minutos por participación difieren del resumen anual.',
  quarantined_rows: 'Se apartaron filas contradictorias de la fuente.',
  xg_partial_2022: 'El xG por partido de 2022/23 empieza en la jornada 16; los ceros anteriores no son mediciones.',
  sound: 'Sonido', soundMute: 'Silenciar el sonido del partido', soundUnmute: 'Activar el sonido del partido',
};

type LanguageState = { locale: Locale; setLocale: (locale: Locale) => void; t: Messages };
const LanguageContext = createContext<LanguageState>({ locale: 'en', setLocale: () => {}, t: en });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    try { return localStorage.getItem('timepitch.locale') === 'es' ? 'es' : 'en'; } catch { return 'en'; }
  });
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === 'es' ? 'TimePitch — Fútbol entre épocas' : 'TimePitch — Football across eras';
    try { localStorage.setItem('timepitch.locale', locale); } catch { /* Private browser storage can be unavailable. */ }
  }, [locale]);
  return <LanguageContext.Provider value={{ locale, setLocale, t: locale === 'es' ? es : en }}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);

/** Vista local: solo cuando la página se sirve desde el propio equipo (TP211); en la demo pública no se rotula. */
export function isLocalPreview(hostname: string = typeof window === 'undefined' ? '' : window.location.hostname) {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.localhost');
}

/* Banderas en SVG propio (Windows no pinta los emoji de bandera). Decorativas: el nombre accesible va en el botón. */
const FLAGS: Record<Locale, ReactNode> = {
  en: <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <clipPath id="tp-flag-uk"><path d="M30 15h30v15zv15H0zH0V0zV0h30z" /></clipPath>
    <path d="M0 0v30h60V0z" fill="#012169" />
    <path d="M0 0l60 30m0-30L0 30" stroke="#fff" strokeWidth="6" />
    <path d="M0 0l60 30m0-30L0 30" clipPath="url(#tp-flag-uk)" stroke="#C8102E" strokeWidth="4" />
    <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10" />
    <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6" />
  </svg>,
  es: <svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <path d="M0 0h30v20H0z" fill="#AA151B" /><path d="M0 5h30v10H0z" fill="#F1BF00" />
  </svg>,
};
const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', es: 'Español' };

/** Selector de idioma compacto (TP211): dos banderas pulsables, con nombre accesible «Language: English». */
export function LanguageSelector() {
  const { locale, setLocale, t } = useLanguage();
  return <div className="language-control language-flags" role="group" aria-label={t.language}>
    {(['en', 'es'] as const).map(value => <button key={value} type="button" className="language-flag" lang={value}
      aria-pressed={locale === value} aria-label={`${t.language}: ${LANGUAGE_NAMES[value]}`} title={LANGUAGE_NAMES[value]}
      onClick={() => setLocale(value)}>{FLAGS[value]}</button>)}
  </div>;
}

export function useFlagText() {
  const { t } = useLanguage();
  return (flag: string) => flag in t ? t[flag as keyof Messages] : t.flags;
}
