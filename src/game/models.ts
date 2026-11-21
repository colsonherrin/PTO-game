import { MeshBuilder, MAT } from '../engine/mesh';
import { Xform, hexToRgb, type Vec3 } from '../engine/math';
import type { GPUMesh, Renderer } from '../engine/renderer';

export interface Appearance {
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
  hairStyle: 0 | 1 | 2 | 3 | 4; // short, long, bald, bun, cap
  height: number; // ~0.9..1.1
  build: number; // ~0.9..1.2
  accent?: string; // hat / apron color
}

export type AnimState = 'idle' | 'walk' | 'run' | 'sit' | 'down' | 'talk' | 'hidden' | 'wave';

let unitBox: GPUMesh | null = null;
const carMeshes = new Map<string, GPUMesh>();

export function initModels(r: Renderer) {
  const b = new MeshBuilder();
  b.box(0, -0.5, 0, 1, 1, 1, [1, 1, 1], MAT.PLAIN);
  unitBox = r.upload(b);
}

const X = new Xform();
const P = new Xform();
const colorCache = new Map<string, Vec3>();
const col = (h: string) => { let c = colorCache.get(h); if (!c) { c = hexToRgb(h); colorCache.set(h, c); } return c; };

function part(r: Renderer, parent: Xform, build: (x: Xform) => void, color: string, shadow = true) {
  P.copy(parent);
  build(P);
  r.draw(unitBox!, P.m, col(color), shadow);
}

/** Draw a stylized blocky character. Local +z is forward. */
export function drawCharacter(r: Renderer, a: Appearance, x: number, y: number, z: number, yaw: number, state: AnimState, phase: number, t: number) {
  if (state === 'hidden') return;
  const H = a.height, B = a.build;
  X.reset().translate(x, y, z).rotY(yaw);
  if (state === 'down') X.translate(0, 0.25, 0).rotX(-Math.PI / 2).translate(0, -0.15, -0.9);
  X.scale(H, H, H);
  let swing = 0, bob = 0, armL = 0, armR = 0, lean = 0;
  if (state === 'walk') { swing = Math.sin(phase) * 0.55; bob = Math.abs(Math.cos(phase)) * 0.04; armL = -swing; armR = swing; }
  else if (state === 'run') { swing = Math.sin(phase) * 0.95; bob = Math.abs(Math.cos(phase)) * 0.08; armL = -swing * 1.1; armR = swing * 1.1; lean = 0.18; }
  else if (state === 'talk') { armR = -0.4 - Math.sin(t * 5) * 0.25; armL = Math.sin(t * 3.1) * 0.1; bob = Math.sin(t * 2) * 0.01; }
  else if (state === 'wave') { armR = -2.6 + Math.sin(t * 10) * 0.35; }
  else bob = Math.sin(t * 1.8) * 0.008;
  const sit = state === 'sit';
  const hip = sit ? 0.45 : 0.85;
  X.translate(0, bob + (sit ? 0 : 0), 0);
  // legs
  for (const s of [-1, 1]) {
    part(r, X, (p) => {
      p.translate(s * 0.12 * B, hip, sit ? 0.05 : 0);
      if (sit) p.rotX(-Math.PI / 2); else p.rotX(s * swing);
      p.translate(0, -0.425, 0).scale(0.18 * B, 0.85, 0.21);
    }, a.pants);
    // shoes
    part(r, X, (p) => {
      p.translate(s * 0.12 * B, hip, sit ? 0.05 : 0);
      if (sit) p.rotX(-Math.PI / 2); else p.rotX(s * swing);
      p.translate(0, -0.78, 0.04).scale(0.2 * B, 0.1, 0.3);
    }, '#2b2b2b');
  }
  const torsoBase = new Xform().copy(X).translate(0, hip, 0).rotX(lean);
  // torso
  part(r, torsoBase, (p) => p.translate(0, 0.34, 0).scale(0.48 * B, 0.68, 0.27 * B), a.shirt);
  if (a.accent) part(r, torsoBase, (p) => p.translate(0, 0.42, 0.14 * B).scale(0.4 * B, 0.42, 0.02), a.accent);
  // arms
  for (const s of [-1, 1]) {
    const ang = s < 0 ? armL : armR;
    part(r, torsoBase, (p) => p.translate(s * 0.31 * B, 0.62, 0).rotX(ang).rotZ(s * 0.06).translate(0, -0.2, 0).scale(0.13, 0.4, 0.15), a.shirt);
    part(r, torsoBase, (p) => p.translate(s * 0.31 * B, 0.62, 0).rotX(ang).rotZ(s * 0.06).translate(0, -0.55, 0).scale(0.115, 0.3, 0.13), a.skin);
  }
  // neck + head
  part(r, torsoBase, (p) => p.translate(0, 0.74, 0).scale(0.12, 0.1, 0.12), a.skin);
  const head = new Xform().copy(torsoBase).translate(0, 0.98, 0);
  if (state === 'talk') head.rotY(Math.sin(t * 1.3) * 0.12);
  part(r, head, (p) => p.scale(0.32, 0.34, 0.31), a.skin);
  // eyes
  for (const s of [-1, 1]) part(r, head, (p) => p.translate(s * 0.075, -0.12, 0.158).scale(0.05, 0.06, 0.01), '#1d1d1f', false);
  // hair styles
  switch (a.hairStyle) {
    case 0: part(r, head, (p) => p.translate(0, 0.02, -0.02).scale(0.34, 0.1, 0.34), a.hair); break;
    case 1:
      part(r, head, (p) => p.translate(0, 0.02, -0.02).scale(0.35, 0.1, 0.35), a.hair);
      part(r, head, (p) => p.translate(0, -0.1, -0.14).scale(0.36, 0.42, 0.08), a.hair);
      break;
    case 2: break;
    case 3:
      part(r, head, (p) => p.translate(0, 0.02, -0.02).scale(0.34, 0.09, 0.34), a.hair);
      part(r, head, (p) => p.translate(0, 0.1, -0.12).scale(0.16, 0.16, 0.16), a.hair);
      break;
    case 4:
      part(r, head, (p) => p.translate(0, 0.05, 0).scale(0.35, 0.1, 0.35), a.accent ?? a.hair);
      part(r, head, (p) => p.translate(0, 0.0, 0.2).scale(0.3, 0.03, 0.14), a.accent ?? a.hair);
      break;
  }
}

