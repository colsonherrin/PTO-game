// Vehicle models built from extruded profiles with physically based car paint and glass.
import * as THREE from 'three';

export interface Appearance {
  skin: string; shirt: string; pants: string; hair: string;
  hairStyle: 0 | 1 | 2 | 3 | 4; height: number; build: number; accent?: string;
}
export type AnimState = 'idle' | 'walk' | 'run' | 'sit' | 'down' | 'talk' | 'hidden' | 'wave';
export type CarType = 'hatch' | 'sedan' | 'pickup' | 'taxi' | 'police' | 'van';

export function carLength(type: CarType) {
  return type === 'van' ? 4.8 : type === 'pickup' ? 4.9 : type === 'hatch' ? 3.8 : 4.4;
}

const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x1a2630, roughness: 0.03, metalness: 0.9, envMapIntensity: 2.2 });
const tyreMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.92 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.25, metalness: 0.95 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.3 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.12, metalness: 1 });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3d8, toneMapped: false });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false });
const paintCache = new Map<string, any>();
function paint(color: string) {
  let m = paintCache.get(color);
  if (!m) { m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), roughness: 0.38, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.25 }); paintCache.set(color, m); }
  return m;
}

/** Extrude a side profile given as [z, y] points (z = along the car, front positive) across the car's width.
 *  The upper contour is spline-smoothed so bodies read as curved sheet metal rather than boxes. */
function extrude(pts: [number, number][], width: number, bevel: number, mat: any, smooth = true) {
  const sh = new THREE.Shape();
  if (smooth) {
    const curve = new THREE.SplineCurve(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const sp = curve.getPoints(48);
    sp.forEach((p: any, i: number) => (i ? sh.lineTo(p.x, p.y) : sh.moveTo(p.x, p.y)));
  } else pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 4, curveSegments: 4 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // shape x → car z, extrude depth → car x
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function carObject(type: CarType, color: string): any {
  const grp = new THREE.Group();
  const L = carLength(type), W = 1.86, h = L / 2;
  const body = paint(type === 'taxi' ? '#f2c230' : type === 'police' ? '#f4f5f7' : color);
  const add = (m: any) => { grp.add(m); return m; };
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: any, shadow = false) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); m.castShadow = shadow; return add(m); };
  let lower: [number, number][], glass: [number, number][], roof: [number, number, number, number] | null; // roof: z0, z1, y, thickness
  if (type === 'pickup') {
    lower = [[-h + 0.04, 0.36], [-h, 0.6], [-h + 0.02, 1.0], [-1.2, 1.04], [-0.3, 1.04], [0.9, 1.02], [h - 0.8, 0.98], [h - 0.12, 0.86], [h, 0.62], [h - 0.04, 0.36]];
    glass = [[-0.34, 1.0], [-0.26, 1.5], [-0.05, 1.6], [0.4, 1.6], [0.62, 1.5], [1.0, 1.0]];
    roof = null;
  } else if (type === 'van') {
    lower = [[-h + 0.04, 0.36], [-h, 0.7], [-h + 0.02, 1.8], [-h + 0.2, 1.93], [h - 1.5, 1.93], [h - 1.15, 1.8], [h - 0.6, 1.15], [h - 0.1, 0.98], [h, 0.66], [h - 0.04, 0.36]];
    glass = [[h - 1.22, 1.72], [h - 1.1, 1.78], [h - 0.58, 1.2], [h - 0.72, 1.16]];
    roof = null;
  } else if (type === 'hatch') {
    lower = [[-h + 0.04, 0.36], [-h, 0.62], [-h + 0.03, 0.94], [-h + 0.3, 1.0], [0.7, 1.0], [h - 0.7, 0.93], [h - 0.12, 0.8], [h, 0.6], [h - 0.04, 0.36]];
    glass = [[-h + 0.1, 0.98], [-h + 0.3, 1.4], [-h + 0.55, 1.47], [0.05, 1.47], [0.3, 1.38], [0.85, 0.98]];
    roof = null;
  } else {
    lower = [[-h + 0.04, 0.36], [-h, 0.62], [-h + 0.03, 0.9], [-h + 0.5, 0.99], [0.8, 0.99], [h - 0.7, 0.92], [h - 0.12, 0.8], [h, 0.6], [h - 0.04, 0.36]];
    glass = [[-h + 0.6, 0.97], [-h + 1.05, 1.36], [-h + 1.3, 1.43], [0.15, 1.43], [0.4, 1.35], [0.95, 0.97]];
    roof = null;
  }
  // painted roof skin + pillars follow the glass profile, slightly inset so side windows read as glass
  if (type !== 'van') { const rf = extrude(glass.map(([z, y]) => [z, y + 0.025] as [number, number]), W - 0.62, 0.05, body); add(rf); }
  void roof;
  add(extrude(lower, W, 0.09, body));
  add(extrude(glass, W - 0.2, 0.06, glassMat));
  // pillars
  if (type !== 'van') for (const s of [-1, 1]) box(0.05, 0.44, 0.08, s * (W / 2 - 0.115), 1.2, (glass[1][0] + glass[glass.length - 2][0]) / 2, body);
  // underbody + bumpers + grille
  box(W - 0.1, 0.16, L - 0.3, 0, 0.3, 0, trimMat);
  box(W - 0.04, 0.14, 0.1, 0, 0.44, h - 0.02, trimMat); box(W - 0.04, 0.14, 0.1, 0, 0.46, -h + 0.02, trimMat);
  box(0.9, 0.14, 0.04, 0, 0.62, h + 0.005, trimMat);
  box(0.5, 0.11, 0.02, 0, 0.5, -h - 0.02, chromeMat); // plate
  for (const s of [-1, 1]) {
    box(0.4, 0.13, 0.05, s * 0.62, 0.7, h - 0.02, headMat);
    box(0.36, 0.12, 0.05, s * 0.66, type === 'van' ? 1.0 : 0.8, -h + 0.0, tailMat);
    box(0.06, 0.09, 0.18, s * (W / 2 + 0.05), 1.03, glass[glass.length - 1][0] - 0.12, body); // mirrors
  }
  if (type === 'taxi') box(0.7, 0.17, 0.3, 0, 1.56, -0.2, new THREE.MeshBasicMaterial({ color: 0xffe27a, toneMapped: false }));
  if (type === 'police') {
    box(0.5, 0.12, 0.26, -0.3, 1.54, -0.2, new THREE.MeshBasicMaterial({ color: 0x3366ff, toneMapped: false }));
    box(0.5, 0.12, 0.26, 0.3, 1.54, -0.2, new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }));
    for (const s of [-1, 1]) box(0.02, 0.26, 1.7, s * (W / 2 + 0.005), 0.72, -0.1, new THREE.MeshStandardMaterial({ color: 0x16233f, roughness: 0.4, metalness: 0.4 }));
  }
  if (type === 'pickup') box(W - 0.3, 0.5, 1.75, 0, 0.82, -h + 1.02, trimMat); // bed liner
  // wheels
  const wheels: any[] = [];
  const tg = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 20); tg.rotateZ(Math.PI / 2);
  const rg = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 12); rg.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Group();
    const t = new THREE.Mesh(tg, tyreMat); t.castShadow = true;
    const r = new THREE.Mesh(rg, rimMat);
    w.add(t, r);
    w.position.set(sx * (W / 2 - 0.1), 0.33, sz * (h - 0.78));
    grp.add(w); wheels.push(w);
  }
  grp.userData.wheels = wheels;
  return grp;
}
