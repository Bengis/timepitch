import { describe, expect, it } from 'vitest';
import atlasJson from './atlas.json';
import {
  ACTION_WINDOW_MS, DIRECTIONS, STADIUM, cameraView, chooseBall, chooseSprite, diveSide, directionOf, fieldToStadium, followScale,
  hudText, smoothCamera, spriteKey, teamTag, CAMERA_LAG, ASSISTANT_LINE, chooseOfficialSprite, officialTargets, stepOfficial, type SpriteInput,
  DIVE, keeperDiveTiming, NET_DEPTH, REFEREE_DEPTH, ballInNet,
} from './frames';

const frames = (atlasJson as unknown as { frames: Record<string, unknown> }).frames;
const base: SpriteInput = { key: 'h7', role: 'MID', side: 'home', x: 50, y: 30, vx: 0, vy: 0, clockMs: 10_000, cut: false, cue: null, ball: { x: 60, y: 30, z: 0 }, runDistance: 0 };
const cue = (type: NonNullable<SpriteInput['cue']>['type'], participants: string[], extra: Partial<NonNullable<SpriteInput['cue']>> = {}) =>
  ({ type, participants, t1_ms: 10_000, ...extra });

describe('geometría del estadio vertical', () => {
  it('gira el campo 90° sin espejo: x = 105 arriba, y = 68 a la derecha', () => {
    const f = STADIUM.field;
    expect(fieldToStadium(105, 0)).toEqual({ x: f.x, y: f.y });
    expect(fieldToStadium(0, 68)).toEqual({ x: f.x + f.w, y: f.y + f.h });
  });
  it('direcciones de 8 vías en pantalla en el orden del atlas', () => {
    expect(DIRECTIONS).toEqual((atlasJson as unknown as { directions: string[] }).directions);
    expect(directionOf(1, 0)).toBe(0); expect(directionOf(0, 1)).toBe(2); expect(directionOf(-1, 0)).toBe(4); expect(directionOf(0, -1)).toBe(6);
    expect(directionOf(1, 1)).toBe(1); expect(directionOf(0, 0)).toBe(2); expect(directionOf(NaN, 1)).toBe(2);
  });
});

