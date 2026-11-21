import { NB, roadCenter, type City } from '../world/city';
import { angleWrap, clamp } from '../engine/math';
import { carLength, carObject, type CarType } from './models';
import type { Renderer } from '../engine/renderer';

export const LANE = 3.4;

// ---- Road grid helpers ----------------------------------------------------
export type Inter = [number, number];
export const interPos = (i: Inter): [number, number] => [roadCenter(i[0]), roadCenter(i[1])];
export function interNeighbors(i: Inter): Inter[] {
  const out: Inter[] = [];
  if (i[0] > 0) out.push([i[0] - 1, i[1]]);
  if (i[0] < NB) out.push([i[0] + 1, i[1]]);
  if (i[1] > 0) out.push([i[0], i[1] - 1]);
  if (i[1] < NB) out.push([i[0], i[1] + 1]);
  return out;
}
export const nearestInter = (x: number, z: number): Inter => [clamp(Math.round((x - roadCenter(0)) / (roadCenter(1) - roadCenter(0))), 0, NB), clamp(Math.round((z - roadCenter(0)) / (roadCenter(1) - roadCenter(0))), 0, NB)];
const same = (a: Inter, b: Inter) => a[0] === b[0] && a[1] === b[1];

export function routeBFS(from: Inter, to: Inter, avoidFirst?: Inter): Inter[] {
  const key = (i: Inter) => i[0] * 10 + i[1];
  const prev = new Map<number, Inter | null>([[key(from), null]]);
  const q: Inter[] = [from];
  while (q.length) {
    const c = q.shift()!;
    if (same(c, to)) break;
    for (const n of interNeighbors(c)) {
      if (prev.has(key(n))) continue;
      if (avoidFirst && same(c, from) && same(n, avoidFirst)) continue;
      prev.set(key(n), c); q.push(n);
    }
  }
  if (!prev.has(key(to))) return [to];
  const out: Inter[] = [];
  let c: Inter | null = to;
  while (c) { out.push(c); c = prev.get(key(c)) ?? null; }
  return out.reverse();
}

/** Find the lane stopping point next to a sidewalk location and the directed edge that reaches it. */
export function curbApproach(x: number, z: number): { a: Inter; b: Inter; px: number; pz: number } {
  let best = { a: [0, 0] as Inter, b: [1, 0] as Inter, px: 0, pz: 0, d: Infinity };
  for (let i = 0; i <= NB; i++) for (let j = 0; j <= NB; j++) {
    for (const n of interNeighbors([i, j])) {
      const [ax, az] = interPos([i, j]), [bx, bz] = interPos(n);
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
      const rx = -uz, rz = ux; // right side of travel
      let t = (x - ax) * ux + (z - az) * uz;
      t = clamp(t, 12, L - 12);
      const cx = ax + ux * t, cz = az + uz * t;
      // only the edge whose right side faces the target
      const side = (x - cx) * rx + (z - cz) * rz;
      if (side <= 0) continue;
      const px = cx + rx * (LANE + 1.6), pz = cz + rz * (LANE + 1.6);
      const d = Math.hypot(px - x, pz - z);
      if (d < best.d) best = { a: [i, j], b: n, px, pz, d };
    }
  }
  return best;
}

// ---- Vehicle ---------------------------------------------------------------
export interface TrafficAI { from: Inter; to: Inter; blocked: number; route: Inter[] | null; stopAt: { x: number; z: number } | null; arrived: boolean; cruise: number }

export class Vehicle {
  id: string;
  type: CarType;
  color: string;
  name: string;
  obj: any;
  private wheelSpin = 0;
  x: number; z: number; yaw: number;
  speed = 0;
  steer = 0;
  length: number;
  driver: string | null = null; // 'player' | npc id | 'traffic'
  passenger: string | null = null;
  owner: string; // 'player' | 'rental' | npc id | 'traffic' | 'dealer'
  forSale: string | null = null;
  ai: TrafficAI | null = null;
  health = 100;
  hornUntil = 0;
  lastCrash = 0;

  constructor(r: Renderer, id: string, type: CarType, color: string, x: number, z: number, yaw: number, owner: string, name?: string) {
    this.id = id; this.type = type; this.color = color; this.x = x; this.z = z; this.yaw = yaw; this.owner = owner;
    this.obj = carObject(type, color);
    r.scene.add(this.obj);
    this.length = carLength(type);
    this.name = name ?? ({ hatch: 'hatchback', sedan: 'sedan', pickup: 'pickup', taxi: 'taxi', police: 'police cruiser', van: 'van' }[type]);
  }

