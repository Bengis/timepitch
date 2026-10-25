import { useMemo } from 'react';
import type { GrfReplay } from '../api';
import { MatchCentre } from '../match-centre/MatchCentre';
import { LiveCrewPanel } from '../match-centre/LiveCrewPanel';
import { useLanguage } from '../i18n';
import { createGrfSession } from '../match-centre/adapters/grf';
import type { MatchSection } from '../match-centre/session';
export function GrfMatchView({ id, record, onBack, visible = true, tab, onSectionChange, autoplay = false }: { id: string; record: GrfReplay; onBack: () => void; visible?: boolean; tab?: MatchSection; onSectionChange?: (section: MatchSection) => void; autoplay?: boolean }) {
  const adapter = useMemo(() => createGrfSession(id, record), [id, record.trace_hash]);
  const { locale } = useLanguage();
  // TP253: crónica IA en vivo (el servidor sabe leer los partidos GRF comprimidos y los físicos).
  return <div data-match-id={id} data-engine-version={record.engine_version}><MatchCentre adapter={adapter} visible={visible} onBack={onBack} initialSection={tab} onSectionChange={onSectionChange} autoplay={autoplay} rendererLocked
    sideReport={({ revealed }) => <LiveCrewPanel engine="grf" matchId={id} locale={locale === 'es' ? 'es' : 'en'} ended={revealed} />} /></div>;
}