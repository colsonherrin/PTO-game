// Procedural PBR texture sets drawn on canvases at load time (no downloaded images):
// albedo, roughness/metalness, emissive and normal maps derived from height.
import * as THREE from 'three';

type Ctx = CanvasRenderingContext2D;
const canvas = (w: number, h: number): [HTMLCanvasElement, Ctx] => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!]; };
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function tex(c: HTMLCanvasElement, srgb: boolean, aniso = 8): any {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  return t;
}

/** Sobel a grayscale height canvas into a tangent-space normal map. */
export function normalFromHeight(hc: HTMLCanvasElement, strength = 2): any {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [c, g] = canvas(w, h);
  const out = g.createImageData(w, h);
  const H = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return tex(c, false);
}

function speckle(g: Ctx, w: number, h: number, n: number, minA: number, maxA: number, light: boolean, maxR = 1.6) {
  for (let i = 0; i < n; i++) {
    const a = minA + rnd() * (maxA - minA);
    g.fillStyle = light ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    const r = 0.4 + rnd() * maxR;
    g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, 7); g.fill();
  }
}

export interface PBRSet { map: any; normalMap?: any; roughnessMap?: any; emissiveMap?: any; repeat: [number, number] }

export function asphalt(): PBRSet {
  const S = 512;
  const [c, g] = canvas(S, S); g.fillStyle = '#e2e2e2'; g.fillRect(0, 0, S, S);
  speckle(g, S, S, 9000, 0.03, 0.14, false); speckle(g, S, S, 5000, 0.03, 0.12, true);
  // patches + cracks
  for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.05})`; g.beginPath(); g.ellipse(rnd() * S, rnd() * S, 40 + rnd() * 90, 20 + rnd() * 50, rnd() * 3, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 1.1;
  for (let i = 0; i < 9; i++) { let x = rnd() * S, y = rnd() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 9; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); }
  const [hc, hg] = canvas(S, S); hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S); speckle(hg, S, S, 14000, 0.1, 0.5, false, 1.2); speckle(hg, S, S, 9000, 0.1, 0.4, true, 1.2);
  const [rc, rg] = canvas(S, S); rg.fillStyle = 'rgb(0,225,0)'; rg.fillRect(0, 0, S, S);
  for (let i = 0; i < 10; i++) { rg.fillStyle = `rgba(0,${120 + rnd() * 60},0,0.35)`; rg.beginPath(); rg.ellipse(rnd() * S, rnd() * S, 30 + rnd() * 80, 15 + rnd() * 40, rnd() * 3, 0, 7); rg.fill(); }
  return { map: tex(c, true), normalMap: normalFromHeight(hc, 1.6), roughnessMap: tex(rc, false), repeat: [1 / 7, 1 / 7] };
}

export function pavers(): PBRSet {
  const S = 512, n = 4, t = S / n;
  const [c, g] = canvas(S, S); const [hc, hg] = canvas(S, S);
  hg.fillStyle = '#000'; hg.fillRect(0, 0, S, S);
  g.fillStyle = '#8f8a82'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = 212 + Math.floor(rnd() * 28);
    g.fillStyle = `rgb(${v},${v - 2},${v - 6})`; g.fillRect(x * t + 2, y * t + 2, t - 4, t - 4);
    hg.fillStyle = '#fff'; hg.fillRect(x * t + 3, y * t + 3, t - 6, t - 6);
  }
  speckle(g, S, S, 7000, 0.02, 0.09, false); speckle(g, S, S, 2500, 0.03, 0.1, true);
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(60,50,40,${0.03 + rnd() * 0.05})`; g.beginPath(); g.ellipse(rnd() * S, rnd() * S, 10 + rnd() * 40, 8 + rnd() * 25, rnd() * 3, 0, 7); g.fill(); }
  speckle(hg, S, S, 5000, 0.05, 0.2, false, 1.2);
  return { map: tex(c, true), normalMap: normalFromHeight(hc, 1.5), repeat: [1 / 3.2, 1 / 3.2] };
}

