// TP259: liga ficticia. El catálogo, los motores y las grabaciones conservan los nombres reales (forman parte de cada
// hash); la web muestra nombres inventados en los puntos donde entran los datos (API del catálogo, adaptadores de
// partido, fichas). Mismo fichero y misma regla que backend/src/timepitch/fictional (la crónica en vivo nombra lo
// mismo que se ve). El modo se lee una vez al arrancar: cambiarlo guarda la preferencia y recarga la página.
import league from './fictional-league.json';

export type NamesMode = 'fictional' | 'real';
const KEY = 'timepitch.names';
const SEASON = /\s+(\d{4}\/\d{2,4})$/;

function readMode(): NamesMode {
  try { return globalThis.localStorage?.getItem(KEY) === 'real' ? 'real' : 'fictional'; } catch { return 'fictional'; }
}

let mode: NamesMode = readMode();
export const namesMode = (): NamesMode => mode;
export const fictional = (): boolean => mode === 'fictional';

/** Guarda la preferencia y recarga: todas las pantallas cambian a la vez y la crónica pide su propio informe. */
export function setNamesMode(next: NamesMode, reload = true): void {
  try { globalThis.localStorage?.setItem(KEY, next); } catch { /* sin almacenamiento: solo esta sesión */ }
  mode = next;
  if (reload) globalThis.location?.reload();
}

const normal = (name: string) => name.normalize('NFC').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');

export function fnv1a(text: string): number {
  let value = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  return value;
}

type Club = { name: string; abbr: string };
const clubs = league.clubs as Record<string, Club>;
const byFictional = new Map(Object.values(clubs).map(c => [c.name.toLowerCase(), c.abbr]));
const FIRST = new Set(league.first_names), LAST = new Set(league.surnames);

/** «Arsenal 2003/04» → «North London Reds 2003/04». Un club desconocido conserva su nombre. */
export function fictionalClub(real: string): string {
  const season = SEASON.exec(real);
  const base = season ? real.slice(0, season.index) : real;
  const club = clubs[normal(base)];
  return club ? club.name + (season ? ' ' + season[1] : '') : real;
}

/** Idempotente: un nombre que ya es de la liga se queda igual, así da igual por cuántas capas pase. */
export function fictionalPlayer(real: string): string {
  const key = normal(real);
  if (!key) return real;
  const parts = real.trim().split(/\s+/);
  if (parts.length === 2 && FIRST.has(parts[0]) && LAST.has(parts[1])) return real;
  const first = league.first_names, last = league.surnames;
  return `${first[fnv1a(key + '|f') % first.length]} ${last[fnv1a(key + '|s') % last.length]}`;
}

/** Abreviatura de un club ficticio (sin temporada); null si el nombre no es de la liga ficticia. */
export function fictionalAbbr(name: string): string | null {
  return byFictional.get(normal(name.replace(SEASON, ''))) ?? null;
}

/** Nombre que se muestra según el modo activo. */
export const showClub = (real: string): string => (fictional() ? fictionalClub(real) : real);
export const showPlayer = (real: string): string => (fictional() ? fictionalPlayer(real) : real);
