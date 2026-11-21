import type { Vec3 } from './math';

/** Material ids. Each id becomes one batched mesh with its own PBR material in the renderer. */
export const MAT = {
  PLAIN: 0, // painted/concrete surfaces, vertex-colored
  FACADE: 1, // upper-floor building walls with windows
  EMISSIVE: 2, // always bright (signs)
  WATER: 3, // pools, pond, fountain
  GRASS: 4,
  ASPHALT: 5,
  LAMP: 6, // glows at night
  SAND: 7,
  SKIN: 8,
  STORE: 9, // ground-floor storefronts
  PAVE: 10, // sidewalk pavers
  OCEAN: 11, // placeholder; the renderer supplies its own reflective ocean
  FOLIAGE: 12,
  BARK: 13,
  WOOD: 14,
} as const;

export interface MeshGroup { pos: number[]; nrm: number[]; col: number[]; uv: number[]; idx: number[] }

/** Builds static world geometry, grouped by material, with world-space UVs in meters. */
export class MeshBuilder {
  groups = new Map<number, MeshGroup>();

  private g(m: number): MeshGroup {
    let g = this.groups.get(m);
    if (!g) { g = { pos: [], nrm: [], col: [], uv: [], idx: [] }; this.groups.set(m, g); }
    return g;
  }

