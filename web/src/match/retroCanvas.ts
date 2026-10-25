import { RETRO, SPRITE_STATES, type RetroScene, type SceneFrame } from './retroScene';

export const atlasUrl = new URL('../../../assets/art/retro/football-sprites.svg', import.meta.url).href;
const colors = ['#d3302c', '#5bb7dd', '#efb526', '#994871'];
const glyphs: Record<string, string> = {
  A:'01110/10001/11111/10001/10001',B:'11110/10001/11110/10001/11110',C:'01111/10000/10000/10000/01111',
  D:'11110/10001/10001/10001/11110',E:'11111/10000/11110/10000/11111',F:'11111/10000/11110/10000/10000',
  G:'01111/10000/10111/10001/01111',H:'10001/10001/11111/10001/10001',I:'111/010/010/010/111',
  J:'00111/00010/00010/10010/01100',K:'10001/10010/11100/10010/10001',L:'10000/10000/10000/10000/11111',
  M:'10001/11011/10101/10001/10001',N:'10001/11001/10101/10011/10001',O:'01110/10001/10001/10001/01110',
  P:'11110/10001/11110/10000/10000',Q:'01110/10001/10001/10011/01111',R:'11110/10001/11110/10010/10001',
  S:'01111/10000/01110/00001/11110',T:'11111/00100/00100/00100/00100',U:'10001/10001/10001/10001/01110',
  V:'10001/10001/10001/01010/00100',W:'10001/10001/10101/11011/10001',X:'10001/01010/00100/01010/10001',
  Y:'10001/01010/00100/00100/00100',Z:'11111/00010/00100/01000/11111',
  '0':'111/101/101/101/111','1':'010/110/010/010/111','2':'111/001/111/100/111','3':'111/001/111/001/111',
  '4':'101/101/111/001/001','5':'111/100/111/001/111','6':'111/100/111/101/111','7':'111/001/010/010/010',
  '8':'111/101/111/101/111','9':'111/101/111/001/111',':':'0/1/0/1/0','-':'000/000/111/000/000',
  '/':'00001/00010/00100/01000/10000','!':'1/1/1/0/1','.':'0/0/0/0/1',
};
function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color: string, scale = 1, limit = 384) {
  ctx.fillStyle = color;
  for (const ch of value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()) {
    const rows = (glyphs[ch] ?? '000/000/000/000/000').split('/');
    if (x + rows[0].length * scale > limit) break;
    rows.forEach((row, iy) => [...row].forEach((bit, ix) => { if (bit === '1') ctx.fillRect(x + ix * scale, y + iy * scale, scale, scale); }));
    x += (rows[0].length + 1) * scale;
  }
}

