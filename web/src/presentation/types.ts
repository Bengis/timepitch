// Contratos de presentación (spec §3–§4 de .local/plans/2026-10-22-game-ui-design.md).
// Independientes del motor gráfico: los consumen la UI, los renderizadores 2D y el 3D.

export type AssetSourceKind =
  | 'wikipedia' | 'wikidata' | 'commons' | 'hfk' | 'statsbomb' | 'hand_assigned' | 'generic';

export type AssetSource = Readonly<{
  kind: AssetSourceKind;
  title?: string; revid?: number; qid?: string; revision?: number; url?: string;
  licence: string; note?: string;
}>;

export type CrestRef = Readonly<{ src: string; kind: 'hd' | 'hfk' | 'fictional' | 'none'; source: AssetSource | null }>;

export type PatternFamily =
  | 'plain' | 'stripes' | 'hoops' | 'halves' | 'sash' | 'pinstripes' | 'side_panels' | 'unknown';

export type KitCollar = 'crew' | 'v' | 'polo' | 'unknown';

export type KitSpec = Readonly<{
  shirt: string;
  sleeves: Readonly<{ left: string; right: string }>;
  shorts: string; socks: string; trim: string; number: string;
  collar: KitCollar;
  pattern: Readonly<{ body: PatternFamily; sleeves: PatternFamily; shorts: PatternFamily; socks: PatternFamily }>;
  source: AssetSource;
}>;

export type MatchKits = Readonly<{
  home: KitSpec; away: KitSpec; homeKeeper: KitSpec; awayKeeper: KitSpec;
  choice: 'source' | 'estimated';
}>;

// Paleta y valores de LOOKS en la maqueta (.local/mockup/index.html, l.541–558).
export type SkinTone = 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7' | 's8';
export type HairStyle = 'buzz' | 'crop' | 'short' | 'side' | 'slick' | 'quiff' | 'curly' | 'long' | 'tied' | 'shaved';
export type HairColour = 'black' | 'dkbrown' | 'brown' | 'ltbrown' | 'dkblond' | 'blond';
export type Beard = 'none' | 'light' | 'stubble' | 'full';
export type EyeColour = 'dk' | 'br' | 'hz' | 'bl' | 'gr';

export type AppearanceParams = Readonly<{
  skin: SkinTone; hairStyle: HairStyle; hairColour: HairColour; beard: Beard; eyes: EyeColour;
  /** Color CSS de las botas (`#rrggbb`). */
  boots: string;
  /** Complexión relativa; 1 = media. */
  build: number;
  heightCm?: number | null;
}>;

/** Aspecto neutro e idéntico para todo jugador sin registro (no se sortea por nombre ni hash). */
export const GENERIC_APPEARANCE: AppearanceParams = Object.freeze({
  skin: 's4', hairStyle: 'crop', hairColour: 'dkbrown', beard: 'none', eyes: 'br', boots: '#111111', build: 1,
  heightCm: null,
});

export type PlayerRecord = Readonly<{
  qid: string | null; number: string | null; display: string; position: string | null; nation: string | null;
  dob: string | null; heightCm: number | null;
  fields: Readonly<Record<string, AssetSource>>;
}>;

export type PlayerLink = Readonly<{
  source: string; sourceKey: string; qid: string;
  method: 'manual' | 'jersey_club_season' | 'dob_club_season' | 'opta';
  reviewed: boolean;
}>;

export type CastEntry = Readonly<{
  number: string | null; displayName: string | null;
  appearance: AppearanceParams; appearanceSource: 'hand_assigned' | 'generic';
  record: PlayerRecord | null;
}>;

/** Identidad visual del partido. Claves de `players` = `SceneFrame.players[].key` (= `PlayerView.id`). */
export type MatchCast = Readonly<{ kits: MatchKits; players: ReadonlyMap<string, CastEntry> }>;