// ---------------------------------------------------------------------------
export type CarType = 'hatch' | 'sedan' | 'pickup' | 'taxi' | 'police' | 'van';

export function carMesh(r: Renderer, type: CarType, color: string): GPUMesh {
  const key = type + color;
  let m = carMeshes.get(key);
  if (m) return m;
  const b = new MeshBuilder();
  const body = col(color);
  const dark: Vec3 = [0.12, 0.13, 0.15];
  const glass: Vec3 = [0.25, 0.38, 0.5];
  const L = type === 'van' ? 4.8 : type === 'pickup' ? 4.9 : type === 'hatch' ? 3.8 : 4.4;
  const W = 1.9;
  // chassis
  b.box(0, 0.3, 0, W, 0.62, L, body, MAT.PLAIN);
  b.box(0, 0.22, 0, W + 0.04, 0.2, L + 0.06, dark, MAT.PLAIN);
  if (type === 'pickup') {
    b.box(0, 0.92, 0.55, W - 0.12, 0.7, 1.8, body);
    b.box(0, 0.94, 0.56, W - 0.1, 0.5, 1.7, glass);
    b.box(0, 0.92, -1.3, W, 0.35, 2.1, body);
    b.box(0, 0.93, -1.3, W - 0.3, 0.3, 1.9, dark);
  } else if (type === 'van') {
    b.box(0, 0.92, -0.3, W - 0.06, 1.15, L - 1.3, body);
    b.box(0, 1.0, 1.6, W - 0.08, 0.7, 0.4, glass);
  } else {
    const cabL = type === 'hatch' ? 2.1 : 2.2;
    const cabZ = type === 'hatch' ? -0.25 : -0.15;
    b.box(0, 0.92, cabZ, W - 0.18, 0.62, cabL, body);
    b.box(0, 0.95, cabZ, W - 0.14, 0.48, cabL - 0.3, glass);
    b.box(0, 0.95, cabZ, W - 0.3, 0.48, cabL + 0.04, glass);
  }
  if (type === 'taxi') { b.box(0, 1.54, -0.1, 0.7, 0.2, 0.3, [1, 0.85, 0.2], MAT.LAMP); }
  if (type === 'police') {
    b.box(-0.35, 1.54, -0.1, 0.55, 0.16, 0.3, [0.2, 0.4, 1], MAT.EMISSIVE);
    b.box(0.35, 1.54, -0.1, 0.55, 0.16, 0.3, [1, 0.2, 0.2], MAT.EMISSIVE);
    b.box(0, 0.6, 0, W + 0.02, 0.18, 2.2, [0.95, 0.95, 0.95]);
  }
  // lights
  for (const s of [-1, 1]) {
    b.box(s * 0.65, 0.6, L / 2, 0.38, 0.16, 0.06, [1, 0.95, 0.8], MAT.LAMP);
    b.box(s * 0.68, 0.62, -L / 2, 0.32, 0.14, 0.06, [0.9, 0.1, 0.1], MAT.LAMP);
  }
  // wheels
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(sx * (W / 2 - 0.05), 0, sz * (L / 2 - 0.75), 0.28, 0.66, 0.66, dark);
    b.box(sx * (W / 2 + 0.0), 0.2, sz * (L / 2 - 0.75), 0.06, 0.26, 0.26, [0.75, 0.75, 0.78]);
  }
  m = r.upload(b);
  carMeshes.set(key, m);
  return m;
}

export function carLength(type: CarType) {
  return type === 'van' ? 4.8 : type === 'pickup' ? 4.9 : type === 'hatch' ? 3.8 : 4.4;
}
