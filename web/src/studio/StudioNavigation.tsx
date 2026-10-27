import { useCentreText } from '../match-centre/messages';

export function StudioNavigation({ page, onSetup, onMatch, onLibrary, matchAvailable = true, busy }: {
  page: 'setup' | 'match' | 'library' | 'other'; onSetup: () => void; onMatch: () => void; onLibrary?: () => void; matchAvailable?: boolean; busy: boolean;
}) {
  const t = useCentreText();
  return <nav className="studio-navigation" aria-label={t.workspace}>
    <span className="studio-monogram" aria-hidden="true">tp</span>
    <button type="button" aria-label={t.newMatch} title={t.newMatch} aria-current={page === 'setup' ? 'page' : undefined} disabled={busy} onClick={onSetup}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>
      <span className="studio-nav-caption">{t.newMatch}</span>
    </button>
    <button type="button" aria-label={t.matchCentre} title={t.matchCentre} aria-current={page === 'match' ? 'page' : undefined} disabled={busy || !matchAvailable} onClick={onMatch}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="m10 8 5 2.5-5 2.5zM8 21h8m-4-4v4"/></svg>
      <span className="studio-nav-caption">{t.matchCentre}</span>
    </button>
    {onLibrary && <button type="button" aria-label={t.library} title={t.library} aria-current={page === 'library' ? 'page' : undefined} disabled={busy} onClick={onLibrary}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 4h14v17l-7-4-7 4z"/></svg>
      <span className="studio-nav-caption">{t.library}</span>
    </button>}
  </nav>;
}
