// Planificador de rótulos en pantalla (G17): envuelve `stepAnnouncer` (puro) con el reloj de pared y un temporizador
// para retirar el rótulo aunque la reproducción esté en pausa. Una búsqueda (seekToken nuevo o cursor hacia atrás)
// no saca una ráfaga de rótulos atrasados: solo, como mucho, el último de prioridad alta saltado hacia delante.
import { useEffect, useRef, useState } from 'react';
import { initialAnnouncer, stepAnnouncer, type Announcement, type AnnouncerState } from './announcements/announcements';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** `seeking`: hay una búsqueda pendiente (el cursor aún no ha llegado al destino); mientras tanto no se anuncia nada. */
export function useAnnouncer(announcements: readonly Announcement[], cursorMs: number, seekToken: number, seeking = false): Announcement | null {
  const state = useRef<AnnouncerState>(initialAnnouncer()), lastSeek = useRef(seekToken);
  // Tramo saltado en la última búsqueda: los eventos de ese tramo pueden llegar en una instantánea posterior.
  const jump = useRef<{ from: number; to: number } | null>(null);
  // Cursor antes de una búsqueda pedida que aún no ha movido el cursor (el reloj llega un fotograma después).
  const armed = useRef<number | null>(null);
  const [current, setCurrent] = useState<Announcement | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const previous = state.current.cursorMs, wallMs = now();
    if (lastSeek.current !== seekToken && armed.current === null) armed.current = previous ?? cursorMs;
    lastSeek.current = seekToken;
    if (seeking || (armed.current !== null && cursorMs === armed.current)) return;
    const from = armed.current ?? previous;
    const seek = armed.current !== null || previous === null || cursorMs < previous;
    armed.current = null;
    if (seek) jump.current = { from: from ?? cursorMs, to: cursorMs };
    const late = !seek && jump.current !== null && announcements.some(a => a.atMs <= jump.current!.to && !state.current.seen.has(a.id));
    let next: AnnouncerState;
    if (late) {
      // Datos tardíos del tramo saltado: se rehace el resumen de la búsqueda con ellos, sin mostrarlos uno a uno.
      const redo = stepAnnouncer({ ...initialAnnouncer(), cursorMs: jump.current!.from }, announcements, { cursorMs, wallMs, seek: true });
      const held = state.current.current;
      next = held && redo.current?.announcement.id === held.announcement.id ? { ...redo, current: held } : redo;
    } else next = stepAnnouncer(seek ? { ...state.current, cursorMs: from } : state.current, announcements, { cursorMs, wallMs, seek });
    state.current = next;
    setCurrent(next.current?.announcement ?? null);
    if (!next.current) return;
    const left = next.current.announcement.durationMs - (wallMs - next.current.startedAtMs);
    const timer = setTimeout(() => setTick(n => n + 1), Math.max(16, left));
    return () => clearTimeout(timer);
  }, [announcements, cursorMs, seekToken, seeking, tick]);
  return current;
}
