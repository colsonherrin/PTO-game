// Minimal linear algebra for the renderer. Column-major 4x4 matrices (WebGL convention).
export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export const mat4 = {
  create(): Mat4 {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  identity(m: Mat4): Mat4 {
    m.fill(0);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let rI = 0; rI < 4; rI++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + rI] * b[c * 4 + k];
        r[c * 4 + rI] = s;
      }
    }
    out.set(r);
    return out;
  },
  perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovy / 2);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  },
  ortho(out: Mat4, l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
    out.fill(0);
    out[0] = 2 / (r - l);
    out[5] = 2 / (t - b);
    out[10] = -2 / (f - n);
    out[12] = -(r + l) / (r - l);
    out[13] = -(t + b) / (t - b);
    out[14] = -(f + n) / (f - n);
    out[15] = 1;
    return out;
  },
  lookAt(out: Mat4, eye: Vec3, target: Vec3, up: Vec3): Mat4 {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xy /= len; xz /= len;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  },
  invert(out: Mat4, m: Mat4): Mat4 | null {
    const a = m;
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4];
    const b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
    const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
    const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13];
    const b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    const r = new Float32Array(16);
    r[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
    r[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    r[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
    r[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    r[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
    r[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    r[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
    r[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    r[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
    r[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    r[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
    r[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    r[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
    r[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    r[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
    r[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    out.set(r);
    return out;
  },
};

/** Chainable transform builder: T * Ry * Rx * Rz * S applied in call order (like a scene graph). */
export class Xform {
  m: Mat4 = mat4.create();
  private tmp: Mat4 = mat4.create();
  reset(): this { mat4.identity(this.m); return this; }
  copy(o: Xform): this { this.m.set(o.m); return this; }
  translate(x: number, y: number, z: number): this {
    const t = mat4.identity(this.tmp);
    t[12] = x; t[13] = y; t[14] = z;
    mat4.multiply(this.m, this.m, t);
    return this;
  }
  rotY(a: number): this {
    const t = mat4.identity(this.tmp), c = Math.cos(a), s = Math.sin(a);
    t[0] = c; t[2] = -s; t[8] = s; t[10] = c;
    mat4.multiply(this.m, this.m, t);
    return this;
  }
  rotX(a: number): this {
    const t = mat4.identity(this.tmp), c = Math.cos(a), s = Math.sin(a);
    t[5] = c; t[6] = s; t[9] = -s; t[10] = c;
    mat4.multiply(this.m, this.m, t);
    return this;
  }
  rotZ(a: number): this {
    const t = mat4.identity(this.tmp), c = Math.cos(a), s = Math.sin(a);
    t[0] = c; t[1] = s; t[4] = -s; t[5] = c;
    mat4.multiply(this.m, this.m, t);
    return this;
  }
  scale(x: number, y: number, z: number): this {
    const t = mat4.identity(this.tmp);
    t[0] = x; t[5] = y; t[10] = z;
    mat4.multiply(this.m, this.m, t);
    return this;
  }
  clone(): Mat4 { return new Float32Array(this.m); }
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
export function angleWrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function approachAngle(cur: number, target: number, maxStep: number): number {
  const d = angleWrap(target - cur);
  return cur + clamp(d, -maxStep, maxStep);
}
/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function hexToRgb(hex: string): Vec3 {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
