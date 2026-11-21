import { MeshBuilder, MAT } from '../engine/mesh';
import { hexToRgb, rng, type Vec3 } from '../engine/math';

// ---------------------------------------------------------------------------
// Palmetto Heights — a compact 4x4-block coastal neighborhood.
// x grows east, z grows south. Roads run on a 70m grid; the beach is east.
// ---------------------------------------------------------------------------
export const BLOCK = 56;
export const ROAD = 14;
export const PITCH = BLOCK + ROAD;
export const NB = 4;
export const CITY = NB * PITCH + ROAD; // 294
export const SIDEWALK = 3.5;
export const CURB = 0.15;
export const BEACH_X0 = CITY;
export const OCEAN_X = CITY + 52;

export const roadCenter = (i: number) => i * PITCH + ROAD / 2;
export const blockOrigin = (b: number) => b * PITCH + ROAD;

export interface AABB { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; tag?: string }

export interface POI {
  id: string;
  name: string;
  kind: 'food' | 'work' | 'home' | 'leisure' | 'shop' | 'service' | 'outdoor';
  spot: [number, number]; // where people stand / work
  door: [number, number]; // sidewalk access point
  indoor: boolean; // NPCs disappear inside while here
  radius: number;
  description: string;
}

export interface NavNode { id: number; x: number; z: number; links: number[] }

const C = (h: string) => hexToRgb(h);
const PALETTE = ['#f28f7a', '#f6c28b', '#8fd3c1', '#f3e9d2', '#8ec5e8', '#b8a6d9', '#e8d3a5', '#f5f2ea', '#d9725b', '#7cc6b8', '#f7d6c4', '#c9e4de'];

export class City {
  colliders: AABB[] = [];
  pois: POI[] = [];
  nav: NavNode[] = [];
  lamps: Vec3[] = [];
  parking: { x: number; z: number; yaw: number }[] = [];
  forSaleSpots: { x: number; z: number; yaw: number }[] = [];
  buildingsForMap: { x0: number; z0: number; x1: number; z1: number; color: string }[] = [];
  private grid = new Map<string, number[]>();
  private cell = 12;

