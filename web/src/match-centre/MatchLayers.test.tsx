import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MatchLayers } from './MatchLayers';
import { screenFixture } from './unified-screen-fixtures';
import type { PitchProjection } from '../match/renderers/types';

it('anchor_projects_in_viewport and keeps IDs/time bounds independent of a RetroScene', () => {
  const layers = screenFixture().initial.layers!;
  const projection: PitchProjection = { viewport: { width: 800, height: 450 }, projectFieldPoint: (x, y) => ({ x: x * 2, y: y * 3 }) };
  const view = render(<MatchLayers layers={layers} projection={projection} elapsedMs={0} showAnchors />);
  expect(view.container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 800 450');
  const anchor = view.container.querySelector('[data-anchor="anchor-1"]')!;
  expect(anchor.querySelector('circle')).toHaveAttribute('cx', '60'); expect(anchor.querySelector('circle')).toHaveAttribute('cy', '60');
  expect(anchor).toHaveTextContent('event-1');
  view.rerender(<MatchLayers layers={layers} projection={{ ...projection, projectFieldPoint: () => null }} elapsedMs={0} showAnchors />);
  expect(view.container.querySelector('[data-anchor]')).toBeNull();
  view.rerender(<MatchLayers layers={layers} projection={projection} elapsedMs={2001} showAnchors />);
  expect(view.container.querySelector('[data-anchor]')).toBeNull();
  view.rerender(<MatchLayers layers={layers} projection={projection} elapsedMs={-1} showAnchors />);
  expect(view.container.querySelector('[data-anchor]')).toBeNull();
  view.rerender(<MatchLayers layers={layers} projection={projection} elapsedMs={0} showAnchors={false} />);
  expect(view.container.querySelector('svg')).toBeNull();
});