export function drawRetro(ctx: CanvasRenderingContext2D, frame: SceneFrame, scene: RetroScene,
  atlas: HTMLImageElement | null, selected: string, labels: { home: string; away: string; clock: string; goal: string }) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#182421'; ctx.fillRect(0, 0, RETRO.width, RETRO.height);
  ctx.save(); ctx.beginPath(); ctx.rect(0, RETRO.top, RETRO.width, RETRO.bottom - RETRO.top); ctx.clip();
  const { sx, sy, ox, oy } = scene.transform;
  const point = (x: number, y: number) => [Math.round(ox + x * sx), Math.round(oy + y * sy)] as const;
  const box = (x: number, y: number, w: number, h: number, fill: string) => {
    const [px, py] = point(x, y); ctx.fillStyle = fill; ctx.fillRect(px, py, Math.round(w * sx), Math.round(h * sy));
  };
  ctx.strokeStyle = '#b5d5a6'; ctx.lineWidth = 1;
  const line = (x: number, y: number, endX: number, endY: number) => {
    ctx.beginPath(); ctx.moveTo(...point(x, y)); ctx.lineTo(...point(endX, endY)); ctx.stroke();
  };
  const outline = (x: number, y: number, w: number, h: number) => ctx.strokeRect(...point(x, y), Math.round(w * sx), Math.round(h * sy));
  box(-4, -4, 113, 76, '#316b32');
  for (let stripe = 0; stripe < 21; stripe++) box(stripe * 5, 0, 5, 68, stripe % 2 ? '#438b38' : '#3d8032');
  ctx.fillStyle = '#428638';
  for (let i = 0; i < 400; i++) { const [x, y] = point((i * 47 % 1050) / 10, (i * 31 % 680) / 10); ctx.fillRect(x, y, 1, 1); }
  outline(0, 0, 105, 68); line(52.5, 0, 52.5, 68);
  ctx.beginPath(); ctx.ellipse(...point(52.5, 34), 9.15 * sx, 9.15 * sy, 0, 0, Math.PI * 2); ctx.stroke();
  for (const x of [0, 88.5]) outline(x, 13.85, 16.5, 40.3);
  for (const x of [0, 99.5]) outline(x, 24.85, 5.5, 18.3);
  for (const x of [11, 52.5, 94]) box(x - .3, 33.7, .6, .6, '#b5d5a6');
  for (const x of [-3, 105]) {
    box(x, 30.34, 3, 7.32, '#6d8176');
    for (let y = 30.34; y <= 37.66; y += .8) line(x, y, x + 3, y);
    for (let xx = x; xx <= x + 3; xx += .6) line(xx, 30.34, xx, 37.66);
    outline(x, 30.34, 3, 7.32);
  }
  for (const p of [...scene.players].sort((a, b) => a.py - b.py)) {
    if (p.px < -16 || p.px > 400 || p.py < 24 || p.py > 250) continue;
    ctx.fillStyle = '#285b2b'; ctx.beginPath(); ctx.ellipse(p.px + 1, p.py, 5 * p.spriteScale, 2 * p.spriteScale, 0, 0, Math.PI * 2); ctx.fill();
    const width = Math.round(16 * p.spriteScale), height = Math.round(18 * p.spriteScale);
    if (atlas) ctx.drawImage(atlas, p.direction * 16, (p.palette * 7 + SPRITE_STATES.indexOf(p.state)) * 18, 16, 18,
      p.px - Math.round(8 * p.spriteScale), p.py - Math.round(16 * p.spriteScale), width, height);
    else { ctx.fillStyle = colors[p.palette]; ctx.fillRect(p.px - 3, p.py - 10, 6, 7); ctx.fillStyle = '#d0a977'; ctx.fillRect(p.px - 2, p.py - 14, 4, 4); }
    if (p.key === selected) {
      ctx.strokeStyle = '#fff2a1'; ctx.strokeRect(p.px - width / 2 - 1, p.py - height + 1, width + 2, height + 2);
      text(ctx, String(p.slot + 1), p.px - 2, p.py - height - 5, '#fff2a1');
    } else if (p.key === frame.carrier) {
      ctx.fillStyle = '#fff2a1'; ctx.fillRect(p.px - 2, p.py - height - 2, 5, 1); ctx.fillRect(p.px - 1, p.py - height - 1, 3, 1);
    }
  }
  const ball = scene.ball;
  if(ball){
  ctx.fillStyle = '#1b4826'; ctx.fillRect(ball.px - 1, ball.py + 1, 5, 2);
  ctx.fillStyle = '#263c30'; ctx.fillRect(ball.px - 2, ball.py - 2, 5, 5);
  ctx.fillStyle = '#f1f2dd'; ctx.fillRect(ball.px - 1, ball.py - 2, 3, 4);
  ctx.fillStyle = '#65785e'; ctx.fillRect(ball.px, ball.py, 1, 1);
  }
  if (scene.goal) { ctx.fillStyle = '#182421'; ctx.fillRect(145, 34, 94, 18); text(ctx, labels.goal, 156, 38, '#eef443', 2, 236); }
  ctx.restore();
  ctx.fillStyle = '#182421'; ctx.fillRect(0, 0, 384, 24); ctx.fillRect(0, 232, 384, 24);
  ctx.fillStyle = '#7da68b'; ctx.fillRect(0, 23, 384, 1); ctx.fillRect(0, 232, 384, 1);
  text(ctx, 'TIMEPITCH', 6, 3, '#dfe47d'); text(ctx, labels.clock, 324, 3, '#e0edc7');
  text(ctx, labels.home, 6, 14, '#f4c5bd', 1, 154);
  text(ctx, frame.score?`${frame.score.home}-${frame.score.away}`:'--', 172, 11, '#e4efbd', 2, 216);
  text(ctx, labels.away, 229, 14, '#afe1ee', 1, 379);
  const person = scene.players.find(p => p.key === selected);
  text(ctx, person ? `${person.slot + 1} / ${person.name}` : `${labels.home} / ${labels.away}`, 6, 239, '#d5e4c4', 1, 316);
  ctx.fillStyle = '#315b32'; ctx.fillRect(328, 235, 50, 18); ctx.strokeStyle = '#7da68b'; ctx.strokeRect(328, 235, 50, 18);
  for (const p of scene.players) { ctx.fillStyle = p.key === selected ? '#fff2a1' : colors[p.palette]; ctx.fillRect(328 + p.x / 105 * 49, 235 + p.y / 68 * 17, 2, 2); }
  if(frame.ball){ctx.fillStyle = '#fff'; ctx.fillRect(328 + frame.ball.x / 105 * 49, 235 + frame.ball.y / 68 * 17, 1, 1);}
}
