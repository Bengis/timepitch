import type {ProvenanceKind} from './api';
import {useHistoricalText} from './messages';
export function ProvenanceBadge({kind}:{kind:ProvenanceKind}){
  const h=useHistoricalText();
  return <span className={`evidence-badge evidence-${kind}`}>{({source_recorded:h.sourceRecorded,derived_from_events:h.derived,synthetic_motion:h.syntheticLabel,unavailable:h.missing})[kind]}</span>;
}
