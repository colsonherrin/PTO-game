import type { City } from '../world/city';
import { approachAngle, clamp, type Vec3 } from '../engine/math';
import type { Appearance, AnimState } from './models';

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  enabled = true;
  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
      else if (e.buttons & 2 || e.buttons & 1) { if (e.target === canvas) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } }
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  private isTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  down(c: string) { return this.enabled && this.keys.has(c); }
  hit(c: string) { return this.enabled && this.pressed.has(c); }
  endFrame() { this.pressed.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; }
  lock() { if (!this.locked) this.canvas.requestPointerLock?.(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
}

export class Player {
  x = 0; y = 0.15; z = 0;
  vy = 0;
  yaw = 0;
  onGround = true;
  phase = 0;
  anim: AnimState = 'idle';
  speed = 0;
  health = 100;
  stamina = 100;
  money = 250;
  name: string | null = null;
  inventory: Record<string, number> = {};
  vehicleId: string | null = null;
  passengerIn: string | null = null;
  heat = 0;
  reputation = 0;
  knockedUntil = 0;
  appearance: Appearance = { skin: '#d9a07a', shirt: '#ff6b6b', pants: '#2d3a4a', hair: '#2a1b12', hairStyle: 0, height: 0.95, build: 1.0, accent: '#ffe66d' };
  ownedVehicles: string[] = [];

  update(dt: number, input: Input, camYaw: number, city: City, blockers: [number, number, number][]) {
    let fx = 0, fz = 0;
    const f: [number, number] = [Math.sin(camYaw), Math.cos(camYaw)];
    const r: [number, number] = [-f[1], f[0]];
    if (input.down('KeyW') || input.down('ArrowUp')) { fx += f[0]; fz += f[1]; }
    if (input.down('KeyS') || input.down('ArrowDown')) { fx -= f[0]; fz -= f[1]; }
    if (input.down('KeyD') || input.down('ArrowRight')) { fx += r[0]; fz += r[1]; }
    if (input.down('KeyA') || input.down('ArrowLeft')) { fx -= r[0]; fz -= r[1]; }
    const len = Math.hypot(fx, fz);
    const sprint = (input.down('ShiftLeft') || input.down('ShiftRight')) && this.stamina > 1;
    const knocked = this.knockedUntil > performance.now();
    let target = 0;
    if (len > 0 && !knocked) {
      fx /= len; fz /= len;
      target = sprint ? 7.2 : 3.4;
      this.yaw = approachAngle(this.yaw, Math.atan2(fx, fz), dt * 12);
    }
    this.speed += (target - this.speed) * Math.min(1, dt * 10);
    if (sprint && len > 0) this.stamina = Math.max(0, this.stamina - dt * 14);
    else this.stamina = Math.min(100, this.stamina + dt * 9);
    const mx = len > 0 ? fx : Math.sin(this.yaw), mz = len > 0 ? fz : Math.cos(this.yaw);
    const sp = len > 0 ? this.speed : this.speed * 0.8;
    this.x += mx * sp * dt;
    this.z += mz * sp * dt;
    if (input.hit('Space') && this.onGround && !knocked) { this.vy = 6.5; this.onGround = false; }
    this.vy -= 20 * dt;
    this.y += this.vy * dt;
    const g = city.groundHeight(this.x, this.z);
    if (this.y <= g) { this.y = g; this.vy = 0; this.onGround = true; }
    this.collide(city, blockers);
    this.phase += dt * this.speed * 2.6;
    this.anim = knocked ? 'down' : this.speed > 5 ? 'run' : this.speed > 0.4 ? 'walk' : 'idle';
  }

  collide(city: City, blockers: [number, number, number][]) {
    const r = 0.38;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of city.query(this.x, this.z, 1.5)) {
        if (c.y1 <= this.y + 0.4 || c.y0 > this.y + 1.7) continue;
        const nx = clamp(this.x, c.x0, c.x1), nz = clamp(this.z, c.z0, c.z1);
        const dx = this.x - nx, dz = this.z - nz, d = Math.hypot(dx, dz);
        if (d < r) {
          if (d > 1e-5) { this.x += (dx / d) * (r - d); this.z += (dz / d) * (r - d); }
          else {
            // inside: push out along smallest axis
            const pen = [this.x - c.x0, c.x1 - this.x, this.z - c.z0, c.z1 - this.z];
            const m = Math.min(...pen), k = pen.indexOf(m);
            if (k === 0) this.x = c.x0 - r; else if (k === 1) this.x = c.x1 + r; else if (k === 2) this.z = c.z0 - r; else this.z = c.z1 + r;
          }
        }
      }
      for (const [bx, bz, br] of blockers) {
        const dx = this.x - bx, dz = this.z - bz, d = Math.hypot(dx, dz), m = br + r;
        if (d < m && d > 1e-4) { this.x += (dx / d) * (m - d); this.z += (dz / d) * (m - d); }
      }
    }
  }

  pos(): Vec3 { return [this.x, this.y, this.z]; }
  addItem(id: string, n = 1) { this.inventory[id] = (this.inventory[id] ?? 0) + n; }
  removeItem(id: string, n = 1) {
    if ((this.inventory[id] ?? 0) < n) return false;
    this.inventory[id] -= n;
    if (this.inventory[id] <= 0) delete this.inventory[id];
    return true;
  }
}