describe('cámara', () => {
  it('seguimiento a escala entera, centrado en el foco y acotado al estadio', () => {
    expect(followScale(1440, 600)).toBe(2);
    expect(followScale(985, 658)).toBe(2);
    expect(followScale(684, 456, 2)).toBe(2); // teléfono: 1 píxel lógico = 1 px CSS, no medio
    expect(followScale(1026, 684, 1.5)).toBe(2);
    expect(Number.isInteger(followScale(1170, 900))).toBe(true);
    const view = cameraView('follow', { x: 52.5, y: 34 }, 1440, 600);
    const centre = fieldToStadium(52.5, 34);
    expect(Number.isInteger(view.scale) && Number.isInteger(view.x) && Number.isInteger(view.y)).toBe(true);
    expect(Math.abs(view.y + view.h / 2 - centre.y)).toBeLessThanOrEqual(1);
    const corner = cameraView('follow', { x: 105, y: 0 }, 1440, 600);
    expect(corner.x).toBe(0); // acotada al borde del estadio
    expect(corner.y).toBe(Math.max(0, Math.round(fieldToStadium(105, 0).y - corner.h / 2)));
    expect(cameraView('follow', { x: 105, y: 0 }, 1440, 200).y).toBe(Math.round(fieldToStadium(105, 0).y - 100)); // no corta antes del borde
    expect(view.smooth).toBe(false);
  });
  it('scroll por píxel de dispositivo: el centro exacto se conserva con desfase subpíxel', () => {
    for (const cy of [500, 500.25, 500.5, 500.75]) {
      const view = cameraView('follow', null, 1440, 600, 1, { x: 300, y: cy });
      expect(view.scale).toBe(2);
      expect(view.offsetY).toBeLessThanOrEqual(0); expect(view.offsetY).toBeGreaterThan(-view.scale);
      // píxel del estadio en el centro del lienzo ≈ centro pedido (a la resolución de un píxel de dispositivo)
      const centreY = view.y + (600 / 2 - view.offsetY) / view.scale;
      expect(Math.abs(centreY - cy)).toBeLessThanOrEqual(.5 / view.scale + 1e-9);
      expect(view.h * view.scale + view.offsetY).toBeGreaterThanOrEqual(600); // el búfer cubre todo el lienzo
    }
    expect(new Set([500, 500.5].map(cy => cameraView('follow', null, 1440, 600, 1, { x: 300, y: cy }).offsetY)).size).toBe(2);
  });
  it('cámara con inercia: persigue el foco, no se aleja más del máximo y salta en cortes, pausas y búsquedas', () => {
    const start = smoothCamera(null, { x: 100, y: 100 }, 1000, false);
    expect(start).toEqual({ x: 100, y: 100, clockMs: 1000 });
    const next = smoothCamera(start, { x: 120, y: 100 }, 1016, false);
    expect(next.x).toBeGreaterThan(100); expect(next.x).toBeLessThan(120);
    const far = smoothCamera(start, { x: 400, y: 100 }, 1016, false);
    expect(Math.abs(far.x - 400)).toBeCloseTo(CAMERA_LAG.maxPx, 6);
    expect(smoothCamera(start, { x: 120, y: 100 }, 1016, true).x).toBe(120); // corte
    expect(smoothCamera(start, { x: 120, y: 100 }, 1000, false).x).toBe(120); // pausa / mismo reloj
    expect(smoothCamera(start, { x: 120, y: 100 }, 500, false).x).toBe(120); // rebobinado
    expect(smoothCamera(start, { x: 120, y: 100 }, 1000 + CAMERA_LAG.snapAfterMs + 1, false).x).toBe(120); // salto
  });
  it('campo completo: todo el rectángulo de juego dentro de la vista', () => {
    for (const [w, h] of [[1440, 600], [390, 300], [2400, 2000]]) {
      const view = cameraView('overview', null, w, h), f = STADIUM.field;
      expect(view.x).toBeLessThanOrEqual(f.x); expect(view.y).toBeLessThanOrEqual(f.y);
      expect(view.x + view.w).toBeGreaterThanOrEqual(f.x + f.w); expect(view.y + view.h).toBeGreaterThanOrEqual(f.y + f.h);
      if (view.scale >= 1) expect(Number.isInteger(view.scale)).toBe(true);
    }
  });
});

