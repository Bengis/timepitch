// Efectos de sonido del partido (TP231), sintetizados con Web Audio: sin ficheros de audio de terceros.
// Cada función construye su grafo sobre cualquier `BaseAudioContext` (el de la página o un `OfflineAudioContext`
// para generar muestras WAV) a partir del instante `t` y se desconecta sola al acabar. Volúmenes moderados: el
// máster (engine.ts) los reduce todavía más.

type Ctx = BaseAudioContext;
const noiseCache = new WeakMap<Ctx, AudioBuffer>();

/** Ruido blanco determinista (mismo resultado en cada render) de 4 s, compartido por contexto. */
export function noiseBuffer(ctx: Ctx): AudioBuffer {
  const cached = noiseCache.get(ctx); if (cached) return cached;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 4), ctx.sampleRate), data = buffer.getChannelData(0);
  let seed = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; data[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1; }
  noiseCache.set(ctx, buffer); return buffer;
}
function noise(ctx: Ctx, t: number, duration: number, offset = 0) {
  const source = ctx.createBufferSource(); source.buffer = noiseBuffer(ctx); source.loop = true;
  source.start(t, offset % 3.5); source.stop(t + duration); return source;
}
function filter(ctx: Ctx, type: BiquadFilterType, frequency: number, q = 0.7) {
  const node = ctx.createBiquadFilter(); node.type = type; node.frequency.value = frequency; node.Q.value = q; return node;
}
function gain(ctx: Ctx, value = 0) { const node = ctx.createGain(); node.gain.value = value; return node; }
/** Envolvente ataque/sostén/caída sobre un GainNode (rampas exponenciales hacia casi cero, sin clics). */
function envelope(node: GainNode, t: number, peak: number, attack: number, hold: number, release: number) {
  const g = node.gain; g.setValueAtTime(0.0001, t); g.exponentialRampToValueAtTime(peak, t + attack);
  g.setValueAtTime(peak, t + attack + hold); g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  return t + attack + hold + release;
}

/** Golpeo de balón: golpe sordo de ruido filtrado más un tono que cae. `strong` para los tiros. */
export function kick(ctx: Ctx, dest: AudioNode, t: number, strong = false) {
  const body = noise(ctx, t, 0.14), low = filter(ctx, 'lowpass', strong ? 1500 : 900, 1.2), amp = gain(ctx);
  body.connect(low).connect(amp).connect(dest);
  envelope(amp, t, strong ? 0.75 : 0.45, 0.004, 0.01, strong ? 0.11 : 0.07);
  const thump = ctx.createOscillator(), thumpAmp = gain(ctx);
  thump.type = 'sine'; thump.frequency.setValueAtTime(strong ? 150 : 120, t); thump.frequency.exponentialRampToValueAtTime(48, t + 0.09);
  thump.connect(thumpAmp).connect(dest); envelope(thumpAmp, t, strong ? 0.7 : 0.45, 0.003, 0.015, 0.09);
  thump.start(t); thump.stop(t + 0.15);
  return t + 0.15;
}

/** Pitadas del árbitro (s): saque inicial una larga; descanso dos; final tres (corta, corta, larga). */
export const WHISTLE_PATTERNS = { kickoff: [0.6], half: [0.32, 0.85], full: [0.24, 0.24, 1.1] } as const;
/** Silbato de bolita: dos tonos cercanos (batido) con trino de vibrato rápido y trémolo. */
export function whistle(ctx: Ctx, dest: AudioNode, t: number, blasts: readonly number[]) {
  let at = t;
  for (const length of blasts) {
    const amp = gain(ctx), tone = filter(ctx, 'lowpass', 5200, 0.5), trill = ctx.createOscillator(), depth = gain(ctx, 70);
    const tremolo = gain(ctx, 0.35), tremoloAmp = gain(ctx, 0.65);
    trill.type = 'triangle'; trill.frequency.value = 27; trill.connect(depth);
    trill.connect(tremolo).connect(tremoloAmp.gain);
    amp.connect(tone).connect(tremoloAmp).connect(dest);
    for (const [base, level] of [[2870, 0.18], [3130, 0.11]] as const) {
      const osc = ctx.createOscillator(), mix = gain(ctx, level); osc.type = 'sine'; osc.frequency.value = base;
      depth.connect(osc.frequency); osc.connect(mix).connect(amp); osc.start(at); osc.stop(at + length + 0.08);
    }
    envelope(amp, at, 1, 0.012, Math.max(0, length - 0.06), 0.05);
    trill.start(at); trill.stop(at + length + 0.08);
    at += length + 0.16;
  }
  return at;
}

/** Murmullo creciente de la grada: ruido en banda con dos formantes que suben y bajan (también el «uuuh»). */
function crowdSwell(ctx: Ctx, dest: AudioNode, t: number, peak: number, attack: number, hold: number, release: number, formants: readonly [number, number]) {
  const end = t + attack + hold + release, amp = gain(ctx);
  for (const [i, centre] of formants.entries()) {
    const band = filter(ctx, 'bandpass', centre, 1.6), level = gain(ctx, i === 0 ? 1 : 0.55);
    band.frequency.setValueAtTime(centre * 0.75, t); band.frequency.linearRampToValueAtTime(centre * 1.15, t + attack);
    band.frequency.linearRampToValueAtTime(centre * 0.85, end);
    noise(ctx, t, end - t + 0.05, i * 1.3).connect(band).connect(level).connect(amp);
  }
  amp.connect(dest); envelope(amp, t, peak, attack, hold, release); return end;
}
/** «Uuuh» de la grada para paradas y ocasiones falladas. */
export function ooh(ctx: Ctx, dest: AudioNode, t: number) { return crowdSwell(ctx, dest, t, 0.55, 0.3, 0.25, 0.9, [480, 880]); }

