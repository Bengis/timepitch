import { useId, type KeyboardEvent } from 'react';
import type { MatchSection } from './session';
import { usePlayerText } from './player-messages';
import { analysisViews, broadcastTabs, type BroadcastView } from './navigation';

export const matchSections: readonly MatchSection[] = ['match', 'summary', 'players', 'maps', 'effort', 'data'];

/** Flechas, Inicio y Fin recorren las pestañas en orden (patrón ARIA de pestañas con activación automática). */
function tabKeys<T extends string>(values: readonly T[], value: T, onChange: (next: T) => void, idOf: (v: T) => string) {
  return (e: KeyboardEvent) => {
    const current = values.indexOf(value);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? values.length - 1 : e.key === 'ArrowRight' ? (current + 1) % values.length : e.key === 'ArrowLeft' ? (current + values.length - 1) % values.length : null;
    if (next !== null) { e.preventDefault(); onChange(values[next]); document.getElementById(idOf(values[next]))?.focus(); }
  };
}

export function MatchSections({ value, onChange, panelId }: { value: MatchSection; onChange: (section: MatchSection) => void; panelId: string }) {
  const t = usePlayerText(), id = useId();
  return <nav className="unified-tabs" role="tablist" aria-label="Match Centre" onKeyDown={tabKeys(matchSections, value, onChange, s => `${id}-${s}`)}>
    {matchSections.map(section => <button key={section} id={`${id}-${section}`} role="tab" aria-selected={value === section} aria-controls={panelId} tabIndex={value === section ? 0 : -1} onClick={() => onChange(section)}>{t[section]}</button>)}</nav>;
}

/** Pestañas del armazón de emisión (maqueta v1-2d): segmento con las tres pantallas y, aparte, el grupo «Análisis».
 *  TP239 (jueces: los números sugerían pasos obligatorios; «Data» enseñaba hashes): sin numerar, y solo las pestañas de
 *  análisis con contenido propio (`analysis`); los datos técnicos van plegados en la columna del partido. */
export function BroadcastSections({ value, onChange, panelId, analysis = analysisViews }: { value: BroadcastView; onChange: (view: BroadcastView) => void; panelId: string; analysis?: readonly BroadcastView[] }) {
  const t = usePlayerText(), id = useId(), views: readonly BroadcastView[] = [...broadcastTabs, ...analysis];
  const tab = (view: BroadcastView, label: string) => <button key={view} id={`${id}-${view}`} role="tab" aria-selected={value === view} aria-controls={panelId}
    tabIndex={value === view ? 0 : -1} data-view={view} onClick={() => onChange(view)}>{label}</button>;
  return <nav className="tp-screen-tabs" role="tablist" aria-label="Match Centre" data-broadcast-tabs onKeyDown={tabKeys(views, value, onChange, v => `${id}-${v}`)}>
    <span className="tp-tabs-main">{broadcastTabs.map(view => tab(view, t.screens[view]))}</span>
    <span className="tp-tabs-analysis"><span className="tp-tabs-label" aria-hidden="true">{t.analysisGroup}</span>{analysis.map(view => tab(view, t[view as 'summary']))}</span>
  </nav>;
}
