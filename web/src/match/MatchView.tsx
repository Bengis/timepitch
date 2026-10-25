import { useMemo } from 'react';
import type { MatchRecord } from '../api';
import { MatchCentre } from '../match-centre/MatchCentre';
import { createTimePitchSession } from '../match-centre/adapters/timepitch';
import type { MatchSection } from '../match-centre/session';
export function MatchView({ id, record, onBack, visible = true, tab, onSectionChange, autoplay = false }: { id: string; record: MatchRecord; onBack: () => void; visible?: boolean; tab?: MatchSection; onSectionChange?: (section: MatchSection) => void; autoplay?: boolean }) {
  const adapter = useMemo(() => createTimePitchSession(id, record), [id, record.trace_hash]);
  return <div data-match-id={id} data-engine-version={record.engine_version}><MatchCentre adapter={adapter} visible={visible} onBack={onBack} initialSection={tab} onSectionChange={onSectionChange} autoplay={autoplay} rendererLocked actions={{ explanations: { id, revision: record.trace_hash } }} /></div>;
}