// Motor de sonido de la página (TP231): un único AudioContext, creado solo tras un gesto del usuario (política de
// reproducción automática). Cualquier fallo de audio se traga: el sonido nunca rompe la reproducción. Sin
// AudioContext (jsdom, navegadores sin Web Audio) todo es una operación vacía.
import type { SoundCue } from './cues';
import { ambience, animeCharge, animeImpact, animeWhoosh, goal, kick, ooh, whistle, WHISTLE_PATTERNS } from './synth';
import { pitchStorage, readSoundEnabled } from '../renderers/preferences';

/** Efectos de las escenas de Capitán Hane (TP234). `charge` dura `seconds` y termina justo antes del golpe. */
export type AnimeSound = Readonly<{ kind: 'whoosh' } | { kind: 'impact' } | { kind: 'charge'; seconds: number }>;

export interface MatchAudio {
  /** Llamar desde un gesto (clic, tecla): crea o reanuda el contexto. */
  unlock(): void;
  play(cue: SoundCue): void;
  /** Escena anime; mismo interruptor de sonido que el resto (quien llama solo lo hace con el sonido activado). */
  playAnime?(sound: AnimeSound): void;
  /** Ambiente de grada encendido o apagado (con fundido). Se recuerda aunque aún no haya contexto. */
  setAmbience(on: boolean): void;
}

type ContextCtor = new () => AudioContext;
export function audioContextCtor(): ContextCtor | null {
  try {
    const g = globalThis as unknown as { AudioContext?: ContextCtor; webkitAudioContext?: ContextCtor };
    return g.AudioContext ?? g.webkitAudioContext ?? null;
  } catch { return null; }
}

/** Volumen máster moderado; el compresor evita picos cuando coinciden gol, pitada y ambiente. */
export const MASTER_GAIN = 0.4;

export function createMatchAudio(ctor: () => ContextCtor | null = audioContextCtor): MatchAudio {
  let ctx: AudioContext | null = null, master: AudioNode | null = null, failed = false;
  let wantAmbience = false, bed: { stop(at: number): void } | null = null;
  const running = () => !!ctx && !!master && ctx.state === 'running';
  const syncAmbience = () => {
    try {
      if (wantAmbience && !bed && running()) bed = ambience(ctx!, master!, ctx!.currentTime);
      else if (!wantAmbience && bed) { const old = bed; bed = null; if (ctx) old.stop(ctx.currentTime); }
    } catch { bed = null; }
  };
  return {
    unlock() {
      if (failed) return;
      try {
        if (!ctx) {
          const Ctor = ctor(); if (!Ctor) { failed = true; return; }
          ctx = new Ctor();
          const out = ctx.createGain(); out.gain.value = MASTER_GAIN;
          const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -12; limiter.ratio.value = 6;
          out.connect(limiter).connect(ctx.destination); master = out;
          ctx.onstatechange = () => syncAmbience();
        }
        if (ctx.state === 'suspended') void ctx.resume().then(syncAmbience, () => {});
        syncAmbience();
      } catch { failed = true; ctx = null; master = null; }
    },
    play(cue) {
      if (!running()) return;
      try {
        const c = ctx!, t = c.currentTime + 0.01;
        switch (cue) {
          case 'kick': kick(c, master!, t); break;
          case 'shot': kick(c, master!, t, true); break;
          case 'ooh': ooh(c, master!, t); break;
          case 'goal': goal(c, master!, t); break;
          case 'whistle-kickoff': whistle(c, master!, t, WHISTLE_PATTERNS.kickoff); break;
          case 'whistle-half': whistle(c, master!, t, WHISTLE_PATTERNS.half); break;
          case 'whistle-full': whistle(c, master!, t, WHISTLE_PATTERNS.full); break;
        }
      } catch { /* sin sonido, la reproducción sigue */ }
    },
    playAnime(sound) {
      if (!running()) return;
      try {
        const c = ctx!, t = c.currentTime + 0.01;
        if (sound.kind === 'whoosh') animeWhoosh(c, master!, t);
        else if (sound.kind === 'impact') animeImpact(c, master!, t);
        else animeCharge(c, master!, t, Math.max(0.2, Math.min(1.6, sound.seconds)));
      } catch { /* sin sonido, la escena sigue */ }
    },
    setAmbience(on) { wantAmbience = on; syncAmbience(); },
  };
}

/** Instancia compartida por la página (un único contexto aunque se cambie de motor o de partido). */
export const matchAudio: MatchAudio = createMatchAudio();

/**
 * Desbloqueo por gesto para toda la página: el primer clic o tecla con el sonido activado crea el contexto, sea «Ver la
 * demo», «Simular partido», abrir uno guardado o Reproducir; así el arranque automático ya suena. Devuelve la limpieza.
 */
export function installGestureUnlock(audio: MatchAudio = matchAudio, enabled: () => boolean = () => readSoundEnabled(pitchStorage())): () => void {
  if (typeof window === 'undefined') return () => {};
  const unlock = () => { try { if (enabled()) audio.unlock(); } catch { /* nunca rompe la página */ } };
  window.addEventListener('pointerdown', unlock, true); window.addEventListener('keydown', unlock, true);
  return () => { window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true); };
}
