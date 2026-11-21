import type { Vec3 } from './math';

/** Material ids interpreted by the fragment shader. */
export const MAT = {
  PLAIN: 0,
  FACADE: 1, // procedural windows
  EMISSIVE: 2, // always bright (lamps, signs)
  WATER: 3,
  GRASS: 4,
  ASPHALT: 5,
  LAMP: 6, // emissive only at night
  SAND: 7,
  SKIN: 8,
} as const;

/** Interleaved vertex layout: pos(3) normal(3) color(3) material(1) = 10 floats */
export const STRIDE = 10;

export class MeshBuilder {
  v: number[] = [];
  i: number[] = [];

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: Vec3, m: number) {
    this.v.push(x, y, z, nx, ny, nz, c[0], c[1], c[2], m);
    return this.v.length / STRIDE - 1;
  }

  /** Quad from 4 corners (counter-clockwise when viewed from the normal side). */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, col: Vec3, m: number) {
    const i0 = this.vert(a[0], a[1], a[2], n[0], n[1], n[2], col, m);
    this.vert(b[0], b[1], b[2], n[0], n[1], n[2], col, m);
    this.vert(c[0], c[1], c[2], n[0], n[1], n[2], col, m);
    this.vert(d[0], d[1], d[2], n[0], n[1], n[2], col, m);
    this.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }

  /** Axis-aligned box given center-bottom (cx, y0, cz) and size, optionally rotated about Y. */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, col: Vec3, m: number = 0, yaw = 0, opts: { noBottom?: boolean; topCol?: Vec3; topMat?: number } = {}) {
    const hx = sx / 2, hz = sz / 2, y1 = y0 + sy;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x: number, y: number, z: number): Vec3 => [cx + x * c + z * s, y, cz - x * s + z * c];
    const N = (x: number, y: number, z: number): Vec3 => [x * c + z * s, y, -x * s + z * c];
    const p000 = P(-hx, y0, -hz), p100 = P(hx, y0, -hz), p110 = P(hx, y1, -hz), p010 = P(-hx, y1, -hz);
    const p001 = P(-hx, y0, hz), p101 = P(hx, y0, hz), p111 = P(hx, y1, hz), p011 = P(-hx, y1, hz);
    this.quad(p001, p101, p111, p011, N(0, 0, 1), col, m); // +z
    this.quad(p100, p000, p010, p110, N(0, 0, -1), col, m); // -z
    this.quad(p101, p100, p110, p111, N(1, 0, 0), col, m); // +x
    this.quad(p000, p001, p011, p010, N(-1, 0, 0), col, m); // -x
    this.quad(p011, p111, p110, p010, [0, 1, 0], opts.topCol ?? col, opts.topMat ?? (m === 1 ? 0 : m)); // top
    if (!opts.noBottom) this.quad(p000, p100, p101, p001, [0, -1, 0], col, m);
  }

  /** Upright cylinder (n sides). */
  cylinder(cx: number, y0: number, cz: number, r: number, h: number, col: Vec3, m = 0, sides = 8, rTop = r) {
    const y1 = y0 + h;
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      this.quad(
        [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r],
        [cx + Math.cos(a0) * rTop, y1, cz + Math.sin(a0) * rTop],
        [cx + Math.cos(a1) * rTop, y1, cz + Math.sin(a1) * rTop],
        [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r],
        [Math.cos(am), 0, Math.sin(am)], col, m,
      );
      // top cap triangle (as degenerate quad)
      const t0: Vec3 = [cx, y1, cz];
      this.quad(t0, [cx + Math.cos(a1) * rTop, y1, cz + Math.sin(a1) * rTop], [cx + Math.cos(a0) * rTop, y1, cz + Math.sin(a0) * rTop], t0, [0, 1, 0], col, m);
    }
  }

  /** Flat horizontal rectangle at height y. */
  plane(x0: number, z0: number, x1: number, z1: number, y: number, col: Vec3, m = 0) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], col, m);
  }

  /** A tilted leaf/blade: quad from base point outward in direction (dx,dz), drooping. Double-sided. */
  leaf(x: number, y: number, z: number, dx: number, dz: number, len: number, width: number, droop: number, col: Vec3) {
    const px = -dz * width, pz = dx * width;
    const tipX = x + dx * len, tipZ = z + dz * len, tipY = y - droop;
    const midX = x + dx * len * 0.5, midZ = z + dz * len * 0.5, midY = y + 0.15;
    const a: Vec3 = [x, y, z], b: Vec3 = [midX + px, midY, midZ + pz], c: Vec3 = [tipX, tipY, tipZ], d: Vec3 = [midX - px, midY, midZ - pz];
    this.quad(a, b, c, d, [0, 1, 0], col, 0);
    this.quad(a, d, c, b, [0, -1, 0], col, 0);
  }

  get vertexCount() { return this.v.length / STRIDE; }
}
