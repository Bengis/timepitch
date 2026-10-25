import { useMemo } from 'react';
import type { GrfReplay } from '../api';
import { MatchCentre } from '../match-centre/MatchCentre';
import { createGrfSession } from '../match-centre/adapters/grf';
import type { MatchSection } from '../match-centre/session';
export function GrfMatchView({ id, record, onBack, visible = true, tab, onSectionChange, autoplay = false }: { id: string; record: GrfReplay; onBack: () => void; visible?: boolean; tab?: MatchSection; onSectionChange?: (section: MatchSection) => void; autoplay?: boolean }) {
  const adapter = useMemo(() => createGrfSession(id, record), [id, record.trace_hash]);
  return <div data-match-id={id} data-engine-version={record.engine_version}><MatchCentre adapter={adapter} visible={visible} onBack={onBack} initialSection={tab} onSectionChange={onSectionChange} autoplay={autoplay} rendererLocked /></div>;
}