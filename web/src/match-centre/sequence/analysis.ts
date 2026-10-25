import { validateSequenceEvents } from './evidence';
import type { PlayMoment, SequenceEvent, SequenceSource } from './types';

export function momentsAt(source: SequenceSource, elapsedMs: number, locale: 'en'|'es'): readonly PlayMoment[] {
  const events = validateSequenceEvents(source.events).filter(e => e.elapsedMs <= elapsedMs), es = locale === 'es';
  const names = new Map<string,string>();
  for (const f of source.frames) for (const p of f.players) {
    if (names.has(p.key) && names.get(p.key) !== p.name) throw new Error('Ambiguous sequence player');
    names.set(p.key,p.name);
  }
  const name = (id: string|null) => id === null ? null : names.get(id) ?? null;
  const linked = (a: SequenceEvent,b: SequenceEvent) => a.relatedIds.includes(b.id) && b.relatedIds.includes(a.id);
  const unique = (items: readonly SequenceEvent[]) => items.length === 1 ? items[0] : null;
  const result: PlayMoment[] = [];
  for (const e of events) {
    const actor = name(e.actorId); if (!actor) continue;
    const evidence: SequenceEvent[] = [e]; let title: string, explanation: string, shotXg: number|null = null;
    if (e.kind === 'Pass') {
      const recipient = name(e.recipientId);
      title = es ? `${actor}: pase` : `${actor} passes`;
      explanation = recipient ? (es ? `Pase de ${actor} a ${recipient}.` : `${actor} passes to ${recipient}.`) : (es ? `Pase registrado de ${actor}.` : `Recorded pass by ${actor}.`);
    } else if (e.kind === 'Carry') {
      title = es ? `${actor} conduce` : `${actor} carries`;
      explanation = es ? `Conducción registrada de ${actor}.` : `Recorded carry by ${actor}.`;
    } else if (e.kind === 'Ball Recovery') {
      title = es ? `${actor} recupera` : `${actor} recovers`;
      explanation = es ? `${actor} recupera el balón.` : `${actor} recovers the ball.`;
    } else if (e.kind === 'Shot' || e.kind === 'Block' || e.kind === 'Goal Keeper') {
      const shot = e.kind === 'Shot' ? e : unique(events.filter(s => s.kind === 'Shot' && linked(e,s)));
      if (!shot || !name(shot.actorId)) continue;
      if (e.kind === 'Goal Keeper' && (shot.outcome !== 'Saved' || e.outcome !== 'Shot Saved')) continue;
      if (e.kind === 'Block' && shot.outcome !== 'Blocked') continue;
      const shooter = name(shot.actorId)!; shotXg = shot.xg;
      const blockers = events.filter(b => b.kind === 'Block' && b.side !== null && b.side !== shot.side && name(b.actorId) && linked(b,shot));
      const blocker = unique(blockers);
      const keeper = unique(events.filter(k => k.kind === 'Goal Keeper' && k.outcome === 'Shot Saved' && k.side !== shot.side && name(k.actorId) && linked(k,shot)));
      evidence.push(shot); if (blocker) evidence.push(blocker); if (keeper) evidence.push(keeper);
      const body = shot.bodyPart === 'head' ? (es ? 'cabezazo' : 'header') : shot.bodyPart === 'left_foot' ? (es ? 'tiro con la izquierda' : 'left-footed shot') : (es ? 'tiro' : 'shot');
      title = shot.outcome === 'Goal' ? (es ? `Gol de ${shooter}` : `${shooter} scores`)
        : shot.outcome === 'Blocked' ? (es ? `Tiro de ${shooter} bloqueado` : `${shooter}'s shot is blocked`)
        : shot.outcome === 'Saved' ? (es ? `Remate de ${shooter} parado` : `${shooter}'s shot is saved`)
        : (es ? `Tiro de ${shooter}` : `${shooter} shoots`);
      explanation = es ? `${shooter}: ${body}${blocker ? ` bloqueado por ${name(blocker.actorId)}` : keeper ? ` parado por ${name(keeper.actorId)}` : ''}.`
        : `${shooter}'s ${body}${blocker ? ` is blocked by ${name(blocker.actorId)}` : keeper ? ` is saved by ${name(keeper.actorId)}` : ''}.`;
      // Chronology is observable; it does not prove a defensive intention or a causal link.
      if (blocker) {
        const header = events.filter(s => s.kind === 'Shot' && s.outcome === 'Saved' && s.side === shot.side && s.elapsedMs < shot.elapsedMs).at(-1);
        const savedBy = header && unique(events.filter(k => k.kind === 'Goal Keeper' && k.outcome === 'Shot Saved' && linked(k,header) && name(k.actorId)));
        const recovery = events.filter(r => r.kind === 'Ball Recovery' && r.actorId === shot.actorId && r.elapsedMs < shot.elapsedMs).at(-1);
        const carry = recovery && events.find(c => c.kind === 'Carry' && c.actorId === shot.actorId && c.relatedIds.includes(recovery.id) && c.relatedIds.includes(shot.id));
        if (header && savedBy && recovery && carry && name(header.actorId)) {
          explanation = (es ? `${name(savedBy.actorId)} para el cabezazo de ${name(header.actorId)}. ${shooter} recupera el balón. `
            : `${name(savedBy.actorId)} saves ${name(header.actorId)}'s header. ${shooter} recovers the ball. `) + explanation;
          evidence.push(header,savedBy,recovery,carry);
        }
      }
      const earlier = events.filter(s => s.kind === 'Shot' && s.side === shot.side && s.elapsedMs < shot.elapsedMs).at(-1);
      if (earlier && shot.possessionId !== null && earlier.possessionId === shot.possessionId && shot.elapsedMs - earlier.elapsedMs <= 2000) {
        explanation += es ? ` Dos tiros en ${((shot.elapsedMs-earlier.elapsedMs)/1000).toFixed(1)} s.` : ` Two shots in ${((shot.elapsedMs-earlier.elapsedMs)/1000).toFixed(1)} seconds.`;
        evidence.push(earlier);
      }
    } else continue;
    const ordered = [...new Map(evidence.map(item => [item.id,item])).values()].sort((a,b) => a.elapsedMs-b.elapsedMs || a.sourceIndex-b.sourceIndex);
    result.push({ id:e.id,atMs:e.elapsedMs,evidenceIds:ordered.map(e => e.id),actorIds:[...new Set(ordered.flatMap(e => e.actorId && name(e.actorId) ? [e.actorId] : []))],title,explanation,shotXg });
  }
  return result;
}