  build(): MeshBuilder[] {
    const ground = new MeshBuilder();
    const bld = new MeshBuilder();
    const props = new MeshBuilder();
    const R = rng(1337);

    // --- base ground (roads are asphalt everywhere, blocks raised on top)
    ground.plane(-60, -60, BEACH_X0, CITY + 60, 0, C('#6e7178'), MAT.ASPHALT);
    // outskirts grass
    ground.plane(-60, -60, BEACH_X0, -6, 0.02, C('#7fb069'), MAT.GRASS);
    ground.plane(-60, CITY + 6, BEACH_X0, CITY + 60, 0.02, C('#7fb069'), MAT.GRASS);
    ground.plane(-60, -6, -6, CITY + 6, 0.02, C('#7fb069'), MAT.GRASS);
    // beach + ocean
    ground.plane(BEACH_X0, -60, OCEAN_X + 6, CITY + 60, 0.08, C('#e3cf9f'), MAT.SAND);
    ground.plane(OCEAN_X, -400, 900, 700, 0.0, C('#2a8fb0'), MAT.OCEAN);
    // boardwalk
    ground.box(BEACH_X0 + 4, 0.08, CITY / 2, 4, 0.2, CITY + 40, C('#b08a5e'), MAT.WOOD);

    // edge sidewalks around the outer roads
    const edgeWalk = (x0: number, z0: number, x1: number, z1: number) => ground.box((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, CURB, z1 - z0, C('#cfc9bd'), MAT.PAVE, 0, { noBottom: true });
    edgeWalk(-6, -6, CITY + 6, 0); edgeWalk(-6, CITY, CITY + 6, CITY + 6); edgeWalk(-6, 0, 0, CITY);

    // world bounds
    this.addCollider(-12, -12, -6, CITY + 12, 0, 6, 'bound');
    this.addCollider(-12, -12, OCEAN_X + 20, -7, 0, 6, 'bound');
    this.addCollider(-12, CITY + 7, OCEAN_X + 20, CITY + 12, 0, 6, 'bound');
    this.addCollider(OCEAN_X + 4, -12, OCEAN_X + 10, CITY + 12, 0, 6, 'bound');
    // hedge rows on the edges
    for (let t = -4; t < CITY + 4; t += 2.6) {
      const hc = C(['#3f7a3e', '#4a8a47', '#356e38'][Math.floor(R() * 3)]);
      props.blob(t, 0.8, -8.5, 1.9, 1.3 + R() * 0.5, 1.6, hc, MAT.FOLIAGE, t);
      props.blob(t, 0.8, CITY + 8.5, 1.9, 1.3 + R() * 0.5, 1.6, hc, MAT.FOLIAGE, t + 7);
      props.blob(-8.5, 0.8, t, 1.6, 1.3 + R() * 0.5, 1.9, hc, MAT.FOLIAGE, t + 13);
    }
    // a row of taller trees behind the hedges to close off the horizon
    for (let t = -30; t < CITY + 30; t += 13) {
      for (const [tx, tz] of [[t, -22 - R() * 14], [t, CITY + 22 + R() * 14], [-22 - R() * 14, t]] as [number, number][]) {
        const th = 4 + R() * 3, tr = 3.5 + R() * 2.5;
        props.cylinder(tx, 0, tz, 0.35, th, C('#5d4632'), MAT.BARK, 7, 0.25);
        props.blob(tx, th + tr * 0.55, tz, tr, tr * 0.9, tr, C(['#3e7d42', '#4c9150', '#33703a'][Math.floor(R() * 3)]), MAT.FOLIAGE, tx + tz);
      }
    }

    // --- road markings
    for (let i = 0; i <= NB; i++) {
      const rc = roadCenter(i);
      for (let t = 0; t < CITY; t += 6) {
        // skip intersections
        const inInter = (v: number) => { for (let j = 0; j <= NB; j++) if (Math.abs(v - roadCenter(j)) < ROAD / 2 + 1) return true; return false; };
        if (!inInter(t + 1.5)) {
          ground.plane(rc - 0.12, t, rc + 0.12, t + 3, 0.012, C('#f2c14e'), MAT.PLAIN);
          ground.plane(t, rc - 0.12, t + 3, rc + 0.12, 0.012, C('#f2c14e'), MAT.PLAIN);
        }
      }
      // crosswalk zebra stripes at each intersection
      for (let j = 0; j <= NB; j++) {
        const cx = rc, cz = roadCenter(j);
        for (let s = -5; s <= 5; s += 1.4) {
          for (const side of [-1, 1]) {
            ground.plane(cx + s - 0.35, cz + side * (ROAD / 2 + 1.0) - 1.0, cx + s + 0.35, cz + side * (ROAD / 2 + 1.0) + 1.0, 0.013, C('#ece8df'), MAT.PLAIN);
            ground.plane(cx + side * (ROAD / 2 + 1.0) - 1.0, cz + s - 0.35, cx + side * (ROAD / 2 + 1.0) + 1.0, cz + s + 0.35, 0.013, C('#ece8df'), MAT.PLAIN);
          }
        }
      }
    }

    // --- blocks
    for (let bz = 0; bz < NB; bz++) {
      for (let bx = 0; bx < NB; bx++) {
        const ox = blockOrigin(bx), oz = blockOrigin(bz);
        // raised sidewalk slab across the whole block
        ground.box(ox + BLOCK / 2, 0, oz + BLOCK / 2, BLOCK, CURB, BLOCK, C('#d8d2c4'), MAT.PAVE, 0, { noBottom: true });
        // curb edge strip
        this.buildBlock(bx, bz, ox, oz, ground, bld, props, R);
        // street lamps + palms along the sidewalk
        for (let t = 8; t < BLOCK; t += 20) {
          for (const [lx, lz] of [[ox + t, oz + 1.0], [ox + t, oz + BLOCK - 1.0], [ox + 1.0, oz + t], [ox + BLOCK - 1.0, oz + t]] as [number, number][]) {
            this.lamp(props, lx, lz);
          }
        }
        for (let t = 18; t < BLOCK - 8; t += 20) {
          if (R() < 0.75) this.palm(props, ox + t, oz + 1.6, R);
          if (R() < 0.75) this.palm(props, ox + t, oz + BLOCK - 1.6, R);
        }
      }
    }

    // beach dressing
    for (let z = 10; z < CITY; z += 22) {
      this.palm(props, BEACH_X0 + 10 + R() * 6, z + R() * 6, R);
      // umbrellas + towels
      const ux = BEACH_X0 + 22 + R() * 18, uz = z + 8;
      props.cylinder(ux, 0.1, uz, 0.06, 2.4, C('#eeeeee'));
      props.cylinder(ux, 2.2, uz, 1.6, 0.5, C(R() > 0.5 ? '#f28f7a' : '#3fa7a3'), 0, 8, 0.05);
      props.box(ux + 1.4, 0.1, uz, 1.0, 0.03, 2.0, C(PALETTE[Math.floor(R() * PALETTE.length)]));
    }
    // lifeguard tower
    const lgx = BEACH_X0 + 30, lgz = 150;
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) props.box(lgx + a * 1.1, 0, lgz + b * 1.1, 0.2, 3, 0.2, C('#f5f2ea'));
    props.box(lgx, 3, lgz, 3, 2, 3, C('#e94f37'));
    props.box(lgx, 5, lgz, 3.6, 0.3, 3.6, C('#f5f2ea'));
    this.addCollider(lgx - 1.4, lgz - 1.4, lgx + 1.4, lgz + 1.4, 0, 5, 'prop');
    this.poi({ id: 'beach', name: 'Palmetto Beach', kind: 'outdoor', spot: [BEACH_X0 + 24, 140], door: [BEACH_X0 + 4, 140], indoor: false, radius: 18, description: 'Sandy beach and boardwalk on the east edge of town.' });

    this.buildNav();
    this.buildParking();
    return [ground, bld, props];
  }