export function plaster(): PBRSet {
  const S = 256;
  const [c, g] = canvas(S, S); g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, S, S);
  speckle(g, S, S, 3500, 0.01, 0.05, false, 2.5); speckle(g, S, S, 2000, 0.02, 0.06, true, 2.5);
  const [hc, hg] = canvas(S, S); hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S); speckle(hg, S, S, 6000, 0.05, 0.25, false, 2); speckle(hg, S, S, 6000, 0.05, 0.25, true, 2);
  return { map: tex(c, true), normalMap: normalFromHeight(hc, 0.8), repeat: [1 / 3, 1 / 3] };
}

export function sand(): PBRSet {
  const S = 512;
  const [c, g] = canvas(S, S); g.fillStyle = '#f6f1e6'; g.fillRect(0, 0, S, S);
  speckle(g, S, S, 12000, 0.02, 0.09, false, 1.2); speckle(g, S, S, 6000, 0.03, 0.1, true, 1.2);
  const [hc, hg] = canvas(S, S); hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) { const v = 128 + Math.sin(y / S * Math.PI * 2 * 9 + Math.sin(y * 0.07) * 1.5) * 50; hg.fillStyle = `rgb(${v},${v},${v})`; hg.fillRect(0, y, S, 2); }
  speckle(hg, S, S, 9000, 0.05, 0.25, false, 1.5);
  return { map: tex(c, true), normalMap: normalFromHeight(hc, 1.2), repeat: [1 / 8, 1 / 8] };
}