const NOTE = (n: number) => 440 * 2 ** ((n - 69) / 12);
/** Gol: rugido de la grada y, encima, una sintonía arcade corta de onda cuadrada con bajo triangular. */
export function goal(ctx: Ctx, dest: AudioNode, t: number) {
  const roarEnd = crowdSwell(ctx, dest, t, 0.75, 0.5, 1.6, 2.6, [520, 1250]);
  const lead = gain(ctx, 0.09), soft = filter(ctx, 'lowpass', 3400, 0.6); lead.connect(soft).connect(dest);
  // C5 E5 G5 C6 · G5 C6 (larga): 16 bits de feria, sin melodías reconocibles.
  const melody: readonly [number, number][] = [[72, 0.11], [76, 0.11], [79, 0.11], [84, 0.2], [79, 0.11], [84, 0.5]];
  let at = t + 0.18;
  for (const [note, length] of melody) {
    for (const [type, octave, level] of [['square', 0, 1], ['triangle', -24, 1.6]] as const) {
      const osc = ctx.createOscillator(), amp = gain(ctx); osc.type = type; osc.frequency.value = NOTE(note + octave);
      osc.connect(amp).connect(lead); envelope(amp, at, level, 0.005, length * 0.7, length * 0.3 + 0.03);
      osc.start(at); osc.stop(at + length + 0.06);
    }
    at += length;
  }
  return Math.max(roarEnd, at);
}

/** Ambiente de estadio: ruido en banda ancha con oleadas lentas. Devuelve cómo pararlo con un fundido. */
export function ambience(ctx: Ctx, dest: AudioNode, t: number, level = 0.12) {
  const source = ctx.createBufferSource(); source.buffer = noiseBuffer(ctx); source.loop = true;
  const band = filter(ctx, 'bandpass', 650, 0.45), air = filter(ctx, 'lowpass', 2200, 0.5), amp = gain(ctx), swell = gain(ctx);
  source.connect(band).connect(air).connect(swell).connect(amp).connect(dest);
  // Oleadas: dos LFO lentos (≈14 s y ≈5 s) sobre la ganancia; nunca bajan de la mitad del nivel.
  swell.gain.value = 1;
  const lfos = [[0.07, 0.3], [0.19, 0.15]].map(([rate, depth]) => {
    const lfo = ctx.createOscillator(), amount = gain(ctx, depth); lfo.frequency.value = rate; lfo.connect(amount).connect(swell.gain); lfo.start(t); return lfo;
  });
  amp.gain.setValueAtTime(0.0001, t); amp.gain.exponentialRampToValueAtTime(level, t + 1.2);
  source.start(t);
  return {
    stop(at: number) {
      amp.gain.cancelScheduledValues(at); amp.gain.setValueAtTime(Math.max(0.0001, amp.gain.value), at);
      amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      for (const node of [source, ...lfos]) node.stop(at + 0.55);
    },
  };
}

// --- Capitán Hane (TP234): tres efectos propios para las escenas anime, mismo estilo sintetizado. ---
/** Barrido de entrada de la escena: ruido filtrado cuyo pasabanda sube rápido (un «fiuuu» de aire). */
export function animeWhoosh(ctx: Ctx, dest: AudioNode, t: number) {
  const band = filter(ctx, 'bandpass', 400, 2.2), amp = gain(ctx);
  band.frequency.setValueAtTime(300, t); band.frequency.exponentialRampToValueAtTime(4200, t + 0.32);
  noise(ctx, t, 0.45, 0.7).connect(band).connect(amp).connect(dest);
  return envelope(amp, t, 0.6, 0.06, 0.12, 0.25);
}
/** Carga: dos osciladores en sierra que suben de tono con trémolo creciente, hasta el golpe. */
export function animeCharge(ctx: Ctx, dest: AudioNode, t: number, duration = 0.8) {
  const amp = gain(ctx), soft = filter(ctx, 'lowpass', 2600, 0.8); amp.connect(soft).connect(dest);
  for (const [detune, level] of [[0, 1], [7, 0.6]] as const) {
    const osc = ctx.createOscillator(), g = gain(ctx, level); osc.type = 'sawtooth'; osc.detune.value = detune * 100;
    osc.frequency.setValueAtTime(110, t); osc.frequency.exponentialRampToValueAtTime(660, t + duration);
    osc.connect(g).connect(amp); osc.start(t); osc.stop(t + duration + 0.08);
  }
  const lfo = ctx.createOscillator(), depth = gain(ctx, 0.04); lfo.frequency.setValueAtTime(6, t); lfo.frequency.linearRampToValueAtTime(22, t + duration);
  lfo.connect(depth).connect(amp.gain); lfo.start(t); lfo.stop(t + duration + 0.08);
  return envelope(amp, t, 0.12, duration * 0.8, duration * 0.15, 0.06);
}
/** Impacto: golpe grave que cae más un chasquido de ruido brillante. */
export function animeImpact(ctx: Ctx, dest: AudioNode, t: number) {
  const boom = ctx.createOscillator(), boomAmp = gain(ctx); boom.type = 'sine';
  boom.frequency.setValueAtTime(180, t); boom.frequency.exponentialRampToValueAtTime(38, t + 0.35);
  boom.connect(boomAmp).connect(dest); envelope(boomAmp, t, 0.9, 0.004, 0.05, 0.4); boom.start(t); boom.stop(t + 0.5);
  const crack = filter(ctx, 'highpass', 1800, 0.7), crackAmp = gain(ctx);
  noise(ctx, t, 0.25, 2.1).connect(crack).connect(crackAmp).connect(dest);
  return Math.max(envelope(crackAmp, t, 0.5, 0.002, 0.02, 0.18), t + 0.45);
}
