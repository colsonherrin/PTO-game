// Skinned, animated human characters. Models and motion-capture clips come from the
// Microsoft Rocketbox avatar library (MIT), converted to GLB by scripts/assets/convert.mjs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimState } from './models';
import { hashStr } from '../engine/math';

export const NAMED_AVATARS: Record<string, string> = {
  player: 'Male_Adult_01', rosa: 'Female_Adult_04', marco: 'Business_Male_06', dev: 'Male_Adult_08', jaz: 'Female_Adult_03',
  ray: 'Police_Male_03', lena: 'Female_Adult_17', theo: 'Male_Adult_03', mei: 'Medical_Female_01', gus: 'Wood_Male_01',
  priya: 'Business_Female_01', tyler: 'Male_Adult_17', sofia: 'Female_Adult_12', hank: 'Construction_Male_01',
  nadia: 'Sports_Female_02', omar: 'Male_Adult_14', chloe: 'Female_Party_02',
};
const AMBIENT_POOL = ['Male_Adult_02', 'Male_Adult_06', 'Male_Adult_09', 'Female_Adult_01', 'Female_Adult_05', 'Female_Adult_08', 'Male_Adult_08', 'Female_Adult_17', 'Male_Adult_14', 'Female_Adult_12', 'Male_Adult_17', 'Female_Adult_03'];
export const ALL_AVATARS = [...new Set([...Object.values(NAMED_AVATARS), ...AMBIENT_POOL])];

export function avatarFor(id: string): string {
  return NAMED_AVATARS[id] ?? AMBIENT_POOL[hashStr(id) % AMBIENT_POOL.length];
}

const CLIP_FOR: Record<AnimState, string> = { idle: 'idle', walk: 'walk', run: 'run', sit: 'sit', down: 'breathe', talk: 'talk', wave: 'wave', hidden: 'idle' };

export class AvatarLibrary {
  private models = new Map<string, any>();
  private clips: Record<string, Record<string, any>> = { m: {}, f: {} };
  constructor(private base = 'assets/') {}

  async load(onProgress: (done: number, total: number) => void) {
    const loader = new GLTFLoader();
    const names = [...ALL_AVATARS, 'anims_m', 'anims_f'];
    let done = 0;
    await Promise.all(names.map(async (n) => {
      const gltf = await loader.loadAsync(`${this.base}${n}.glb`);
      if (n.startsWith('anims_')) for (const c of gltf.animations) this.clips[n.slice(-1)][c.name] = c;
      else {
        gltf.scene.traverse((o: any) => {
          if (!o.isMesh) return;
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            m.envMapIntensity = 0.7;
            if (m.map) m.map.anisotropy = 4;
            if (m.name === 'opacity') { m.transparent = false; m.alphaTest = 0.4; m.side = THREE.DoubleSide; m.normalMap = null; }
            if (m.normalMap) m.normalScale.set(0.8, 0.8);
          }
        });
        this.models.set(n, gltf.scene);
      }
      onProgress(++done, names.length);
    }));
  }

  create(avatar: string, heightScale = 1): CharacterView {
    const src = this.models.get(avatar) ?? this.models.values().next().value;
    const g = avatar.includes('Female') ? 'f' : 'm';
    return new CharacterView(cloneSkinned(src), this.clips[g], heightScale);
  }
}

export class CharacterView {
  root: any;
  private mixer: any;
  private actions: Record<string, any> = {};
  private current = '';
  private state: AnimState = 'idle';
  private lie = 0;

  constructor(private model: any, clips: Record<string, any>, heightScale: number) {
    this.root = new THREE.Group();
    model.scale.setScalar(0.01 * heightScale);
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const [name, clip] of Object.entries(clips)) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true; a.setEffectiveWeight(0);
      this.actions[name] = a;
    }
    this.play('idle', 0);
    this.mixer.update(Math.random() * 3);
  }

  private play(name: string, fade = 0.25) {
    if (name === this.current || !this.actions[name]) return;
    const next = this.actions[name], prev = this.actions[this.current];
    next.reset(); next.setEffectiveWeight(1); next.play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false); else if (prev) prev.stop();
    this.current = name;
  }

  /** Sync the view with simulation state. Call once per rendered frame. */
  update(dt: number, x: number, y: number, z: number, yaw: number, state: AnimState, speed: number, visible: boolean, animate: boolean) {
    this.root.visible = visible && state !== 'hidden';
    if (!this.root.visible) return;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    if (state !== this.state) { this.state = state; this.play(CLIP_FOR[state]); }
    const lieTarget = state === 'down' ? 1 : 0;
    this.lie += (lieTarget - this.lie) * Math.min(1, dt * 8);
    this.model.rotation.x = -this.lie * Math.PI / 2;
    this.model.position.y = this.lie * 0.22;
    this.model.position.z = -this.lie * 0.9;
    if (!animate) return;
    const a = this.actions[this.current];
    if (a) a.timeScale = state === 'walk' ? Math.min(1.8, Math.max(0.6, speed / 1.35)) : state === 'run' ? Math.min(1.6, Math.max(0.8, speed / 4.2)) : 1;
    this.mixer.update(dt);
  }
}
