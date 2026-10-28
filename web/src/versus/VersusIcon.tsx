import type { ReactNode } from 'react';

type IconName = 'swap' | 'random' | 'play' | 'star' | 'settings' | 'sparkles' | 'plus' | 'minus';

const shapes: Record<IconName, ReactNode> = {
  swap: <><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" /></>,
  random: <><rect x="3" y="3" width="18" height="18" rx="4" /><g fill="currentColor" stroke="none"><circle cx="8" cy="8" r="1.4" /><circle cx="16" cy="8" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="8" cy="16" r="1.4" /><circle cx="16" cy="16" r="1.4" /></g></>,
  play: <path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none" />,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" />,
  settings: <><circle cx="12" cy="12" r="4" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" /></>,
  sparkles: <><path d="m10 4 2.1 6.1L18 12l-5.9 1.9L10 20l-2.1-6.1L2 12l5.9-1.9zM19 2v6m-3-3h6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
};

/** Decorative control symbols: labels remain plain, translated text. */
export function VersusIcon({ name }: { name: IconName }) {
  return <svg className="vs-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
