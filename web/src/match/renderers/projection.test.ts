import { expect, it } from 'vitest';
import { pointerToProjection } from './projection';

it('converts CSS pointer positions to logical projection coordinates without a DPR offset', () => {
  const rect = { left: 100, top: 50, width: 768, height: 512 };
  expect(pointerToProjection(304, 212, rect, { width: 384, height: 256 })).toEqual({ x: 102, y: 81 });
  expect(pointerToProjection(304, 212, rect, { width: 768, height: 512 })).toEqual({ x: 204, y: 162 });
  expect(pointerToProjection(99, 212, rect, { width: 384, height: 256 })).toBeNull();
  expect(pointerToProjection(304, 212, { ...rect, width: 0 }, { width: 384, height: 256 })).toBeNull();
  expect(pointerToProjection(Infinity, 212, rect, { width: 384, height: 256 })).toBeNull();
});