  get fx() { return Math.sin(this.yaw); }
  get fz() { return Math.cos(this.yaw); }

  circles(): [number, number][] {
    const o = this.length / 2 - 0.95;
    return [[this.x + this.fx * o, this.z + this.fz * o], [this.x, this.z], [this.x - this.fx * o, this.z - this.fz * o]];
  }

  /** Arcade bicycle-model driving. Returns impact speed if a collision occurred. */
  drive(dt: number, throttle: number, brake: number, steerIn: number, handbrake: boolean, city: City): number {
    const maxF = 26, maxR = 7;
    if (throttle > 0) {
      if (this.speed < -0.5) this.speed += 20 * dt;
      else this.speed += throttle * (10 - Math.max(0, this.speed) * 0.25) * dt;
    }
    if (brake > 0) {
      if (this.speed > 0.5) this.speed -= 22 * brake * dt;
      else this.speed -= 6 * brake * dt;
    }
    if (handbrake) this.speed *= Math.pow(0.15, dt);
    if (!throttle && !brake) this.speed *= Math.pow(0.6, dt);
    this.speed = clamp(this.speed, -maxR, maxF);
    if (Math.abs(this.speed) < 0.05 && !throttle && !brake) this.speed = 0;
    const steerMax = 0.62 - Math.min(Math.abs(this.speed), 24) * 0.016;
    this.steer += (steerIn * steerMax - this.steer) * Math.min(1, dt * 7);
    const wb = this.length * 0.62;
    this.yaw = angleWrap(this.yaw + (this.speed / wb) * Math.tan(this.steer) * dt * (handbrake ? 1.5 : 1));
    this.x += this.fx * this.speed * dt;
    this.z += this.fz * this.speed * dt;
    return this.collideWorld(city);
  }

  collideWorld(city: City): number {
    let impact = 0;
    for (const [cx0, cz0] of this.circles()) {
      let cx = cx0, cz = cz0;
      const r = 0.95;
      for (const c of city.query(cx, cz, 2)) {
        if (c.y1 < 0.5) continue;
        const nx = clamp(cx, c.x0, c.x1), nz = clamp(cz, c.z0, c.z1);
        const dx = cx - nx, dz = cz - nz, d = Math.hypot(dx, dz);
        if (d < r) {
          const push = d > 1e-4 ? (r - d) : r;
          const ux = d > 1e-4 ? dx / d : (cx - (c.x0 + c.x1) / 2 > 0 ? 1 : -1), uz = d > 1e-4 ? dz / d : 0;
          this.x += ux * push; this.z += uz * push; cx += ux * push; cz += uz * push;
          const along = Math.abs(this.fx * ux + this.fz * uz);
          if (along > 0.3) { impact = Math.max(impact, Math.abs(this.speed) * along); this.speed *= -0.25; }
          else this.speed *= 0.97;
        }
      }
    }
    return impact;
  }

  /** Sync the 3D model with the simulation state. */
  draw(dt: number, visible: boolean) {
    this.obj.visible = visible;
    if (!visible) return;
    this.obj.position.set(this.x, 0, this.z);
    this.obj.rotation.set(0, this.yaw, -this.steer * Math.min(Math.abs(this.speed) / 25, 1) * 0.06, 'YXZ');
    this.wheelSpin += (this.speed / 0.33) * dt;
    const ws = this.obj.userData.wheels as any[];
    for (let i = 0; i < ws.length; i++) { ws[i].rotation.x = this.wheelSpin; ws[i].rotation.y = ws[i].position.z > 0 ? this.steer * 0.8 : 0; ws[i].rotation.order = 'YXZ'; }
  }

  /** Point beside the driver door for exiting (sidewalk side preference handled by caller). */
  sidePoint(side: 1 | -1 = 1): [number, number] {
    const rx = -this.fz, rz = this.fx;
    return [this.x + rx * 1.6 * side, this.z + rz * 1.6 * side];
  }

  // ---- Traffic / NPC driving -----------------------------------------------
  initTraffic(from: Inter, to: Inter, cruise = 10) {
    this.ai = { from, to, blocked: 0, route: null, stopAt: null, arrived: false, cruise };
    const [ax, az] = interPos(from), [bx, bz] = interPos(to);
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const t = 15 + Math.random() * (L - 30);
    this.x = ax + ux * t - uz * LANE; this.z = az + uz * t + ux * LANE;
    this.yaw = Math.atan2(ux, uz);
  }

