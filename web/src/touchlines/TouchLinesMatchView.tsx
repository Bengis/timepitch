// TP243: partido TouchLines en vivo. La grabación y sus eventos se validan con el mismo perfil que las grabaciones de
// la demo; como no vienen de un índice versionado, la «entrada» se construye con lo que la propia grabación declara.
import { useMemo } from 'react';
import type { TouchLinesRecord } from '../api';
import { MatchCentre } from '../match-centre/MatchCentre';
import { LiveCrewPanel } from '../match-centre/LiveCrewPanel';
import { MatchQuestions } from '../match-centre/MatchQuestions';
import { useLanguage } from '../i18n';
import { createRecordedSession } from '../match-centre/adapters/recorded-session';
import { normalizeRecording } from '../match-centre/adapters/recorded-track';
import { parseRecordedEvents } from '../match-centre/adapters/recorded-events';
import { TOUCHLINES_PROFILE } from '../match-centre/adapters/touchlines';
import type { RecordedReplayEntry } from '../match-centre/adapters/recorded-replay';
import type { MatchSection } from '../match-centre/session';

export function touchLinesSession(id: string, record: TouchLinesRecord) {
  const track = normalizeRecording(record.raw, TOUCHLINES_PROFILE);
  const recording = (record.events as { recording?: { sha256?: unknown } } | null)?.recording;
  // Partido en vivo: sin fichero servido, el sidecar declara `sha256: null`; motor, versión y trace_hash sí se comprueban.
  const entry = { engine: 'touchlines', engine_version: (record.raw as { engine_version?: string }).engine_version, trace_hash: track.traceHash,
    sha256: recording?.sha256 ?? null } as unknown as RecordedReplayEntry;
  return createRecordedSession(id, track, parseRecordedEvents(record.events, entry));
}

export function TouchLinesMatchView({ id, record, onBack, visible = true, tab, onSectionChange, autoplay = false }: { id: string; record: TouchLinesRecord;
  onBack: () => void; visible?: boolean; tab?: MatchSection; onSectionChange?: (section: MatchSection) => void; autoplay?: boolean }) {
  const adapter = useMemo(() => touchLinesSession(id, record), [id, record]);
  const { locale } = useLanguage();
  return <div data-match-id={id} data-engine-version="touchlines-5c5c71a-native"><MatchCentre adapter={adapter} visible={visible} onBack={onBack}
    initialSection={tab} onSectionChange={onSectionChange} autoplay={autoplay} rendererLocked liveSimulation
    sideReport={({ revealed, halfTime, onAvailability }) => <><LiveCrewPanel engine="touchlines" matchId={id} locale={locale} ended={revealed} halfTime={halfTime} onAvailability={onAvailability} />
      <MatchQuestions engine="touchlines" matchId={id} locale={locale} ended={revealed} /></>} /></div>;
}