describe('elección de sprite (solo interpreta el fotograma y el evento grabado)', () => {
  it('reposo, carrera y esprint según la velocidad; la fase sale de los metros recorridos', () => {
    expect(chooseSprite(base).anim).toBe('idle');
    expect(chooseSprite({ ...base, vx: 3 }).anim).toBe('run');
    expect(chooseSprite({ ...base, vx: 7 }).anim).toBe('sprint');
    const a = chooseSprite({ ...base, vx: 3, runDistance: 0 }), b = chooseSprite({ ...base, vx: 3, runDistance: .6 });
    expect(b.frame).toBe((a.frame + 1) % 6);
    expect(chooseSprite({ ...base, vx: 3, cut: true }).anim).toBe('idle');
  });
  it('corre hacia donde se mueve; parado mira al balón', () => {
    expect(chooseSprite({ ...base, vx: 3 }).dir).toBe(6); // x creciente = hacia arriba (N)
    expect(chooseSprite({ ...base, vy: 3 }).dir).toBe(0); // y creciente = derecha (E)
    expect(chooseSprite({ ...base, ball: { x: 40, y: 30, z: 0 } }).dir).toBe(2);
  });
  it('golpeo solo para el protagonista del pase o disparo y dentro de su ventana', () => {
    expect(chooseSprite({ ...base, cue: cue('pass', ['h7']) }).anim).toBe('pass');
    expect(chooseSprite({ ...base, cue: cue('shot', ['h7']), clockMs: 10_200 }).anim).toBe('shot');
    expect(chooseSprite({ ...base, cue: cue('pass', ['h8']) }).anim).toBe('idle');
    expect(chooseSprite({ ...base, cue: cue('pass', ['h7']), clockMs: 10_000 + ACTION_WINDOW_MS.pass }).anim).toBe('idle');
    expect(chooseSprite({ ...base, cue: cue('pass', ['h7']), clockMs: 9_900 }).anim).toBe('idle'); // antes del evento, nada
    expect(chooseSprite({ ...base, cue: cue('pass', ['h7']), cut: true }).anim).toBe('idle');
  });
  it('cabezazo si el evento dice cabeza o el balón grabado va alto; sin altura no se deduce', () => {
    expect(chooseSprite({ ...base, cue: cue('shot', ['h7'], { bodyPart: 'head' }) }).anim).toBe('header');
    expect(chooseSprite({ ...base, cue: cue('pass', ['h7']), ball: { x: 51, y: 30, z: 1.8 } }).anim).toBe('header');
    expect(chooseSprite({ ...base, cue: cue('pass', ['h7']), ball: { x: 51, y: 30, z: 0 } }).anim).toBe('pass');
  });
  it('plancha solo con un evento de entrada; saque de banda solo con el balón en la banda', () => {
    expect(chooseSprite({ ...base, cue: cue('tackle', ['h7']) }).anim).toBe('slide');
    expect(chooseSprite({ ...base, cue: cue('restart', ['h7']), ball: { x: 50, y: .5, z: 0 } }).anim).toBe('throw');
    expect(chooseSprite({ ...base, cue: cue('restart', ['h7']), ball: { x: 50, y: 30, z: 0 } }).anim).toBe('idle');
  });
  it('el portero que para se estira o bloca; el batido se estira en el gol; sin evento, en guardia', () => {
    const gk: SpriteInput = { ...base, key: 'a1', role: 'GK', side: 'away', x: 104, y: 34 };
    expect(chooseSprite(gk).anim).toBe('gk-ready');
    expect(chooseSprite({ ...gk, cue: cue('save', ['a1']), ball: { x: 103, y: 30, z: 0 } }).anim).toMatch(/^gk-dive-(left|right)-low$/);
    expect(chooseSprite({ ...gk, cue: cue('save', ['a1']), ball: { x: 103, y: 34, z: 0 } }).anim).toBe('gk-catch');
    expect(chooseSprite({ ...gk, cue: cue('save', ['a1']), ball: { x: 103, y: 30, z: 2.2 } }).anim).toMatch(/-high$/);
    expect(chooseSprite({ ...gk, cue: cue('save', ['a9']), ball: { x: 103, y: 30, z: 0 } }).anim).toBe('gk-ready');
    expect(chooseSprite({ ...gk, cue: cue('goal', ['h9'], { side: 'home' }), concedingKeeper: true, ball: { x: 105, y: 31, z: 0 } }).anim).toMatch(/^gk-dive/);
  });
  it('lado de la estirada respecto al portero', () => {
    // Mirando al sur (abajo), su izquierda es la derecha de la pantalla (y mayor).
    expect(diveSide(2, { x: 50, y: 30 }, { x: 50, y: 34 })).toBe('left');
    expect(diveSide(6, { x: 50, y: 30 }, { x: 50, y: 34 })).toBe('right');
  });
  it('celebra el equipo que marca; el goleador, de rodillas', () => {
    const goal = cue('goal', ['h7'], { side: 'home' });
    expect(chooseSprite({ ...base, cue: goal }).anim).toBe('kneeslide');
    expect(chooseSprite({ ...base, key: 'h8', cue: goal }).anim).toBe('celebrate');
    expect(chooseSprite({ ...base, side: 'away', key: 'a5', cue: goal }).anim).toBe('idle');
  });
  it('cada elección existe en el atlas', () => {
    const inputs: SpriteInput[] = [base, { ...base, vx: 3 }, { ...base, vx: 8 }, { ...base, cue: cue('tackle', ['h7']) },
      { ...base, role: 'GK', vy: 2, runDistance: 1.3 }, { ...base, cue: cue('goal', ['h7'], { side: 'home' }) }];
    for (const input of inputs) for (let t = 0; t < 3000; t += 37) expect(frames[spriteKey(chooseSprite({ ...input, clockMs: 10_000 + t, runDistance: input.runDistance + t / 300 }))]).toBeDefined();
  });
});