  /** Quad from 4 corners (counter-clockwise when viewed from the normal side). */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, col: Vec3, m: number) {
    const g = this.g(m);
    const i0 = g.pos.length / 3;
    const flat = Math.abs(n[1]) > 0.6;
    for (const p of [a, b, c, d]) {
      g.pos.push(p[0], p[1], p[2]);
      g.nrm.push(n[0], n[1], n[2]);
      g.col.push(col[0], col[1], col[2]);
      if (flat) g.uv.push(p[0], p[2]);
      else g.uv.push(p[0] * -n[2] + p[2] * n[0], p[1]);
    }
    g.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }

  /** Triangle with per-vertex normals (for smooth shapes). */
  tri(a: Vec3, b: Vec3, c: Vec3, na: Vec3, nb: Vec3, nc: Vec3, col: Vec3, m: number) {
    const g = this.g(m);
    const i0 = g.pos.length / 3;
    for (const [p, n] of [[a, na], [b, nb], [c, nc]] as [Vec3, Vec3][]) {
      g.pos.push(p[0], p[1], p[2]); g.nrm.push(n[0], n[1], n[2]); g.col.push(col[0], col[1], col[2]); g.uv.push(p[0] + p[2], p[1]);
    }
    g.idx.push(i0, i0 + 1, i0 + 2);
  }

  /** Box given center-bottom (cx, y0, cz) and size, optionally rotated about Y. Tall FACADE boxes get a storefront band. */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, col: Vec3, m: number = 0, yaw = 0, opts: { noBottom?: boolean; topCol?: Vec3; topMat?: number } = {}) {
    const hx = sx / 2, hz = sz / 2, y1 = y0 + sy;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x: number, y: number, z: number): Vec3 => [cx + x * c + z * s, y, cz - x * s + z * c];
    const N = (x: number, y: number, z: number): Vec3 => [x * c + z * s, y, -x * s + z * c];
    const side = (ya: number, yb: number, mat: number) => {
      this.quad(P(-hx, ya, hz), P(hx, ya, hz), P(hx, yb, hz), P(-hx, yb, hz), N(0, 0, 1), col, mat);
      this.quad(P(hx, ya, -hz), P(-hx, ya, -hz), P(-hx, yb, -hz), P(hx, yb, -hz), N(0, 0, -1), col, mat);
      this.quad(P(hx, ya, hz), P(hx, ya, -hz), P(hx, yb, -hz), P(hx, yb, hz), N(1, 0, 0), col, mat);
      this.quad(P(-hx, ya, -hz), P(-hx, ya, hz), P(-hx, yb, hz), P(-hx, yb, -hz), N(-1, 0, 0), col, mat);
    };
    if (m === MAT.FACADE) {
      const band = 3.75;
      if (sy <= band + 1.2) side(y0, y1, MAT.STORE);
      else { side(y0, y0 + band, MAT.STORE); side(y0 + band, y1, MAT.FACADE); }
    } else side(y0, y1, m);
    const tm = opts.topMat ?? (m === MAT.FACADE ? MAT.PLAIN : m);
    this.quad(P(-hx, y1, hz), P(hx, y1, hz), P(hx, y1, -hz), P(-hx, y1, -hz), [0, 1, 0], opts.topCol ?? col, tm);
    if (!opts.noBottom) this.quad(P(-hx, y0, -hz), P(hx, y0, -hz), P(hx, y0, hz), P(-hx, y0, hz), [0, -1, 0], col, m === MAT.FACADE ? MAT.PLAIN : m);
  }

  /** Upright cylinder / cone frustum with smooth normals. */
  cylinder(cx: number, y0: number, cz: number, r: number, h: number, col: Vec3, m = 0, sides = 10, rTop = r) {
    const y1 = y0 + h;
    const g = this.g(m);
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
      const i0 = g.pos.length / 3;
      const pts: [number, number, number, number][] = [[a0, r, y0, 0], [a0, rTop, y1, 1], [a1, rTop, y1, 1], [a1, r, y0, 0]];
      for (const [a, rr, y] of pts) {
        g.pos.push(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr);
        g.nrm.push(Math.cos(a), (r - rTop) / Math.max(h, 0.01) * 0.5, Math.sin(a));
        g.col.push(col[0], col[1], col[2]);
        g.uv.push(a * Math.max(r, rTop), y);
      }
      g.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
      if (rTop > 0.02) {
        const t0: Vec3 = [cx, y1, cz];
        const up: Vec3 = [0, 1, 0];
        this.tri(t0, [cx + Math.cos(a1) * rTop, y1, cz + Math.sin(a1) * rTop], [cx + Math.cos(a0) * rTop, y1, cz + Math.sin(a0) * rTop], up, up, up, col, m);
      }
    }
  }

  /** Lumpy smooth-shaded sphere (tree canopies, bushes). */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: Vec3, m: number, seed = 1, lumps = 0.22) {
    const seg = 9, rings = 6;
    const h = (i: number, j: number) => { const v = Math.sin((i % seg) * 12.9898 + j * 78.233 + seed * 37.719) * 43758.5453; return v - Math.floor(v); };
    const P = (i: number, j: number): [Vec3, Vec3] => {
      const th = (i / seg) * Math.PI * 2, ph = (j / rings) * Math.PI;
      const d = j === 0 || j === rings ? 1 : 1 - lumps + h(i, j) * lumps * 2;
      const nx = Math.sin(ph) * Math.cos(th), ny = Math.cos(ph), nz = Math.sin(ph) * Math.sin(th);
      return [[cx + nx * rx * d, cy + ny * ry * d, cz + nz * rz * d], [nx, ny, nz]];
    };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
      const [a, na] = P(i, j), [b, nb] = P(i + 1, j), [c, nc] = P(i + 1, j + 1), [d, nd] = P(i, j + 1);
      // darker underside for depth
      const sh = (n: Vec3): Vec3 => { const k = 0.72 + 0.28 * Math.max(0, n[1] * 0.5 + 0.5); return [col[0] * k, col[1] * k, col[2] * k]; };
      this.tri(a, c, b, na, nc, nb, sh(na), m);
      this.tri(a, d, c, na, nd, nc, sh(nd), m);
    }
  }

  /** Flat horizontal rectangle at height y. */
  plane(x0: number, z0: number, x1: number, z1: number, y: number, col: Vec3, m = 0) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], col, m);
  }

  /** A drooping palm frond: curved, tapering, double-sided strip. */
  leaf(x: number, y: number, z: number, dx: number, dz: number, len: number, width: number, droop: number, col: Vec3) {
    const segs = 5;
    const px = -dz, pz = dx;
    let prevL: Vec3 | null = null, prevR: Vec3 | null = null;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const cx = x + dx * len * t, cz = z + dz * len * t;
      const cy = y + Math.sin(t * Math.PI * 0.55) * 0.55 - droop * t * t;
      const w = width * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) * 0.9 + 0.03;
      const L: Vec3 = [cx + px * w, cy - 0.12 * w, cz + pz * w], R: Vec3 = [cx - px * w, cy - 0.12 * w, cz - pz * w];
      if (prevL && prevR) {
        const k = 0.8 + 0.25 * t;
        const c2: Vec3 = [col[0] * k, col[1] * k, col[2] * k];
        this.quad(prevL, prevR, R, L, [0, 1, 0], c2, MAT.FOLIAGE);
        this.quad(prevR, prevL, L, R, [0, -1, 0], [c2[0] * 0.7, c2[1] * 0.7, c2[2] * 0.7], MAT.FOLIAGE);
      }
      prevL = L; prevR = R;
    }
  }
}
