// TP247 (25-oct: «en FIFA tiene varios apartados»): salida de los equipos al estadio antes del saque inicial.
// Fotogramas sintéticos, solo de presentación: los dos equipos salen del túnel (banda de la cámara, y = 68) en dos
// filas, forman junto a la línea de medio campo y, al terminar, la emisión corta al saque inicial grabado.
import type { SceneFrame } from '../match/retroScene';

type Player = SceneFrame['players'][number];

export const WALKOUT_STEP_MS = 1000 / 60;
const TUNNEL = { x: 52.5, y: 71 };
const LINE_Y = 63, GAP = 1.25, LANE = 1.4, RADIUS = 1.2, SPEED = 1.5, RAMP_S = .8, HOLD_MS = 1400;
const ROLE_ORDER: Record<Player['role'], number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

const ordered = (players: readonly Player[], side: Player['side']) =>
  players.filter(p => p.side === side).map((p, i) => ({ p, i })).sort((a, b) => ROLE_ORDER[a.p.role] - ROLE_ORDER[b.p.role] || a.i - b.i).map(x => x.p);

/** Duración total de la salida para esa alineación: la última pareja llega y todos esperan formados. */
export function walkoutDuration(kickoff: SceneFrame): number {
  const files = Math.max(ordered(kickoff.players, 'home').length, ordered(kickoff.players, 'away').length);
  return files ? (pathLength(files) / SPEED + RAMP_S) * 1000 + HOLD_MS : 0;
}

const pathLength=(count:number)=>TUNNEL.y-(LINE_Y+RADIUS)+Math.PI*RADIUS/2+2+(count-1)*GAP-RADIUS;
function travel(time:number,length:number){
  const duration=length/SPEED+RAMP_S,t=Math.max(0,Math.min(duration,time));
  if(t<RAMP_S)return SPEED*t*t/(2*RAMP_S);
  if(t>duration-RAMP_S)return length-SPEED*(duration-t)**2/(2*RAMP_S);
  return SPEED*(t-RAMP_S/2);
}

/** Fotograma de la salida en `tMs`: cada pareja sale del túnel con un pequeño desfase y anda hasta su sitio en la fila. */
export function walkoutFrame(kickoff: SceneFrame, tMs: number): SceneFrame {
  const place = (list: Player[], dir: -1 | 1) => list.flatMap((p, i) => {
    const distance=travel(Math.max(0,tMs)/1000,pathLength(list.length)),laneX=TUNNEL.x+dir*LANE;
    // A real queue behind the entrance, not22 bodies superimposed at one point.
    if(distance<i*GAP)return [];
    const down=TUNNEL.y+i*GAP-(LINE_Y+RADIUS),arc=Math.PI*RADIUS/2;
    if(distance<=down)return [{...p,x:laneX,y:TUNNEL.y+i*GAP-distance}];
    if(distance<=down+arc){const a=(distance-down)/RADIUS;return [{...p,x:laneX+dir*RADIUS*(1-Math.cos(a)),y:LINE_Y+RADIUS-RADIUS*Math.sin(a)}];}
    return [{...p,x:laneX+dir*(RADIUS+distance-down-arc),y:LINE_Y}];
  });
  return { ...kickoff, clock_ms: Math.max(0, tMs), ball: null, carrier: null, possession: null,
    players: [...place(ordered(kickoff.players, 'home'), -1), ...place(ordered(kickoff.players, 'away'), 1)] };
}

/** Foco de cámara de la salida: la fila que se va formando, delante del túnel. */
export const WALKOUT_FOCUS = { x: TUNNEL.x, y: LINE_Y + 2 };
