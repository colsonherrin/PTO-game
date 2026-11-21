import type { Game } from '../game/game';
import { BEACH_X0, BLOCK, CITY, NB, OCEAN_X, blockOrigin } from '../world/city';

/** North-up circular minimap centered on the player. */
export function drawMinimap(g: Game, c: HTMLCanvasElement, night: number) {
  const ctx = c.getContext('2d')!;
  const W = c.width, H = c.height;
  const p = g.player;
  const scale = 0.85; // px per meter
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = night > 0.5 ? '#2a2f3d' : '#3a3f4b';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.scale(scale, scale);
  ctx.translate(-p.x, -p.z);
  // outskirts
  ctx.fillStyle = '#6f9e5c'; ctx.fillRect(-80, -80, CITY + 160, 74); ctx.fillRect(-80, CITY + 6, CITY + 160, 80); ctx.fillRect(-80, -6, 74, CITY + 12);
  ctx.fillStyle = '#e9d5a6'; ctx.fillRect(BEACH_X0, -80, OCEAN_X - BEACH_X0, CITY + 160);
  ctx.fillStyle = '#2f93b5'; ctx.fillRect(OCEAN_X, -400, 600, 1000);
  // blocks
  for (let bx = 0; bx < NB; bx++) for (let bz = 0; bz < NB; bz++) {
    const ox = blockOrigin(bx), oz = blockOrigin(bz);
    ctx.fillStyle = bx === 1 && bz === 2 ? '#79b26a' : bx === 1 && bz === 1 ? '#e6dac2' : '#d6cfc0';
    ctx.fillRect(ox, oz, BLOCK, BLOCK);
  }
  ctx.fillStyle = 'rgba(70,78,96,.75)';
  for (const b of g.city.buildingsForMap) ctx.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  // POI dots
  ctx.font = 'bold 9px sans-serif';
  for (const poi of g.city.pois) {
    const col = poi.kind === 'food' ? '#ff9f43' : poi.kind === 'work' ? '#54a0ff' : poi.kind === 'home' ? '#c8d6e5' : poi.kind === 'shop' ? '#feca57' : poi.kind === 'service' ? '#ff6b6b' : '#1dd1a1';
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(poi.spot[0], poi.spot[1], 2.6, 0, Math.PI * 2); ctx.fill();
  }
  // vehicles
  for (const v of g.vehicles) {
    ctx.save(); ctx.translate(v.x, v.z); ctx.rotate(-v.yaw);
    ctx.fillStyle = v.owner === 'player' || v.owner === 'rental' ? '#ffd166' : v.forSale ? '#feca57' : 'rgba(255,255,255,.55)';
    ctx.fillRect(-1, -2, 2, 4); ctx.restore();
  }
  // NPCs
  for (const n of g.npcs) {
    if (n.hidden) continue;
    const met = n.chat.length > 0;
    ctx.fillStyle = n.mode === 'following' ? '#3ddc97' : n.p.isCop ? '#4d7cff' : met ? (n.relationship >= 15 ? '#3ddc97' : n.relationship <= -15 ? '#ff5d73' : '#fff') : n.important ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.arc(n.x, n.z, n.important ? 1.9 : 1.3, 0, Math.PI * 2); ctx.fill();
  }
  // objective
  const t = g.dialogue.objectiveTarget();
  ctx.restore();
  ctx.save();
  if (t) {
    let dx = (t[0] - p.x) * scale, dz = (t[1] - p.z) * scale;
    const d = Math.hypot(dx, dz), R = W / 2 - 10;
    if (d > R) { dx = (dx / d) * R; dz = (dz / d) * R; }
    ctx.fillStyle = '#ffd166'; ctx.strokeStyle = '#2a1c00'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2 + dx, H / 2 + dz, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // player arrow
  const yaw = p.vehicleId || p.passengerIn ? g.vehById.get((p.vehicleId ?? p.passengerIn)!)!.yaw : p.yaw;
  ctx.translate(W / 2, H / 2); ctx.rotate(-yaw);
  ctx.fillStyle = '#ff6b6b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(5.5, -5); ctx.lineTo(0, -2); ctx.lineTo(-5.5, -5); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  // camera-facing indicator (N)
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', W / 2, 13);
}
