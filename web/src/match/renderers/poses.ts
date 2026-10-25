import { PLAYER_LEG_LENGTH, PLAYER_VISUAL_SCALE, type PlayerArt } from './three-art';
import type { PitchRenderInput } from './types';

type JointAngle = Readonly<{ x: number; z: number; bend?: number }>;
export type PlayerPose = Readonly<{
  facing: number;
  action: 'idle' | 'run' | 'kick' | 'header' | 'celebrate';
  bodyLean: number;
  bodyOffsetY: number;
  limbs: Readonly<{ leftArm: JointAngle; rightArm: JointAngle; leftLeg: JointAngle; rightLeg: JointAngle }>;
}>;

// Illustrative body poses, not observed skeletal tracking. No mutable mixer or root motion.
export function derivePlayerPose(input: PitchRenderInput, playerKey: string): PlayerPose | null {
  const player = input.frame.players.find(p => p.key === playerKey);
  if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return null;
  const previous = input.previous.players.find(p => p.key === playerKey);
  const dx = previous ? player.x - previous.x : 0, dy = previous ? player.y - previous.y : 0;
  const distance = Math.hypot(dx, dy), dt = input.frame.clock_ms - input.previous.clock_ms;
  const cut = input.restarting || input.frame.period !== input.previous.period || !previous ||
    !Number.isFinite(dt) || dt <= 0 || !Number.isFinite(distance) || distance >= 3;
  const moving = !cut && distance > .005;
  const facing = moving ? Math.atan2(dx, dy) : player.side === 'home' ? Math.PI / 2 : -Math.PI / 2;
  const limbs = { leftArm: { x: 0, z: -.08, bend: 0 }, rightArm: { x: 0, z: .08, bend: 0 }, leftLeg: { x: 0, z: 0, bend: 0 }, rightLeg: { x: 0, z: 0, bend: 0 } };
  let action: PlayerPose['action'] = moving ? 'run' : 'idle';
  let bodyLean=0, bodyOffsetY=0;
  const age = input.cue ? input.frame.clock_ms - input.cue.t1_ms : -1;
  if (!cut && age >= 0) {
    if (age < 250 && (input.cue?.type === 'pass' || input.cue?.type === 'shot') && input.cue.participants[0] === playerKey) action = input.cue.bodyPart==='head'?'header':'kick';
    else if (age < 900 && input.cue?.type === 'goal' && input.cue.side === player.side) action = 'celebrate';
  }
  if (action === 'run') {
    let identityPhase = 0;
    for (let i = 0; i < playerKey.length; i++) identityPhase = (Math.imul(identityPhase, 31) + playerKey.charCodeAt(i)) >>> 0;
    const speed = Math.min(distance * 1000 / dt / 6, 1);
    const cycleMs = 500, stanceFraction = .32;
    const phase = input.frame.clock_ms / cycleMs * 2 * Math.PI + identityPhase % 1024 / 1024 * 2 * Math.PI;
    const swing = Math.sin(phase) * .52 * speed;
    bodyOffsetY = -.15 * speed;
    // Two-link leg solve: ground contact in stance, lifted foot in recovery.
    // This animates the mesh only; it is not skeletal tracking or root motion.
    for (const [leg, offset] of [[limbs.leftLeg, 0], [limbs.rightLeg, .5]] as const) {
      const cycle = ((phase / (2 * Math.PI) + offset) % 1 + 1) % 1;
      const stance = cycle < stanceFraction, t = stance ? cycle / stanceFraction : (cycle - stanceFraction) / (1 - stanceFraction);
      const progress = stance ? t : t * t * (3 - 2 * t);
      // At up to 6 m/s, stance cancels the source translation exactly for straight uniform travel.
      const halfStride = speed * 6 * (cycleMs / 1000) * stanceFraction / (2 * PLAYER_VISUAL_SCALE);
      const z = (stance ? 1 - 2 * progress : -1 + 2 * progress) * halfStride;
      const lift = stance ? 0 : .18 * speed * Math.sin(Math.PI * t) ** 2;
      const down = 2 * PLAYER_LEG_LENGTH + bodyOffsetY - lift, distance = Math.hypot(z, down);
      const knee = Math.acos(Math.max(-1, Math.min(1, (distance * distance - 2 * PLAYER_LEG_LENGTH ** 2) / (2 * PLAYER_LEG_LENGTH ** 2))));
      leg.x = Math.atan2(-z, down) - knee / 2; leg.bend = knee;
    }
    limbs.leftArm.x = -swing * .6; limbs.rightArm.x = swing * .6;
    limbs.leftArm.bend = limbs.rightArm.bend = -.8 * speed;
  } else if (action === 'kick') {
    const swing = Math.sin(Math.PI * age / 250);
    if(input.cue?.bodyPart==='left_foot'){limbs.leftLeg.x=-.95*swing;limbs.rightArm.x=-.4*swing;}
    else{limbs.rightLeg.x = -.95 * swing; limbs.leftArm.x = -.4 * swing;}
    const striking = input.cue?.bodyPart === 'left_foot' ? limbs.leftLeg : limbs.rightLeg;
    striking.bend = .65 * Math.sin(Math.PI * Math.min(age / 125, 1));
    limbs.leftArm.bend = limbs.rightArm.bend = -.35 * swing;
  } else if (action === 'header') {
    bodyLean=.15*Math.sin(Math.PI*age/250);
    limbs.leftArm.x=-.25;limbs.rightArm.x=-.25;
    limbs.leftArm.bend = limbs.rightArm.bend = -.55;
  } else if (action === 'celebrate') {
    limbs.leftArm.z = -2.7; limbs.rightArm.z = 2.7;
  }
  return { facing, action, bodyLean, bodyOffsetY, limbs };
}

export function applyPlayerPose(art: PlayerArt, pose: PlayerPose): void {
  art.body.rotation.y = pose.facing;
  art.body.rotation.x = pose.bodyLean;
  art.body.position.y = pose.bodyOffsetY;
  for (const key of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const) {
    art[key].rotation.set(pose.limbs[key].x, 0, pose.limbs[key].z);
  }
  art.leftKnee.rotation.x = pose.limbs.leftLeg.bend ?? 0;
  art.rightKnee.rotation.x = pose.limbs.rightLeg.bend ?? 0;
  art.leftElbow.rotation.x = pose.limbs.leftArm.bend ?? 0;
  art.rightElbow.rotation.x = pose.limbs.rightArm.bend ?? 0;
  art.leftAnkle.rotation.x = -pose.limbs.leftLeg.x - (pose.limbs.leftLeg.bend ?? 0);
  art.rightAnkle.rotation.x = -pose.limbs.rightLeg.x - (pose.limbs.rightLeg.bend ?? 0);
}