describe('balón y marcador', () => {
  it('sin altura en la fuente, balón pequeño a ras de suelo; con altura, sube y crece', () => {
    expect(chooseBall(0, 0)).toEqual({ key: 'ball.s.0', shadow: 'shadow.ball-s', lift: 0 });
    expect(chooseBall(NaN, 0).lift).toBe(0);
    const high = chooseBall(3, .9);
    expect(high.key).toBe('ball.l.2'); expect(high.lift).toBeGreaterThan(0);
    for (const z of [0, 1, 3]) for (let r = 0; r < 4; r += .3) expect(frames[chooseBall(z, r).key]).toBeDefined();
  });
  it('siglas y texto del marcador con la letra propia', () => {
    expect(teamTag('Manchester United')).toBe('MUN');
    expect(teamTag('Manchester City')).toBe('MCI');
    expect(teamTag('Arsenal')).toBe('ARS');
    expect(teamTag('AFC Bournemouth')).toBe('BOU');
    expect(teamTag('')).toBe('---');
    expect(hudText("¡Gol! 45+2'", new Set(['G', 'O', 'L', '!', '4', '5', '+', '2', "'"]))).toBe("GOL! 45+2'");
  });
});

describe('árbitro y asistentes (TP222)', () => {
  const team = (side: 'home' | 'away', xs: number[]) => xs.map((x, i) => ({ side, role: i === 0 ? 'GK' : 'DEF', x, y: 10 + i * 5 }));
  // Local defiende la portería x = 0 (portero en 2), visitante la x = 105 (portero en 103).
  const players = [...team('home', [2, 20, 30, 35, 60]), ...team('away', [103, 90, 80, 70, 50])];
  it('asistentes en su banda y su mitad, a la altura del penúltimo defensor o del balón', () => {
    const t = officialTargets(players, { x: 52.5, y: 34 });
    expect(t.assistant1).toEqual({ x: 90, y: ASSISTANT_LINE.assistant1.y });
    expect(t.assistant2).toEqual({ x: 20, y: ASSISTANT_LINE.assistant2.y });
    expect(officialTargets(players, { x: 97, y: 30 }).assistant1.x).toBe(97);
    expect(officialTargets(players, { x: 10, y: 30 }).assistant2.x).toBe(10);
  });
  it('árbitro dentro del campo, cerca del balón y sin saltos al cruzar el medio', () => {
    for (const b of [{ x: 0, y: 0 }, { x: 105, y: 68 }, { x: 52.5, y: 34 }]) {
      const r = officialTargets(players, b).referee;
      expect(r.x).toBeGreaterThanOrEqual(3); expect(r.x).toBeLessThanOrEqual(102); expect(r.y).toBeGreaterThanOrEqual(3); expect(r.y).toBeLessThanOrEqual(65);
    }
    const a = officialTargets(players, { x: 52.4, y: 34 }).referee, b = officialTargets(players, { x: 52.6, y: 34 }).referee;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(.5);
    const kick = officialTargets(players, { x: 52.5, y: 34 }).referee;
    expect(Math.hypot(kick.x - 52.5, kick.y - 34)).toBeGreaterThanOrEqual(5.9); // no se planta encima del balón
  });
  it('con el balón en la boca de gol el árbitro no se mete en el área pequeña (pulido 2)', () => {
    for (const b of [{ x: 104.5, y: 34 }, { x: .5, y: 34 }, { x: 100, y: 30 }]) {
      const r = officialTargets(players, b).referee;
      expect(r.x).toBeGreaterThanOrEqual(REFEREE_DEPTH); expect(r.x).toBeLessThanOrEqual(105 - REFEREE_DEPTH);
    }
  });
  it('se mueve con velocidad máxima y salta en cortes o rebobinados', () => {
    const start = stepOfficial(null, { x: 50, y: 30 }, 1000, false, 7);
    const next = stepOfficial(start, { x: 90, y: 30 }, 2000, false, 7);
    expect(next.x - start.x).toBeLessThanOrEqual(7 + 1e-9);
    expect(next.run).toBeGreaterThan(0);
    expect(stepOfficial(next, { x: 10, y: 10 }, 2100, true, 7)).toMatchObject({ x: 10, y: 10 });
    expect(stepOfficial(next, { x: 10, y: 10 }, 500, false, 7)).toMatchObject({ x: 10, y: 10 });
  });
  it('cada sprite elegido existe: corre, espera, pita en el gol y el asistente levanta el banderín en su banda', () => {
    const st = (x: number, y: number, vx = 0, vy = 0) => ({ x, y, vx, vy, clockMs: 10_400, run: 3.3 });
    const goal = cue('goal', ['a9'], { side: 'away' }), throwIn = cue('restart', ['h3'], {});
    const picks = [
      chooseOfficialSprite('referee', st(50, 30), { x: 60, y: 30 }, null),
      chooseOfficialSprite('referee', st(50, 30, 5, 1), { x: 60, y: 30 }, null),
      chooseOfficialSprite('referee', st(50, 30), { x: 60, y: 30 }, goal),
      chooseOfficialSprite('assistant1', st(80, -1.8), { x: 80, y: 0 }, throwIn),
      chooseOfficialSprite('assistant1', st(80, -1.8, 3, 0), { x: 70, y: 30 }, null),
      chooseOfficialSprite('assistant2', st(20, 69.8), { x: 20, y: 40 }, null),
    ];
    expect(picks.map(p => p.anim)).toEqual(['idle', 'run', 'ref-whistle', 'ar-flag', 'ar-run', 'ar-idle']);
    expect(picks[4].dir).toBe(0); // de lado, mirando al campo
    for (const p of picks) expect(frames[spriteKey(p)], spriteKey(p)).toBeDefined();
    // El banderín no se levanta por un saque en la otra banda.
    expect(chooseOfficialSprite('assistant2', st(20, 69.8), { x: 80, y: 0 }, throwIn).anim).toBe('ar-idle');
  });
});