  /** Send an AI-driven car to a curb location via the road grid. */
  routeTo(x: number, z: number) {
    const appr = curbApproach(x, z);
    const here = this.currentEdge();
    if (same(here.from, appr.a) && same(here.to, appr.b)) {
      const [ax, az] = interPos(appr.a), [bx, bz] = interPos(appr.b);
      const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      const tCar = (this.x - ax) * ux + (this.z - az) * uz, tStop = (appr.px - ax) * ux + (appr.pz - az) * uz;
      if (tStop - tCar > 6) {
        this.ai = { from: appr.a, to: appr.b, blocked: 0, route: [], stopAt: { x: appr.px, z: appr.pz }, arrived: false, cruise: 12 };
        return;
      }
    }
    const route = routeBFS(here.to, appr.a, here.from);
    if (!same(route[route.length - 1], appr.b)) route.push(appr.b);
    this.ai = { from: here.from, to: route[0], blocked: 0, route: route.slice(1), stopAt: { x: appr.px, z: appr.pz }, arrived: false, cruise: 12 };
    if (same(this.ai.to, this.ai.from) && this.ai.route!.length) this.ai.to = this.ai.route!.shift()!;
  }

  /** Estimate which directed road edge the car is on from its position + heading. */
  currentEdge(): { from: Inter; to: Inter } {
    const n = nearestInter(this.x + this.fx * 6, this.z + this.fz * 6);
    const ahead = nearestInter(this.x + this.fx * 40, this.z + this.fz * 40);
    let best: { from: Inter; to: Inter } = { from: n, to: interNeighbors(n)[0] };
    let bd = -Infinity;
    for (let i = 0; i <= NB; i++) for (let j = 0; j <= NB; j++) for (const nb of interNeighbors([i, j])) {
      const [ax, az] = interPos([i, j]), [bx, bz] = interPos(nb);
      const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      const t = (this.x - ax) * ux + (this.z - az) * uz;
      if (t < -8 || t > L + 8) continue;
      const lat = Math.abs((this.x - ax) * -uz + (this.z - az) * ux);
      if (lat > 9) continue;
      const score = (this.fx * ux + this.fz * uz) * 10 - lat * 0.5 - (same(nb, ahead) ? 0 : 1);
      if (score > bd) { bd = score; best = { from: [i, j], to: nb }; }
    }
    return best;
  }

  /** Returns true when the car has arrived at its stopAt point. */
  updateAI(dt: number, city: City, obstacleAhead: number): boolean {
    const ai = this.ai!;
    const [ax, az] = interPos(ai.from), [bx, bz] = interPos(ai.to);
    const L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
    const rx = -uz, rz = ux;
    const t = (this.x - ax) * ux + (this.z - az) * uz;
    let target = ai.cruise;
    let tx: number, tz: number;
    const finalEdge = ai.stopAt && ai.route && ai.route.length === 0;
    if (finalEdge && ai.stopAt) {
      const st = (ai.stopAt.x - ax) * ux + (ai.stopAt.z - az) * uz;
      const remaining = st - t;
      tx = ai.stopAt.x + ux * 4; tz = ai.stopAt.z + uz * 4;
      if (remaining < 25) target = Math.max(0, Math.min(target, remaining * 0.6));
      if (remaining < 1.5 || (Math.abs(remaining) < 3 && Math.abs(this.speed) < 0.5)) {
        this.speed *= Math.pow(0.01, dt);
        if (Math.abs(this.speed) < 0.4) { this.speed = 0; ai.arrived = true; return true; }
        return false;
      }
    } else {
      const look = clamp(t + 9, 0, L + 6);
      tx = ax + ux * look + rx * LANE; tz = az + uz * look + rz * LANE;
      if (L - t < 14) target = Math.min(target, 6.5);
      if (L - t < 7) {
        // choose next edge
        const prev = ai.from;
        ai.from = ai.to;
        if (ai.route && ai.route.length) ai.to = ai.route.shift()!;
        else if (ai.route) { /* final edge already */ }
        else {
          const opts = interNeighbors(ai.from).filter((n) => !same(n, prev));
          ai.to = opts.length ? opts[Math.floor(Math.random() * opts.length)] : prev;
        }
      }
    }
    if (obstacleAhead < 11) target = Math.min(target, Math.max(0, (obstacleAhead - 4.5) * 1.2));
    const desiredYaw = Math.atan2(tx - this.x, tz - this.z);
    const steerIn = clamp(angleWrap(desiredYaw - this.yaw) * 2.2, -1, 1);
    const throttle = this.speed < target - 0.5 ? 1 : 0;
    const brake = this.speed > target + 0.8 ? 1 : 0;
    this.drive(dt, throttle * 0.8, brake, steerIn, false, city);
    if (obstacleAhead < 6) ai.blocked += dt; else ai.blocked = 0;
    return false;
  }
}