/** Smooth third-person orbit camera with collision against buildings. */
export class OrbitCamera {
  yaw = Math.PI; // camera forward yaw (direction camera looks)
  pitch = 0.32;
  dist = 6.5;
  targetDist = 6.5;
  eye: Vec3 = [0, 5, 0];
  look: Vec3 = [0, 1.5, 0];
  sensitivity = 1;
  update(dt: number, input: Input, target: Vec3, city: City, inCar: boolean, carYaw: number, carSpeed: number) {
    this.yaw -= input.mouseDX * 0.0025 * this.sensitivity;
    this.pitch = clamp(this.pitch + input.mouseDY * 0.002 * this.sensitivity, -0.25, 1.2);
    this.targetDist = clamp(this.targetDist + input.wheel * 0.8, 3, 16);
    const want = inCar ? Math.max(this.targetDist, 8.5) : this.targetDist;
    if (inCar && Math.abs(carSpeed) > 3 && input.mouseDX === 0) {
      // auto-follow behind the car
      const behind = carSpeed > 0 ? carYaw : carYaw + Math.PI;
      this.yaw = approachAngle(this.yaw, behind, dt * 1.6);
    }
    const tgt: Vec3 = [target[0], target[1] + (inCar ? 1.8 : 1.55), target[2]];
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir: Vec3 = [-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp];
    const hit = city.raycast(tgt[0], tgt[1], tgt[2], tgt[0] + dir[0] * want, tgt[1] + dir[1] * want, tgt[2] + dir[2] * want, 1.5);
    const d = Math.max(1.2, want * hit - 0.4);
    this.dist += (d - this.dist) * Math.min(1, dt * (d < this.dist ? 20 : 4));
    const ex = tgt[0] + dir[0] * this.dist, ey = Math.max(0.6, tgt[1] + dir[1] * this.dist), ez = tgt[2] + dir[2] * this.dist;
    const k = Math.min(1, dt * 14);
    this.eye = [this.eye[0] + (ex - this.eye[0]) * k, this.eye[1] + (ey - this.eye[1]) * k, this.eye[2] + (ez - this.eye[2]) * k];
    this.look = [this.look[0] + (tgt[0] - this.look[0]) * Math.min(1, dt * 18), this.look[1] + (tgt[1] - this.look[1]) * Math.min(1, dt * 18), this.look[2] + (tgt[2] - this.look[2]) * Math.min(1, dt * 18)];
  }
}
