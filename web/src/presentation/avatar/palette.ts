// Paletas del avatar estilizado, compartidas por el retrato SVG (G05) y el personaje 3D (G07).
// Valores de la maqueta aprobada (.local/mockup/demo-data.js l.53–55). Sin dependencias de three.
import type { EyeColour, HairColour, HairStyle, SkinTone } from '../types';

export const SKIN_TONES: Readonly<Record<SkinTone, string>> = Object.freeze({
  s1: '#f3d2b6', s2: '#e9c09f', s3: '#ddab86', s4: '#c8916a', s5: '#a8724d', s6: '#865437', s7: '#663f2a', s8: '#4c2e1f',
});
export const HAIR_COLOURS: Readonly<Record<HairColour, string>> = Object.freeze({
  black: '#17110e', dkbrown: '#2d2018', brown: '#4f3526', ltbrown: '#7b5737', dkblond: '#a27d53', blond: '#c9a46a',
});
export const EYE_COLOURS: Readonly<Record<EyeColour, string>> = Object.freeze({
  dk: '#2b1a10', br: '#4a3020', hz: '#6b5230', bl: '#5b7f9e', gr: '#6b7d68',
});
/** Los diez peinados de la maqueta, de menos a más pelo. */
export const HAIR_STYLES: readonly HairStyle[] =
  Object.freeze(['shaved', 'buzz', 'crop', 'short', 'side', 'slick', 'quiff', 'curly', 'tied', 'long']);

export const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/** Mezcla lineal de dos colores `#rrggbb` (t = 0 → a, t = 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** Aclara (amt > 0) u oscurece (amt < 0) cada canal en `amt` unidades, acotado a [0, 255]. */
export function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, ((n >> shift) & 255) + amt));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