describe('estirada del portero con el balón grabado (TP222)', () => {
  // Demo Arsenal 2003/04 – Man City 2024/25, semilla 43, GRF: tiro de Gilberto Silva grabado a 408 870 ms y gol (cambio
  // de marcador) a 409 500 ms, 6:49 del reloj. Muestras 4088–4095 de la grabación: balón (x, y, z) y portero visitante.
  const samples: [number, [number, number, number], [number, number]][] = [
    [408_800, [88.8, 35.9, .11], [101.1, 35.0]], [408_900, [89.8, 35.5, .19], [100.5, 34.9]], [409_000, [93.0, 35.1, .54], [99.9, 34.8]],
    [409_100, [96.1, 34.7, .79], [99.3, 34.7]], [409_200, [99.0, 34.4, .96], [98.8, 34.7]], [409_300, [101.8, 34.1, 1.05], [98.5, 34.6]],
    [409_400, [104.5, 33.8, 1.06], [98.4, 34.6]], [409_500, [107.1, 33.5, 1.0], [98.4, 34.6]], [409_600, [109.2, 33.2, .86], [98.4, 34.6]],
    [409_700, [109.5, 33.0, .63], [98.4, 34.6]],
  ];
  const shot = cue('shot', ['h-silva'], { side: 'home', t1_ms: 408_870 }), goal = cue('goal', ['h-silva'], { side: 'home', t1_ms: 409_500 });
  const pose = (k: number) => {
    const [t, [bx, by, bz], [kx, ky]] = samples[k], [, [px, py, pz]] = samples[k - 1];
    const scoring = t >= 409_500;
    return chooseSprite({ ...base, key: 'a1', role: 'GK', side: 'away', x: kx, y: ky, clockMs: t, ball: { x: bx, y: by, z: bz },
      ballVelocity: { x: (bx - px) / .1, y: (by - py) / .1, z: (bz - pz) / .1 }, cue: scoring ? goal : shot, concedingKeeper: scoring });
  };
  it('empieza a estirarse antes de que el balón le llegue, no en el gol (antes, 300 ms tarde)', () => {
    const anims = samples.slice(1).map((_, i) => pose(i + 1));
    const firstDive = samples[1 + anims.findIndex(a => a.anim.startsWith('gk-dive'))][0];
    expect(firstDive).toBe(409_100);                       // el balón cruza su altura (98,8 m) hacia 409 200
    expect(firstDive).toBeLessThan(409_500);
    expect(pose(4)).toMatchObject({ frame: 1 });             // en vuelo cuando el balón pasa
    expect(pose(4).anim).toMatch(/-high$/);                  // balón a ~1 m de altura
    // Sigue la misma estirada al llegar el gol (no vuelve a empezar) y tendido después.
    expect(anims.slice(2).every(a => a.anim === pose(4).anim)).toBe(true);
    expect(pose(7).frame).toBe(2); expect(pose(9).frame).toBe(2);
  });
  it('solo con un balón que va a su portería; sin trayectoria, sigue el evento', () => {
    expect(keeperDiveTiming({ x: 100, y: 34 }, { x: 90, y: 34 }, { x: 20, y: 0 })!.ageMs).toBeCloseTo(DIVE.leadMs - 500);
    expect(keeperDiveTiming({ x: 100, y: 34 }, { x: 90, y: 34 }, { x: -20, y: 0 })).toBeNull();    // se aleja
    expect(keeperDiveTiming({ x: 100, y: 34 }, { x: 90, y: 34 }, { x: 5, y: 0 })).toBeNull();      // rueda despacio
    expect(keeperDiveTiming({ x: 100, y: 34 }, { x: 90, y: 34 }, { x: 10, y: 10 })).toBeNull();    // fuera de la boca
    expect(keeperDiveTiming({ x: 3, y: 34 }, { x: 20, y: 30 }, { x: -25, y: 1 })!.lateral).toBeLessThan(5);
    const gk: SpriteInput = { ...base, key: 'a1', role: 'GK', side: 'away', x: 100, y: 34, ball: { x: 70, y: 34, z: 0 } };
    expect(chooseSprite({ ...gk, cue: cue('shot', ['h9'], { side: 'home' }) }).anim).toBe('gk-ready');       // sin velocidad: no se inventa
    expect(chooseSprite({ ...gk, cue: cue('shot', ['a9'], { side: 'away' }), ballVelocity: { x: 30, y: 0 } }).anim).not.toMatch(/dive/); // tiro propio
  });
});

