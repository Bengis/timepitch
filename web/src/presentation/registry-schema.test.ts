import { describe, expect, it } from 'vitest';
import { assertNoTransfermarkt, isAssetSource } from './registry-schema';
import { GENERIC_APPEARANCE } from './types';

describe('assertNoTransfermarkt', () => {
  it('throws when any nested key starts with tm_', () => {
    expect(() => assertNoTransfermarkt({ a: { tm_dob: 1 } })).toThrow(/tm_dob/);
    expect(() => assertNoTransfermarkt([{ ok: 1 }, { deep: [{ tm_value: 'x' }] }])).toThrow();
  });
  it('accepts registries without Transfermarkt fields', () => {
    expect(() => assertNoTransfermarkt({ a: { dob: '1992-05-11' } })).not.toThrow();
    expect(() => assertNoTransfermarkt({ note: 'tm_ only as a value' })).not.toThrow();
    expect(() => assertNoTransfermarkt(null)).not.toThrow();
  });
});

describe('isAssetSource', () => {
  it('accepts a sourced Wikipedia reference', () => {
    expect(isAssetSource({ kind: 'wikipedia', licence: 'CC BY-SA 4.0', title: 'X', revid: 1 })).toBe(true);
    expect(isAssetSource({ kind: 'generic', licence: 'TimePitch' })).toBe(true);
  });
  it('rejects unknown kinds, missing licence and wrongly typed fields', () => {
    expect(isAssetSource({ kind: 'foto' })).toBe(false);
    expect(isAssetSource({ kind: 'wikipedia' })).toBe(false);
    expect(isAssetSource({ kind: 'wikipedia', licence: 'CC BY-SA 4.0', revid: '1' })).toBe(false);
    expect(isAssetSource(null)).toBe(false);
    expect(isAssetSource('wikipedia')).toBe(false);
  });
});

describe('GENERIC_APPEARANCE', () => {
  it('is frozen so every unregistered player shares the same neutral look', () => {
    expect(Object.isFrozen(GENERIC_APPEARANCE)).toBe(true);
  });
});