  // -------------------------------------------------------------------------
  private buildBlock(bx: number, bz: number, ox: number, oz: number, g: MeshBuilder, b: MeshBuilder, p: MeshBuilder, R: () => number) {
    const key = `${bx},${bz}`;
    const L = (x0: number, z0: number, x1: number, z1: number, h: number, col?: string, mat: number = MAT.FACADE, tag = 'building') => {
      const color = col ?? PALETTE[Math.floor(R() * PALETTE.length)];
      this.building(b, ox + x0, oz + z0, ox + x1, oz + z1, h, color, mat, R, tag);
    };
    const doorAt = (lx: number, lz: number): [number, number] => {
      // snap a local point to the nearest sidewalk band
      const d = [lx, BLOCK - lx, lz, BLOCK - lz];
      const m = Math.min(...d);
      if (m === d[0]) return [ox + 1.75, oz + lz];
      if (m === d[1]) return [ox + BLOCK - 1.75, oz + lz];
      if (m === d[2]) return [ox + lx, oz + 1.75];
      return [ox + lx, oz + BLOCK - 1.75];
    };
    const P = (id: string, name: string, kind: POI['kind'], lx: number, lz: number, indoor: boolean, description: string, radius = 6, door?: [number, number]) => {
      this.poi({ id, name, kind, spot: [ox + lx, oz + lz], door: door ?? doorAt(lx, lz), indoor, radius, description });
    };
    const downtown = (minH: number, maxH: number) => {
      L(4.5, 4.5, 25, 25, minH + R() * (maxH - minH));
      L(31, 4.5, 51.5, 25, minH + R() * (maxH - minH));
      L(4.5, 31, 25, 51.5, minH + R() * (maxH - minH));
      L(31, 31, 51.5, 51.5, minH + R() * (maxH - minH));
    };
    const mixed = () => {
      L(4.5, 4.5, 20, 17, 7 + R() * 6); L(22, 4.5, 36, 17, 6 + R() * 8); L(38, 4.5, 51.5, 17, 8 + R() * 6);
      L(4.5, 39, 24, 51.5, 7 + R() * 7); L(27, 39, 51.5, 51.5, 6 + R() * 8);
      L(4.5, 20, 15, 36, 9 + R() * 5); L(41, 20, 51.5, 36, 8 + R() * 5);
      // courtyard tree
      this.tree(p, ox + 28, oz + 28, R);
    };
    const apts = (col1: string, col2: string) => {
      L(4.5, 4.5, 22, 51.5, 16 + R() * 6, col1);
      L(30, 4.5, 51.5, 22, 13 + R() * 6, col2);
      // pool courtyard
      g.box(ox + 40, CURB, oz + 38, 14, 0.05, 16, C('#e9e2d0'), MAT.PAVE, 0, { noBottom: true });
      g.plane(ox + 35, oz + 32, ox + 45, oz + 44, CURB + 0.07, C('#4fc3d9'), MAT.WATER);
      this.palm(p, ox + 31, oz + 30, R); this.palm(p, ox + 49, oz + 47, R);
    };

    switch (key) {
      case '0,0':
        apts('#f7d6c4', '#8fd3c1');
        P('seabreeze_apts', 'Seabreeze Apartments', 'home', 13, 53, true, 'Pastel apartment complex with a pool, northwest corner of town.', 5, [ox + 13, oz + BLOCK - 1.75]);
        break;
      case '1,0':
        L(5, 5, 33, 33, 46, '#5fa8b5', MAT.FACADE, 'tower');
        L(37, 4.5, 51.5, 30, 18);
        L(37, 36, 51.5, 51.5, 5, '#f5f2ea');
        P('tidewater_labs', 'Tidewater Labs', 'work', 19, 35, true, 'Glass tech office tower where software folks work.', 5, [ox + 19, oz + BLOCK - 1.75]);
        P('nair_realty', 'Nair Realty', 'work', 44, 53, true, 'Small real-estate office. Handles storefront leases.', 4, [ox + 44, oz + BLOCK - 1.75]);
        break;
      case '2,0': downtown(18, 40); break;
      case '3,0':
        apts('#b8a6d9', '#f6c28b');
        P('harbor_lofts', 'Harbor Lofts', 'home', 13, 53, true, 'Converted warehouse lofts near the beach.', 5, [ox + 13, oz + BLOCK - 1.75]);
        break;
      case '0,1':
        L(5, 5, 30, 27, 10, '#f5f2ea');
        // red cross sign
        b.box(ox + 30.1, 6, oz + 16, 0.2, 2.4, 0.8, C('#ff4b4b'), MAT.EMISSIVE);
        b.box(ox + 30.1, 6.8, oz + 16, 0.2, 0.8, 2.4, C('#ff4b4b'), MAT.EMISSIVE);
        L(5, 31, 30, 51.5, 8, '#3fa7a3');
        L(35, 5, 51.5, 51.5, 12);
        P('clinic', 'Palmetto Clinic', 'service', 31.5, 16, true, 'Neighborhood clinic. Patches people up.', 4);
        P('gym', 'Iron Palm Gym', 'leisure', 31.5, 42, true, 'Gym on the west side.', 4);
        break;
      case '1,1': {
        // central plaza
        g.box(ox + BLOCK / 2, CURB, oz + BLOCK / 2, BLOCK - 7, 0.04, BLOCK - 7, C('#e7dcc7'), MAT.PAVE, 0, { noBottom: true });
        for (let k = 0; k < 6; k++) g.plane(ox + 4 + k * 8.2, oz + 4, ox + 4.4 + k * 8.2, oz + 52, CURB + 0.05, C('#d3c4a8'));
        // fountain
        const fx = ox + 28, fz = oz + 28;
        p.cylinder(fx, CURB, fz, 5, 0.7, C('#e8e1d3'), 0, 16);
        p.cylinder(fx, CURB + 0.6, fz, 4.4, 0.12, C('#3fb6c9'), MAT.WATER, 16);
        p.cylinder(fx, CURB, fz, 0.6, 2.6, C('#e8e1d3'), 0, 10);
        p.cylinder(fx, CURB + 2.4, fz, 1.6, 0.25, C('#e8e1d3'), 0, 12);
        this.addCollider(fx - 4.6, fz - 4.6, fx + 4.6, fz + 4.6, 0, 0.9, 'fountain');
        for (const [dx, dz, yaw] of [[0, -9, 0], [0, 9, 0], [-9, 0, Math.PI / 2], [9, 0, Math.PI / 2]]) this.bench(p, fx + dx, fz + dz, yaw);
        for (const [dx, dz] of [[-16, -16], [16, -16], [-16, 16], [16, 16]]) this.palm(p, fx + dx, fz + dz, R);
        // newsstand kiosk
        p.box(ox + 8, CURB, oz + 8, 3.2, 2.6, 2.4, C('#2f6f8f'));
        p.box(ox + 8, CURB + 2.6, oz + 8, 3.8, 0.25, 3.0, C('#f2c14e'));
        p.box(ox + 9.65, CURB + 0.6, oz + 8, 0.1, 1.0, 1.8, C('#f5f2ea'), MAT.EMISSIVE);
        this.addCollider(ox + 6.4, oz + 6.8, ox + 9.6, oz + 9.2, 0, 2.8, 'prop');
        P('newsstand', "Omar's Newsstand", 'shop', 10.6, 8, false, 'Corner newsstand in Central Plaza. Papers, snacks, gossip.', 3);
        P('central_plaza', 'Central Plaza', 'outdoor', 28, 20, false, 'Open plaza with a fountain in the middle of town. Street performers play here.', 10);
        break;
      }
      case '2,1': {
        // Sol Café — corner kiosk with patio
        L(9, 8, 21, 20, 4.4, '#f6c28b', MAT.FACADE, 'cafe');
        // striped awning
        for (let k = 0; k < 6; k++) b.box(ox + 8.2, 3.0, oz + 8.5 + k * 2, 1.8, 0.18, 2, C(k % 2 ? '#f5f2ea' : '#e9573f'), MAT.PLAIN, 0);
        b.box(ox + 8.6, 0, oz + 14, 0.8, 1.1, 10, C('#8a5a3b')); // counter
        this.addCollider(ox + 8.2, oz + 9, ox + 9.0, oz + 19, 0, 1.1, 'counter');
        b.box(ox + 15, 4.4, oz + 14, 6, 1.2, 0.3, C('#ffcf5c'), MAT.LAMP); // sign
        for (const [tx, tz] of [[5.4, 9.5], [5.4, 14], [5.4, 18.5]]) this.cafeTable(p, ox + tx, oz + tz, R);
        P('sol_cafe', 'Sol Café', 'food', 7.4, 14, false, 'Cozy corner café with a striped awning and patio. Coffee $4, pastries $3.', 6, [ox + 1.75, oz + 14]);
        // vacant corner kiosk (lease-able business)
        L(9, 24, 19, 33, 4.2, '#c9e4de', MAT.FACADE, 'kiosk');
        b.box(ox + 8.9, 1.2, oz + 28.5, 0.15, 1.2, 2.6, C('#ff7f50'), MAT.LAMP); // FOR LEASE sign
        P('corner_kiosk', 'Corner Kiosk (for lease)', 'shop', 7.2, 28.5, false, 'Small vacant storefront with a FOR LEASE sign. Leasable through Nair Realty.', 3, [ox + 1.75, oz + 28.5]);
        L(24, 4.5, 51.5, 18, 9); L(4.5, 37, 30, 51.5, 11); L(34, 22, 51.5, 51.5, 14);
        break;
      }
      case '3,1':
        L(6, 6, 24, 22, 7, '#2e3a59', MAT.FACADE, 'bar');
        b.box(ox + 5.9, 4.6, oz + 14, 0.2, 1.0, 7, C('#ff4fa3'), MAT.LAMP); // neon
        b.box(ox + 5.9, 5.8, oz + 14, 0.2, 0.5, 4, C('#4ff0ff'), MAT.LAMP);
        P('low_tide_bar', 'The Low Tide', 'leisure', 4.5, 14, false, 'Dim nautical bar with neon signs. Live music some nights.', 5, [ox + 1.75, oz + 14]);
        L(28, 4.5, 51.5, 22, 10); L(4.5, 27, 24, 51.5, 12); L(28, 27, 51.5, 51.5, 9);
        break;
      case '0,2':
        apts('#f28f7a', '#f3e9d2');
        P('palm_court_apts', 'Palm Court Apartments', 'home', 13, 2, true, 'Coral apartment block on the west side.', 5, [ox + 13, oz + 1.75]);
        break;
      case '1,2': {
        // Palmetto Park
        g.box(ox + BLOCK / 2, CURB, oz + BLOCK / 2, BLOCK - 7, 0.04, BLOCK - 7, C('#7fb069'), MAT.GRASS, 0, { noBottom: true });
        g.box(ox + BLOCK / 2, CURB + 0.04, oz + BLOCK / 2, 3.5, 0.02, BLOCK - 7, C('#e2d3b0'), MAT.SAND, 0, { noBottom: true });
        g.box(ox + BLOCK / 2, CURB + 0.04, oz + BLOCK / 2, BLOCK - 7, 0.02, 3.5, C('#e2d3b0'), MAT.SAND, 0, { noBottom: true });
        g.cylinder(ox + 42, CURB + 0.02, oz + 42, 6, 0.05, C('#3fa7a3'), MAT.WATER, 16);
        this.addCollider(ox + 36.5, oz + 36.5, ox + 47.5, oz + 47.5, 0, 0.5, 'pond');
        for (let k = 0; k < 14; k++) {
          const tx = 6 + R() * 44, tz = 6 + R() * 44;
          if (Math.abs(tx - 28) < 4 || Math.abs(tz - 28) < 4) continue;
          if (Math.hypot(tx - 42, tz - 42) < 8 || Math.hypot(tx - 33, tz - 22) < 6) continue;
          this.tree(p, ox + tx, oz + tz, R);
        }
        for (const [dx, dz, yaw] of [[24, 12, Math.PI / 2], [32, 40, Math.PI / 2], [14, 24, 0], [40, 32, 0]]) this.bench(p, ox + dx, oz + dz, yaw);
        // food truck
        this.foodTruck(p, ox + 34, oz + 21);
        P('food_truck', "Jaz's Taco Truck", 'food', 31.5, 24.2, false, 'Bright teal taco truck in Palmetto Park. Tacos $6.', 4, [ox + 28, oz + BLOCK - 1.75]);
        P('palmetto_park', 'Palmetto Park', 'outdoor', 20, 34, false, 'Green park with a pond, benches and shady trees.', 12, [ox + 28, oz + BLOCK - 1.75]);
        break;
      }
      case '3,2': {
        // Bellini Motors lot + Ellis Auto
        g.box(ox + 19, CURB, oz + 22, 30, 0.03, 36, C('#a9adb5'), MAT.ASPHALT, 0, { noBottom: true });
        for (let k = 0; k < 4; k++) g.plane(ox + 6 + k * 7, oz + 6, ox + 6.15 + k * 7, oz + 16, CURB + 0.04, C('#f5f2ea'));
        L(26, 26, 34, 34, 3.6, '#f5f2ea', MAT.FACADE, 'booth');
        for (let k = 0; k < 6; k++) {
          const fx = ox + 5 + k * 5;
          p.cylinder(fx, CURB, oz + 40.5, 0.06, 5, C('#dddddd'));
          p.box(fx + 0.6, CURB + 4, oz + 40.5, 1.2, 0.9, 0.05, C(k % 2 ? '#e9573f' : '#f2c14e'), MAT.LAMP);
        }
        L(38, 4.5, 51.5, 30, 7, '#9aa5b1', MAT.FACADE, 'garage');
        b.box(ox + 37.9, 0.15, oz + 17, 0.2, 4.2, 8, C('#4b5563'));
        P('bellini_motors', 'Bellini Motors', 'shop', 24, 30, false, 'Used-car lot with colorful flags. Cars for sale.', 8, [ox + 1.75, oz + 30]);
        P('ellis_auto', 'Ellis Auto Repair', 'work', 36, 17, false, 'Mechanic garage next to the car lot.', 4, [ox + 36, oz + 1.75]);
        L(4.5, 44, 51.5, 51.5, 6);
        for (let k = 0; k < 4; k++) this.forSaleSpots.push({ x: ox + 8 + k * 7, z: oz + 11, yaw: Math.PI });
        break;
      }
      case '0,3':
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
          const hx = 6 + i * 16, hz = 6 + j * 16;
          this.house(b, ox + hx, oz + hz, R);
        }
        break;
      case '1,3': downtown(12, 26); break;
      case '2,3': mixed(); break;
      case '3,3':
        g.box(ox + 20, CURB, oz + 28, 32, 0.03, 45, C('#8e939b'), MAT.ASPHALT, 0, { noBottom: true });
        L(38, 6, 51.5, 51.5, 9, '#c7b9a5');
        break;
      default: mixed();
    }
    if (key === '2,2') {
      P('marina_diner', 'Marina Diner', 'food', 12, 2, true, 'Retro diner with chrome stools, open late.', 4, [ox + 12, oz + 1.75]);
    }
  }

  private building(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, h: number, color: string, mat: number, R: () => number, tag: string) {
    const col = C(color);
    const roof = col.map((c) => c * 0.7) as Vec3;
    b.box((x0 + x1) / 2, CURB, (z0 + z1) / 2, x1 - x0, h, z1 - z0, col, mat, 0, { noBottom: true, topCol: roof, topMat: MAT.PLAIN });
    // base plinth
    b.box((x0 + x1) / 2, CURB, (z0 + z1) / 2, x1 - x0 + 0.3, 0.5, z1 - z0 + 0.3, col.map((c) => c * 0.6) as Vec3, MAT.PLAIN, 0, { noBottom: true });
    // parapet + roof clutter
    if (h > 5) {
      const pc = col.map((c) => c * 0.85) as Vec3;
      const t = 0.4, ph = 0.8, y = CURB + h;
      b.box((x0 + x1) / 2, y, z0 + t / 2, x1 - x0, ph, t, pc);
      b.box((x0 + x1) / 2, y, z1 - t / 2, x1 - x0, ph, t, pc);
      b.box(x0 + t / 2, y, (z0 + z1) / 2, t, ph, z1 - z0, pc);
      b.box(x1 - t / 2, y, (z0 + z1) / 2, t, ph, z1 - z0, pc);
      const n = 1 + Math.floor(R() * 3);
      for (let k = 0; k < n; k++) {
        const ax = x0 + 2 + R() * (x1 - x0 - 4), az = z0 + 2 + R() * (z1 - z0 - 4);
        b.box(ax, y, az, 1.6 + R() * 1.5, 1 + R() * 1.2, 1.6 + R(), C('#b7bcc4'));
      }
      if (tag === 'tower') {
        b.box((x0 + x1) / 2, y, (z0 + z1) / 2, 6, 4, 6, C('#3d7f8c'));
        b.cylinder((x0 + x1) / 2, y + 4, (z0 + z1) / 2, 0.15, 8, C('#dddddd'));
        b.box((x0 + x1) / 2, y + 12, (z0 + z1) / 2, 0.5, 0.5, 0.5, C('#ff3b3b'), MAT.EMISSIVE);
      }
    }
    this.addCollider(x0 - 0.15, z0 - 0.15, x1 + 0.15, z1 + 0.15, 0, CURB + h, tag);
    this.buildingsForMap.push({ x0, z0, x1, z1, color });
  }

  private house(b: MeshBuilder, x: number, z: number, R: () => number) {
    const col = PALETTE[Math.floor(R() * PALETTE.length)];
    this.building(b, x, z, x + 10, z + 9, 4.5, col, MAT.FACADE, R, 'house');
    // pitched roof approximation: stacked slabs
    const rc = C(R() > 0.5 ? '#b5523b' : '#5b6b7a');
    for (let k = 0; k < 4; k++) b.box(x + 5, CURB + 4.5 + k * 0.5, z + 4.5, 10.6 - k * 2.4, 0.5, 9.6, rc);
  }

  private lamp(p: MeshBuilder, x: number, z: number) {
    p.cylinder(x, CURB, z, 0.11, 5.2, C('#2b2f36'), 0, 8, 0.07);
    p.cylinder(x, CURB, z, 0.2, 0.5, C('#2b2f36'), 0, 8, 0.12);
    p.box(x, CURB + 5.0, z, 0.7, 0.18, 0.7, C('#2b2f36'));
    p.box(x, CURB + 4.82, z, 0.5, 0.18, 0.5, C('#ffd9a0'), MAT.LAMP);
    this.lamps.push([x, CURB + 4.6, z]);
    this.addCollider(x - 0.15, z - 0.15, x + 0.15, z + 0.15, 0, 5, 'lamp');
  }

  palm(p: MeshBuilder, x: number, z: number, R: () => number) {
    const h = 6 + R() * 3;
    const lean = (R() - 0.5) * 0.6;
    let cx = x, cz = z;
    const segs = 6;
    for (let k = 0; k < segs; k++) {
      const y = CURB + (k * h) / segs;
      p.cylinder(cx, y, cz, 0.24 - k * 0.015, h / segs + 0.05, C(k % 2 ? '#8d6e4f' : '#7b5e43'), MAT.BARK, 8, 0.22 - k * 0.015);
      cx += lean * 0.12; cz += lean * 0.08;
    }
    const topY = CURB + h;
    const greens = ['#3f9a52', '#4cae5d', '#2f8a46'];
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + R() * 0.3;
      const up = k % 2 ? 0.2 : 1;
      p.leaf(cx, topY, cz, Math.cos(a), Math.sin(a), 3.4 + R() * 1.0, 0.5, (1.0 + R() * 0.8) * (2 - up), C(greens[k % 3]));
    }
    p.blob(cx, topY - 0.15, cz, 0.42, 0.45, 0.42, C('#6b4f2a'), MAT.BARK, cx);
    this.addCollider(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 0, h, 'tree');
  }

  private tree(p: MeshBuilder, x: number, z: number, R: () => number) {
    const h = 2.4 + R() * 1.2;
    p.cylinder(x, CURB, z, 0.28, h + 0.6, C('#6a503a'), MAT.BARK, 8, 0.16);
    const g = C(['#3f8a49', '#4a9a53', '#357c41'][Math.floor(R() * 3)]);
    const s = 2.1 + R() * 1.0;
    p.blob(x, CURB + h + s * 0.55, z, s, s * 0.85, s, g, MAT.FOLIAGE, x * 3 + z);
    p.blob(x + s * 0.5, CURB + h + s * 0.3, z + s * 0.3, s * 0.6, s * 0.55, s * 0.6, g.map((c) => c * 0.92) as Vec3, MAT.FOLIAGE, x + z * 5);
    p.blob(x - s * 0.45, CURB + h + s * 0.45, z - s * 0.35, s * 0.65, s * 0.55, s * 0.65, g.map((c) => c * 1.08) as Vec3, MAT.FOLIAGE, x * 7 + z);
    this.addCollider(x - 0.35, z - 0.35, x + 0.35, z + 0.35, 0, h + 2, 'tree');
  }

  private bench(p: MeshBuilder, x: number, z: number, yaw: number) {
    p.box(x, CURB + 0.42, z, 2.2, 0.1, 0.6, C('#9c6b43'), MAT.WOOD, yaw);
    const bx = Math.sin(yaw) * 0.28, bz = Math.cos(yaw) * 0.28;
    p.box(x + bx, CURB + 0.5, z + bz, 2.2, 0.5, 0.08, C('#9c6b43'), MAT.WOOD, yaw);
    p.box(x, CURB, z, 2.0, 0.42, 0.4, C('#3a3f47'), 0, yaw);
    const ex = Math.abs(Math.cos(yaw)) * 1.1 + 0.3, ez = Math.abs(Math.sin(yaw)) * 1.1 + 0.3;
    this.addCollider(x - ex, z - ez, x + ex, z + ez, 0, 0.9, 'bench');
  }

  private cafeTable(p: MeshBuilder, x: number, z: number, R: () => number) {
    p.cylinder(x, CURB, z, 0.05, 0.75, C('#333333'));
    p.cylinder(x, CURB + 0.75, z, 0.5, 0.05, C('#f5f2ea'), 0, 10);
    p.cylinder(x, CURB, z, 0.04, 2.3, C('#dddddd'));
    p.cylinder(x, CURB + 2.1, z, 1.3, 0.4, C(R() > 0.5 ? '#e9573f' : '#f2c14e'), 0, 8, 0.05);
    for (const s of [-1, 1]) p.box(x, CURB, z + s * 0.75, 0.4, 0.45, 0.4, C('#3a6ea5'));
    this.addCollider(x - 0.5, z - 0.5, x + 0.5, z + 0.5, 0, 1, 'table');
  }

  private foodTruck(p: MeshBuilder, x: number, z: number) {
    p.box(x, CURB + 0.6, z, 6, 2.6, 2.6, C('#2ec4b6'));
    p.box(x + 3.6, CURB + 0.6, z, 1.6, 1.8, 2.5, C('#2ec4b6'));
    p.box(x + 4.0, CURB + 1.4, z, 0.9, 0.9, 2.52, C('#24323f'));
    p.box(x - 0.5, CURB + 1.6, z + 1.31, 3.4, 1.0, 0.04, C('#24323f'));
    p.box(x - 0.5, CURB + 2.7, z + 1.6, 3.8, 0.1, 0.8, C('#ff9f1c'));
    p.box(x, CURB + 3.2, z, 3, 0.6, 0.2, C('#ffbf69'), MAT.LAMP);
    for (const [wx, wz] of [[-2, 1.3], [2.8, 1.3], [-2, -1.3], [2.8, -1.3]]) p.box(x + wx, CURB, z + wz, 0.8, 0.8, 0.3, C('#1f1f1f'));
    this.addCollider(x - 3.1, z - 1.4, x + 4.5, z + 1.4, 0, 3.4, 'truck');
  }

  // -------------------------------------------------------------------------
  addCollider(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tag?: string) {
    const c: AABB = { x0, z0, x1, z1, y0, y1, tag };
    const idx = this.colliders.push(c) - 1;
    for (let gx = Math.floor(x0 / this.cell); gx <= Math.floor(x1 / this.cell); gx++)
      for (let gz = Math.floor(z0 / this.cell); gz <= Math.floor(z1 / this.cell); gz++) {
        const k = gx + ',' + gz;
        const l = this.grid.get(k);
        if (l) l.push(idx); else this.grid.set(k, [idx]);
      }
  }

  query(x: number, z: number, r: number): AABB[] {
    const out = new Set<number>();
    for (let gx = Math.floor((x - r) / this.cell); gx <= Math.floor((x + r) / this.cell); gx++)
      for (let gz = Math.floor((z - r) / this.cell); gz <= Math.floor((z + r) / this.cell); gz++) {
        const l = this.grid.get(gx + ',' + gz);
        if (l) for (const i of l) out.add(i);
      }
    return [...out].map((i) => this.colliders[i]);
  }

  /** Segment test against tall colliders (camera / line-of-sight). Returns hit fraction 0..1. */
  raycast(ax: number, ay: number, az: number, bx: number, by: number, bz: number, minHeight = 2): number {
    let best = 1;
    const len = Math.hypot(bx - ax, bz - az);
    const cand = this.query((ax + bx) / 2, (az + bz) / 2, len / 2 + 2);
    for (const c of cand) {
      if (c.y1 - c.y0 < minHeight) continue;
      // slab test in 3D
      let t0 = 0, t1 = 1;
      const d = [bx - ax, by - ay, bz - az], o = [ax, ay, az], mn = [c.x0, c.y0, c.z0], mx = [c.x1, c.y1, c.z1];
      let ok = true;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(d[k]) < 1e-6) { if (o[k] < mn[k] || o[k] > mx[k]) { ok = false; break; } continue; }
        let ta = (mn[k] - o[k]) / d[k], tb = (mx[k] - o[k]) / d[k];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 < best) best = t0;
    }
    return best;
  }

  groundHeight(x: number, z: number): number {
    if (x >= BEACH_X0) return 0.08;
    if (x < -0.01 || z < -0.01 || z > CITY + 0.01) return CURB; // edge walks / grass
    const inBlock = (v: number) => { const m = v % PITCH; return m >= ROAD; };
    return inBlock(x) && inBlock(z) && x < CITY && z < CITY ? CURB : 0;
  }

  isRoad(x: number, z: number): boolean {
    if (x < 0 || z < 0 || x > CITY || z > CITY) return false;
    return (x % PITCH) < ROAD || (z % PITCH) < ROAD;
  }

  private poi(p: POI) { this.pois.push(p); }
  getPOI(id: string) { return this.pois.find((p) => p.id === id); }

  // -------------------------------------------------------------------------
  // Pedestrian navigation graph: rings of sidewalk nodes + crosswalks + POI links.
  private buildNav() {
    const nodes: NavNode[] = [];
    const add = (x: number, z: number) => { const n = { id: nodes.length, x, z, links: [] as number[] }; nodes.push(n); return n.id; };
    const link = (a: number, b: number) => { if (a === b) return; if (!nodes[a].links.includes(b)) nodes[a].links.push(b); if (!nodes[b].links.includes(a)) nodes[b].links.push(a); };
    const inset = 1.75;
    const corner: number[][][] = [];
    for (let bx = 0; bx < NB; bx++) {
      corner[bx] = [];
      for (let bz = 0; bz < NB; bz++) {
        const ox = blockOrigin(bx), oz = blockOrigin(bz);
        const pts: [number, number][] = [];
        const steps = 4;
        // walk the perimeter clockwise: top edge, right edge, bottom edge, left edge
        for (let s = 0; s < steps; s++) pts.push([ox + inset + ((BLOCK - 2 * inset) * s) / steps, oz + inset]);
        for (let s = 0; s < steps; s++) pts.push([ox + BLOCK - inset, oz + inset + ((BLOCK - 2 * inset) * s) / steps]);
        for (let s = 0; s < steps; s++) pts.push([ox + BLOCK - inset - ((BLOCK - 2 * inset) * s) / steps, oz + BLOCK - inset]);
        for (let s = 0; s < steps; s++) pts.push([ox + inset, oz + BLOCK - inset - ((BLOCK - 2 * inset) * s) / steps]);
        const ids = pts.map(([x, z]) => add(x, z));
        ids.forEach((id, k) => link(id, ids[(k + 1) % ids.length]));
        // corners: NW=0, NE=steps, SE=2*steps, SW=3*steps
        corner[bx][bz] = [ids[0], ids[steps], ids[2 * steps], ids[3 * steps]];
      }
    }
    // crosswalks between adjacent blocks
    for (let bx = 0; bx < NB; bx++) for (let bz = 0; bz < NB; bz++) {
      const c = corner[bx][bz];
      if (bx + 1 < NB) { const n = corner[bx + 1][bz]; link(c[1], n[0]); link(c[2], n[3]); }
      if (bz + 1 < NB) { const n = corner[bx][bz + 1]; link(c[3], n[0]); link(c[2], n[1]); }
    }
    // beach access from east blocks
    const beachNodes: number[] = [];
    for (let bz = 0; bz < NB; bz++) {
      const c = corner[NB - 1][bz];
      const b1 = add(BEACH_X0 + 4, nodes[c[1]].z), b2 = add(BEACH_X0 + 4, nodes[c[2]].z);
      link(c[1], b1); link(c[2], b2); link(b1, b2);
      beachNodes.push(b1, b2);
    }
    for (let k = 0; k + 2 < beachNodes.length; k += 2) link(beachNodes[k + 1], beachNodes[k + 2]);
    this.nav = nodes;
    // POI doors + spots
    for (const p of this.pois) {
      const d = add(p.door[0], p.door[1]);
      // connect door to two nearest ring nodes
      const near = nodes.filter((n) => n.id !== d && n.id < d).map((n) => ({ n, dd: Math.hypot(n.x - p.door[0], n.z - p.door[1]) })).sort((a, b) => a.dd - b.dd).slice(0, 2);
      for (const { n } of near) link(d, n.id);
      const s = add(p.spot[0], p.spot[1]);
      link(d, s);
      (p as POI & { doorNode?: number; spotNode?: number }).doorNode = d;
      (p as POI & { doorNode?: number; spotNode?: number }).spotNode = s;
    }
  }

  nearestNav(x: number, z: number): number {
    let best = 0, bd = Infinity;
    for (const n of this.nav) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n.id; } }
    return best;
  }

  /** A* over the sidewalk graph. Returns list of [x,z]. */
  path(fromX: number, fromZ: number, toNode: number): [number, number][] {
    const start = this.nearestNav(fromX, fromZ);
    const N = this.nav;
    const g = new Map<number, number>([[start, 0]]);
    const came = new Map<number, number>();
    const open = new Set<number>([start]);
    const h = (i: number) => Math.hypot(N[i].x - N[toNode].x, N[i].z - N[toNode].z);
    const f = new Map<number, number>([[start, h(start)]]);
    let guard = 0;
    while (open.size && guard++ < 5000) {
      let cur = -1, bf = Infinity;
      for (const o of open) { const v = f.get(o)!; if (v < bf) { bf = v; cur = o; } }
      if (cur === toNode) break;
      open.delete(cur);
      for (const nb of N[cur].links) {
        const ng = g.get(cur)! + Math.hypot(N[cur].x - N[nb].x, N[cur].z - N[nb].z);
        if (ng < (g.get(nb) ?? Infinity)) { came.set(nb, cur); g.set(nb, ng); f.set(nb, ng + h(nb)); open.add(nb); }
      }
    }
    const out: [number, number][] = [];
    let c: number | undefined = toNode;
    if (!came.has(toNode) && toNode !== start) return [[N[toNode].x, N[toNode].z]];
    while (c !== undefined) { out.push([N[c].x, N[c].z]); if (c === start) break; c = came.get(c); }
    return out.reverse();
  }

  private buildParking() {
    // curbside spots along each road segment (both sides), avoiding intersections
    for (let i = 0; i <= NB; i++) {
      const rc = roadCenter(i);
      for (let b = 0; b < NB; b++) {
        const o = blockOrigin(b);
        for (const t of [o + 14, o + 38]) {
          this.parking.push({ x: rc + 5.2, z: t, yaw: Math.PI }); // southbound side (east curb)
          this.parking.push({ x: rc - 5.2, z: t, yaw: 0 });
          this.parking.push({ x: t, z: rc + 5.2, yaw: Math.PI / 2 });
          this.parking.push({ x: t, z: rc - 5.2, yaw: -Math.PI / 2 });
        }
      }
    }
  }
}

export type POIWithNodes = POI & { doorNode: number; spotNode: number };