describe('gestos de los árbitros solo con eventos grabados (TP222)', () => {
  const st = (x: number, y: number) => ({ x, y, vx: 0, vy: 0, clockMs: 10_400, run: 0 });
  it('tarjeta solo con una tarjeta grabada, mirando al amonestado', () => {
    const card = cue('card', ['h4'], { side: 'home', card: 'red' });
    const pick = chooseOfficialSprite('referee', st(50, 30), { x: 60, y: 30 }, card, { x: 50, y: 20 });
    expect(pick.anim).toBe('ref-card');
    expect(DIRECTIONS[pick.dir]).toBe('W');                   // y menor = izquierda de la pantalla
    expect(frames[spriteKey(pick)]).toBeDefined();
    for (const type of ['goal', 'foul', 'shot', 'save', 'offside'] as const) expect(chooseOfficialSprite('referee', st(50, 30), null, cue(type, ['h4'])).anim).not.toBe('ref-card');
    expect(chooseOfficialSprite('referee', st(50, 30), null, cue('foul', ['h4'])).anim).toBe('ref-whistle');
    expect(chooseOfficialSprite('referee', { ...st(50, 30), clockMs: 13_000 }, null, card).anim).toBe('idle');
  });
  it('banderín por fuera de juego grabado: el asistente de esa mitad', () => {
    const off = cue('offside', ['a7'], { side: 'away', at: { x: 22, y: 40 } });
    expect(chooseOfficialSprite('assistant2', st(22, 69.8), { x: 30, y: 30 }, off).anim).toBe('ar-flag');
    expect(chooseOfficialSprite('assistant1', st(80, -1.8), { x: 30, y: 30 }, off).anim).toBe('ar-idle');
    expect(chooseOfficialSprite('assistant2', st(22, 69.8), { x: 30, y: 30 }, cue('offside', ['a7'])).anim).toBe('ar-idle'); // sin sitio grabado
  });
});

describe('balón contra la red tras un gol (pulido 2)', () => {
  it('entre los postes y más allá del fondo se pinta en la red; fuera de los postes no se toca', () => {
    expect(ballInNet({ x: 110, y: 34, z: 3 })).toEqual({ x: 105 + NET_DEPTH, y: 34, z: 2.2 });
    expect(ballInNet({ x: -4, y: 36, z: .3 })).toEqual({ x: -NET_DEPTH, y: 36, z: .3 });
    expect(ballInNet({ x: 106, y: 34, z: 1 })).toEqual({ x: 106, y: 34, z: 1 });
    const wide = { x: 110, y: 45, z: 0 };
    expect(ballInNet(wide)).toBe(wide);
    const inPlay = { x: 80, y: 34, z: 5 };
    expect(ballInNet(inPlay)).toBe(inPlay);
  });
});
