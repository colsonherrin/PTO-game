import type { Lighting } from '../engine/renderer';
import { hexToRgb, lerp, type Vec3 } from '../engine/math';

const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const H = hexToRgb;

export function lightingAt(minutes: number, t: number): Lighting {
  const h = (minutes % 1440) / 60;
  const a = (Math.PI * (h - 6)) / 13.5; // 6:00 sunrise → 19:30 sunset
  const elev = Math.sin(a);
  const sunUp = elev > -0.05;
  let dir: Vec3 = sunUp ? [Math.cos(a), Math.max(elev, 0.02) * 0.95, 0.38] : [-0.4, 0.75, -0.3];
  const l = Math.hypot(...dir); dir = [dir[0] / l, dir[1] / l, dir[2] / l];
  const night = sunUp ? Math.max(0, Math.min(1, (0.12 - elev) / 0.17)) : 1;
  const golden = sunUp ? Math.max(0, Math.min(1, 1 - (elev - 0.05) / 0.3)) : 0;

  const dayTop = H('#2f7fd6'), dayHor = H('#a9d4f2'), goldTop = H('#6f86cf'), goldHor = H('#ffbf8f'), nTop = H('#081230'), nHor = H('#1c2a52');
  let top = mix(dayTop, goldTop, golden), hor = mix(dayHor, goldHor, golden);
  top = mix(top, nTop, night); hor = mix(hor, nHor, night);
  let sun = mix(H('#fff4e0'), H('#ffb070'), golden);
  sun = mix(sun, H('#8ea2e8'), night);
  const ambSky = mix(H('#e3ebf5'), H('#33457a'), night);
  const ambGround = mix(H('#a39480'), H('#1a2038'), night);
  const tl = Math.hypot(Math.cos(a), elev, 0.38);
  const sunAz: Vec3 = [Math.cos(a) / tl, elev / tl, 0.38 / tl];
  const fog = mix(mix(H('#a9cbe8'), H('#eab892'), golden), H('#0d1428'), night);
  return { sunDir: dir, sunColor: sun, skyTop: top, skyHorizon: hor, ambientSky: ambSky, ambientGround: ambGround, fogColor: fog, night, time: t, sunElev: elev, sunAz, pointLights: [] };
}
