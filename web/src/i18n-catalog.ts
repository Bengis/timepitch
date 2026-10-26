// TP266 (26-oct: «debe ser idioma independiente y poder añadir cualquiera»): textos de la interfaz en
// cualquier idioma. Cada módulo conserva sus textos en inglés y español (los dos idiomas que escribimos y revisamos) y
// los registra con `defineTexts(espacio, {en, es})`; los demás idiomas salen de un catálogo por idioma,
// `src/locales/<código>.json`, generado por `scripts/i18n.mjs` (extrae el inglés) y `scripts/i18n_translate.py`
// (traduce lo que falta con el modelo). Una clave sin traducir sale en inglés: nada se rompe al añadir un idioma.

export const LOCALES = [
  { code: 'en', name: 'English' }, { code: 'es', name: 'Español' }, { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' }, { code: 'it', name: 'Italiano' }, { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' }, { code: 'ja', name: '日本語' }, { code: 'zh', name: '中文' }, { code: 'ko', name: '한국어' },
] as const;
export type Locale = typeof LOCALES[number]['code'];
export type SourceLocale = 'en' | 'es';
export const isLocale = (value: unknown): value is Locale => LOCALES.some(l => l.code === value);

type Catalog = Readonly<Record<string, Readonly<Record<string, string>>>>;
const files = import.meta.glob('./locales/*.json', { eager: true, import: 'default' }) as Record<string, Catalog>;
const CATALOGS: Partial<Record<Locale, Catalog>> = {};
for (const [path, catalog] of Object.entries(files)) {
  const code = path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
  if (isLocale(code)) CATALOGS[code] = catalog;
}

/** `{0}`, `{1}`… con los argumentos en orden. */
export function fill(template: string, args: readonly unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (m, i: string) => (Number(i) < args.length ? String(args[Number(i)]) : m));
}

/** Traducción de un texto en inglés de un espacio, o el inglés si el catálogo no lo tiene. */
export function lookup(locale: Locale, ns: string, key: string): string | undefined {
  return CATALOGS[locale]?.[ns]?.[key];
}

/** Recorre los textos ingleses: cada cadena por su ruta (`a.b.0`) en el catálogo, cada función como plantilla. */
function translateDeep(value: unknown, locale: Locale, ns: string, path: string): unknown {
  if (typeof value === 'string') return lookup(locale, ns, path) ?? value;
  if (typeof value === 'function') {
    const template = lookup(locale, ns, path);
    if (template === undefined) return value;
    // Una variante que recibe un hueco vacío (p. ej. «recupera el balón» sin rival) se queda en inglés: la plantilla
    // traducida es la de la variante completa.
    const english = value as (...args: unknown[]) => string;
    return (...args: unknown[]) => (args.some(a => a === null || a === undefined || a === false) ? english(...args) : fill(template, args));
  }
  if (Array.isArray(value)) return Object.freeze(value.map((v, i) => translateDeep(v, locale, ns, `${path}.${i}`)));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = translateDeep(v, locale, ns, path ? `${path}.${k}` : k);
    return Object.freeze(out);
  }
  return value;
}

/** Inglés de cada espacio registrado: lo lee la extracción de catálogos (`i18n-catalog.test.ts`). */
export const REGISTRY = new Map<string, object>();

/** Los literales `as const` del inglés, como cadenas: el español (y el catálogo) dicen otra cosa con la misma forma. */
export type Widen<T> = T extends string ? string : T extends (...args: infer A) => infer R ? (...args: A) => Widen<R>
  : T extends readonly (infer U)[] ? readonly Widen<U>[] : T extends object ? { readonly [K in keyof T]: Widen<T[K]> } : T;

/**
 * Registra los textos de un módulo y devuelve el selector por idioma. En inglés y español, los del código; en los
 * demás, cada cadena del catálogo (o la inglesa si falta) y cada función como plantilla con `{0}`, `{1}`… (o la
 * función inglesa si falta). Los objetos y listas anidados se recorren con claves `a.b.0`.
 */
export function defineTexts<T extends object>(ns: string, texts: Readonly<{ en: T; es: NoInfer<Widen<T>> }>): (locale: Locale) => Widen<T> {
  if (REGISTRY.has(ns) && REGISTRY.get(ns) !== texts.en) throw new Error(`Duplicate text namespace: ${ns}`);
  REGISTRY.set(ns, texts.en);
  const cache = new Map<Locale, Widen<T>>();
  return (locale: Locale): Widen<T> => {
    if (locale === 'en' || locale === 'es') return texts[locale] as Widen<T>;
    let out = cache.get(locale);
    if (!out) {
      out = translateDeep(texts.en, locale, ns, '') as Widen<T>;
      cache.set(locale, out);
    }
    return out;
  };
}

/** Tablas `id → [inglés, español]` (nombres de estadísticas): mismo catálogo, una clave por id. */
export function definePairs(ns: string, pairs: Readonly<Record<string, readonly [string, string]>>) {
  const en: Record<string, string> = {}, es: Record<string, string> = {};
  for (const [id, [e, s]] of Object.entries(pairs)) { en[id] = e; es[id] = s; }
  const texts = defineTexts(ns, { en, es });
  return (locale: Locale, id: string): string | undefined => texts(locale)[id];
}

const INTL: Record<Locale, string> = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', nl: 'nl-NL',
  ja: 'ja-JP', zh: 'zh-CN', ko: 'ko-KR' };
/** Etiqueta para `Intl` (números y fechas en el formato del idioma). */
export const intlTag = (locale: string): string => (isLocale(locale) ? INTL[locale] : 'en-GB');

/** Una frase suelta: la española, la inglesa o la del catálogo (`phrases`, por su texto inglés). */
export function L(locale: Locale, en: string, es: string): string {
  return locale === 'es' ? es : locale === 'en' ? en : lookup(locale, 'phrases', en) ?? en;
}

/** El idioma que usan los datos y la IA: los no nativos piden inglés al servidor y reciben su traducción comprobada. */
export const sourceLocale = (locale: Locale): SourceLocale => (locale === 'es' ? 'es' : 'en');
