// Armazón de emisión (maqueta v1-2d): tres pestañas principales y un grupo secundario «Análisis».
import { describe, expect, it } from 'vitest';
import { analysisViews, broadcastTabs, broadcastViewFor, panelSectionFor } from './navigation';

describe('broadcast shell navigation', () => {
  it('keeps the mockup order of the three main tabs and the secondary analysis group', () => {
    expect(broadcastTabs).toEqual(['broadcast', 'card', 'lineups']);
    expect(analysisViews).toEqual(['summary', 'maps', 'effort', 'data']);
  });

  it('maps each view to the panel the adapter loads', () => {
    expect(panelSectionFor('broadcast')).toBe('match');
    expect(panelSectionFor('card')).toBe('players');
    expect(panelSectionFor('lineups')).toBe('players');
    for (const view of analysisViews) expect(panelSectionFor(view)).toBe(view);
  });

  it('opens an initial section in its broadcast view', () => {
    expect(broadcastViewFor('match')).toBe('broadcast');
    expect(broadcastViewFor('players')).toBe('lineups');
    expect(broadcastViewFor('maps')).toBe('maps');
    expect(broadcastViewFor('data')).toBe('data');
  });
});