export function wood(): PBRSet {
  const S = 512, planks = 4, ph = S / planks;
  const [c, g] = canvas(S, S); const [hc, hg] = canvas(S, S);
  hg.fillStyle = '#fff'; hg.fillRect(0, 0, S, S);
  for (let p = 0; p < planks; p++) {
    const base = 200 + rnd() * 40;
    g.fillStyle = `rgb(${base},${base * 0.93},${base * 0.84})`; g.fillRect(0, p * ph, S, ph);
    for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(70,45,20,${0.04 + rnd() * 0.1})`; g.lineWidth = 0.6 + rnd() * 1.4; const y = p * ph + rnd() * ph; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + (rnd() - 0.5) * 8, S * 0.6, y + (rnd() - 0.5) * 8, S, y); g.stroke(); }
    g.fillStyle = 'rgba(30,18,8,0.75)'; g.fillRect(0, p * ph, S, 3); hg.fillStyle = '#000'; hg.fillRect(0, p * ph, S, 4);
    const sx = rnd() * S; g.fillRect(sx, p * ph, 3, ph); hg.fillRect(sx, p * ph, 4, ph);
  }
  return { map: tex(c, true), normalMap: normalFromHeight(hc, 2), repeat: [1 / 1.6, 1 / 1.6] };
}

export function bark(): PBRSet {
  const S = 256;
  const [c, g] = canvas(S, S); g.fillStyle = '#d8d0c6'; g.fillRect(0, 0, S, S);
  const [hc, hg] = canvas(S, S); hg.fillStyle = '#909090'; hg.fillRect(0, 0, S, S);
  for (let i = 0; i < 220; i++) { const x = rnd() * S, y = rnd() * S, l = 20 + rnd() * 60; const a = 0.1 + rnd() * 0.25; g.strokeStyle = `rgba(40,25,12,${a})`; hg.strokeStyle = `rgba(0,0,0,${a * 2})`; g.lineWidth = hg.lineWidth = 1 + rnd() * 2.5; for (const q of [g, hg]) { q.beginPath(); q.moveTo(x, y); q.lineTo(x + (rnd() - 0.5) * 6, y + l); q.stroke(); } }
  return { map: tex(c, true), normalMap: normalFromHeight(hc, 2.2), repeat: [1 / 1.2, 1 / 2] };
}

export function foliage(): PBRSet {
  const S = 256;
  const [c, g] = canvas(S, S); g.fillStyle = '#cfd8c4'; g.fillRect(0, 0, S, S);
  const [hc, hg] = canvas(S, S); hg.fillStyle = '#606060'; hg.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S, y = rnd() * S, r = 5 + rnd() * 9, a = rnd() * 7, v = 150 + rnd() * 105;
    g.fillStyle = `rgba(${v * 0.9},${v},${v * 0.75},0.85)`; hg.fillStyle = `rgba(${v},${v},${v},0.8)`;
    for (const q of [g, hg]) { q.beginPath(); q.ellipse(x, y, r, r * 0.45, a, 0, 7); q.fill(); }
    g.strokeStyle = 'rgba(20,40,10,0.25)'; g.lineWidth = 0.6; g.beginPath(); g.ellipse(x, y, r, r * 0.45, a, 0, 7); g.stroke();
  }
  return { map: tex(c, true), normalMap: normalFromHeight(hc, 2.5), repeat: [1 / 2.2, 1 / 2.2] };
}

/** Upper-floor facade: 4x4 windows per tile (2.6 m x 3.4 m each), with glass roughness/metalness and lit-window emissive. */
export function facade(): PBRSet {
  const N = 4, W = 1024, H = 1024, cw = W / N, ch = H / N;
  const [c, g] = canvas(W, H), [rc, rg] = canvas(W, H), [ec, eg] = canvas(W, H), [hc, hg] = canvas(W, H);
  g.fillStyle = '#f2f2f0'; g.fillRect(0, 0, W, H);
  speckle(g, W, H, 9000, 0.01, 0.045, false, 2.2);
  rg.fillStyle = 'rgb(0,225,0)'; rg.fillRect(0, 0, W, H); // G=roughness, B=metalness
  eg.fillStyle = '#000'; eg.fillRect(0, 0, W, H);
  hg.fillStyle = '#b0b0b0'; hg.fillRect(0, 0, W, H);
  for (let j = 0; j < N; j++) {
    // floor slab line + weather streaks
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, j * ch + ch - 10, W, 10);
    hg.fillStyle = '#e0e0e0'; hg.fillRect(0, j * ch + ch - 12, W, 12);
    for (let i = 0; i < N; i++) {
      const x = i * cw + cw * 0.17, y = j * ch + ch * 0.16, w = cw * 0.66, h = ch * 0.58;
      // frame
      g.fillStyle = '#3a3f46'; g.fillRect(x - 5, y - 5, w + 10, h + 10);
      hg.fillStyle = '#d8d8d8'; hg.fillRect(x - 7, y - 7, w + 14, h + 14); hg.fillStyle = '#404040'; hg.fillRect(x, y, w, h);
      // glass with sky gradient
      const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#7f9fb8'); gr.addColorStop(0.55, '#4a6377'); gr.addColorStop(1, '#2c3d4b');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      // interior: blinds / curtains
      const kind = rnd();
      if (kind < 0.35) { g.fillStyle = 'rgba(235,230,215,0.55)'; const bh = h * (0.25 + rnd() * 0.5); g.fillRect(x, y, w, bh); for (let b = y; b < y + bh; b += 6) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, b, w, 1.5); } }
      else if (kind < 0.55) { g.fillStyle = 'rgba(210,190,170,0.5)'; g.fillRect(x, y, w * 0.22, h); g.fillRect(x + w * 0.78, y, w * 0.22, h); }
      // diagonal reflection streak
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.moveTo(x + w * 0.1, y + h); g.lineTo(x + w * 0.5, y); g.lineTo(x + w * 0.72, y); g.lineTo(x + w * 0.32, y + h); g.fill(); g.restore();
      // mullions
      g.fillStyle = '#3a3f46'; g.fillRect(x + w / 2 - 2.5, y, 5, h); g.fillRect(x, y + h * 0.38, w, 4);
      hg.fillStyle = '#c0c0c0'; hg.fillRect(x + w / 2 - 3, y, 6, h); hg.fillRect(x, y + h * 0.38, w, 5);
      // sill
      g.fillStyle = '#d9d6cf'; g.fillRect(x - 12, y + h + 5, w + 24, 9); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x - 12, y + h + 14, w + 24, 5);
      hg.fillStyle = '#ffffff'; hg.fillRect(x - 12, y + h + 5, w + 24, 9);
      // drip stains under sill
      const dg = g.createLinearGradient(0, y + h + 14, 0, y + h + 70); dg.addColorStop(0, 'rgba(60,50,40,0.13)'); dg.addColorStop(1, 'rgba(60,50,40,0)'); g.fillStyle = dg; g.fillRect(x + rnd() * w * 0.6, y + h + 14, 14 + rnd() * 30, 56);
      rg.fillStyle = 'rgb(0,22,170)'; rg.fillRect(x, y, w, h);
      if (rnd() < 0.5) { const warm = rnd() < 0.75; const eg2 = eg.createLinearGradient(0, y, 0, y + h); eg2.addColorStop(0, warm ? '#ffd9a0' : '#cfe4ff'); eg2.addColorStop(1, warm ? '#c98a40' : '#8fb0d8'); eg.fillStyle = eg2; eg.fillRect(x, y, w, h); eg.fillStyle = 'rgba(0,0,0,0.55)'; eg.fillRect(x + w / 2 - 2.5, y, 5, h); if (kind < 0.35) { eg.fillStyle = 'rgba(0,0,0,0.3)'; eg.fillRect(x, y, w, h * 0.4); } }
    }
  }
  return { map: tex(c, true, 16), roughnessMap: tex(rc, false), emissiveMap: tex(ec, true), normalMap: normalFromHeight(hc, 2.2), repeat: [1 / (2.6 * N), 1 / (3.4 * N)] };
}

/** Ground-floor storefront strip: tile is 4 bays x 1 floor (each bay 5.2 m wide, 3.75 m tall). */
export function storefront(): PBRSet {
  const N = 4, W = 2048, H = 512, cw = W / N;
  const [c, g] = canvas(W, H), [rc, rg] = canvas(W, H), [ec, eg] = canvas(W, H), [hc, hg] = canvas(W, H);
  g.fillStyle = '#ecebe8'; g.fillRect(0, 0, W, H);
  speckle(g, W, H, 9000, 0.01, 0.05, false, 2.2);
  rg.fillStyle = 'rgb(0,220,0)'; rg.fillRect(0, 0, W, H); eg.fillStyle = '#000'; eg.fillRect(0, 0, W, H); hg.fillStyle = '#b0b0b0'; hg.fillRect(0, 0, W, H);
  const awn = ['#c9463a', '#2f6f8f', '#3c8a5a', '#e0a23a'];
  for (let i = 0; i < N; i++) {
    const x0 = i * cw;
    // canvas y=0 is the TOP of the wall (v flips), sign band then glass
    g.fillStyle = '#f7f5f0'; g.fillRect(x0 + 14, 22, cw - 28, 70); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.strokeRect(x0 + 14, 22, cw - 28, 70);
    hg.fillStyle = '#e8e8e8'; hg.fillRect(x0 + 14, 22, cw - 28, 70);
    g.fillStyle = 'rgba(40,40,45,0.55)'; for (let k = 0; k < 7 + Math.floor(rnd() * 5); k++) g.fillRect(x0 + 50 + k * 34, 44, 22, 26 - (k % 3) * 4); // abstract lettering
    eg.fillStyle = '#6b6252'; eg.fillRect(x0 + 14, 22, cw - 28, 70);
    // awning
    const ac = awn[i % awn.length];
    g.fillStyle = ac; g.fillRect(x0 + 10, 100, cw - 20, 46); for (let s = 0; s < 6; s++) { g.fillStyle = 'rgba(255,255,255,0.82)'; g.fillRect(x0 + 10 + (s + 0.5) * ((cw - 20) / 6) - 14, 100, 28, 46); }
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x0 + 10, 146, cw - 20, 9);
    hg.fillStyle = '#ffffff'; hg.fillRect(x0 + 10, 100, cw - 20, 50);
    // glazing
    const gy = 160, gh = 290, doorW = 96, dx = x0 + cw - doorW - 46;
    g.fillStyle = '#2a2e34'; g.fillRect(x0 + 24, gy - 6, cw - 48, gh + 12);
    hg.fillStyle = '#d0d0d0'; hg.fillRect(x0 + 24, gy - 6, cw - 48, gh + 12); hg.fillStyle = '#505050'; hg.fillRect(x0 + 32, gy, cw - 64, gh);
    const gr = g.createLinearGradient(0, gy, 0, gy + gh); gr.addColorStop(0, '#6f8ea6'); gr.addColorStop(0.5, '#3b5061'); gr.addColorStop(1, '#232e38');
    g.fillStyle = gr; g.fillRect(x0 + 32, gy, cw - 64, gh);
    // interior silhouettes (shelves / tables)
    g.fillStyle = 'rgba(255,225,170,0.16)'; g.fillRect(x0 + 32, gy, cw - 64, gh);
    for (let s = 0; s < 3; s++) { g.fillStyle = 'rgba(20,16,12,0.35)'; g.fillRect(x0 + 50, gy + 70 + s * 62, dx - x0 - 80, 8); for (let k = 0; k < 9; k++) { g.fillStyle = `hsla(${rnd() * 360},45%,${40 + rnd() * 30}%,0.55)`; g.fillRect(x0 + 56 + k * ((dx - x0 - 100) / 9), gy + 70 + s * 62 - 22 - rnd() * 14, 16, 22 + rnd() * 12); } }
    g.save(); g.beginPath(); g.rect(x0 + 32, gy, cw - 64, gh); g.clip(); g.fillStyle = 'rgba(255,255,255,0.09)'; g.beginPath(); g.moveTo(x0 + 80, gy + gh); g.lineTo(x0 + 250, gy); g.lineTo(x0 + 330, gy); g.lineTo(x0 + 160, gy + gh); g.fill(); g.restore();
    // door + mullions
    g.fillStyle = '#2a2e34'; g.fillRect(dx - 6, gy, 6, gh); g.fillRect(dx + doorW, gy, 6, gh); g.fillRect(x0 + 32 + (dx - x0 - 32) / 2, gy, 5, gh);
    g.fillStyle = '#c9c9c9'; g.fillRect(dx + doorW - 16, gy + gh * 0.5, 5, 40);
    rg.fillStyle = 'rgb(0,20,170)'; rg.fillRect(x0 + 32, gy, cw - 64, gh);
    const e2 = eg.createLinearGradient(0, gy, 0, gy + gh); e2.addColorStop(0, '#ffe2b0'); e2.addColorStop(1, '#b98a4a'); eg.fillStyle = e2; eg.fillRect(x0 + 32, gy, cw - 64, gh);
    for (let s = 0; s < 3; s++) { eg.fillStyle = 'rgba(0,0,0,0.45)'; eg.fillRect(x0 + 50, gy + 48 + s * 62, dx - x0 - 80, 30); }
    // base plinth
    g.fillStyle = '#5b5e63'; g.fillRect(x0, H - 56, cw, 56); g.fillStyle = '#2a2e34'; g.fillRect(dx, gy + gh, doorW, 8);
  }
  return { map: tex(c, true, 16), roughnessMap: tex(rc, false), emissiveMap: tex(ec, true), normalMap: normalFromHeight(hc, 2), repeat: [1 / (5.2 * N), 1 / 3.75] };
}
