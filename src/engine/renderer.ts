// Rendering layer built on three.js (MIT): PBR materials, image-based lighting from a physical
// sky, soft shadows, reflective ocean, bloom and filmic tone mapping.
import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { MAT, type MeshBuilder } from './mesh';
import type { Vec3 } from './math';
import * as TX from './textures';

export interface Lighting {
  sunDir: Vec3; // direction TO the sun (or moon at night)
  sunColor: Vec3;
  skyTop: Vec3;
  skyHorizon: Vec3;
  ambientSky: Vec3;
  ambientGround: Vec3;
  fogColor: Vec3;
  night: number; // 0 day .. 1 night
  time: number;
  sunElev: number; // true sun elevation (-1..1), drives the sky shader
  sunAz: Vec3; // true sun direction (may be below the horizon)
  pointLights: { pos: Vec3; color: Vec3 }[];
}

export type Quality = 'low' | 'medium' | 'high';

export class Renderer {
  canvas: HTMLCanvasElement;
  three: any;
  scene: any;
  camera: any;
  private composer: any;
  private bloom: any;
  private sun: any;
  private hemi: any;
  private sky: any;
  private stars: any;
  private water: any = null;
  private waterNormals: any;
  private pmrem: any;
  private envTarget: any = null;
  private envScene: any;
  private lastEnvKey = '';
  private lamps: any[] = [];
  private nightMats: any[] = [];
  private lampMat: any;
  private poolMat: any;
  shadowsEnabled = true;
  resolutionScale = 1;
  quality: Quality = 'high';
  fogFar = 420;
  camPos: Vec3 = [0, 10, 0];
  private size = [0, 0, 0];
  private assetBase: string;

  constructor(canvas: HTMLCanvasElement, assetBase = 'assets/') {
    this.canvas = canvas;
    this.assetBase = assetBase;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.62;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.three = r;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcfe4f2, 120, this.fogFar);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.25, 4000);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 420;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7a66, 0.5);
    this.scene.add(this.hemi);

    // art-directed sky dome: gradient, sun disc + glow, moon and drifting procedural clouds
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(2800, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uNight: { value: 0 }, uTime: { value: 0 }, uClouds: { value: 1 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: `
        varying vec3 vDir; uniform vec3 uTop, uHor, uSun, uSunCol; uniform float uNight, uTime, uClouds;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+vec2(11.3,7.1); a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float t = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHor, uTop, pow(t, 0.55));
          if(d.y < 0.0) col = mix(uHor, uHor*0.55, clamp(-d.y*4.0, 0.0, 1.0));
          float sd = max(dot(d, normalize(uSun)), 0.0);
          float day = 1.0 - uNight;
          col += uSunCol * (pow(sd, 1800.0)*40.0 + pow(sd, 60.0)*0.6 + pow(sd, 8.0)*0.18) * (0.15 + day);
          if(d.y > 0.02 && uClouds > 0.5){
            vec2 uv = d.xz / (d.y + 0.12) * 1.3 + vec2(uTime*0.004, uTime*0.0015);
            float c = smoothstep(0.52, 0.86, fbm(uv));
            float shade = smoothstep(0.4, 0.95, fbm(uv + normalize(uSun).xz*0.08));
            vec3 cc = mix(vec3(1.0), uHor*0.75 + 0.1, shade*0.6) * (1.9*day + 0.07) + uSunCol*pow(sd, 6.0)*0.5*day;
            col = mix(col, cc, c * smoothstep(0.02, 0.22, d.y) * 0.9);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envScene = new THREE.Scene();

    // stars
    const sp: number[] = [];
    for (let i = 0; i < 1400; i++) { const a = Math.random() * Math.PI * 2, e = Math.acos(Math.random()); sp.push(Math.sin(e) * Math.cos(a) * 2500, Math.cos(e) * 2500 + 20, Math.sin(e) * Math.sin(a) * 2500); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffc98a, 0, 26, 1.6); this.lamps.push(l); this.scene.add(l); }

    this.waterNormals = new THREE.TextureLoader().load(this.assetBase + 'waternormals.webp', (t: any) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
    this.waterNormals.wrapS = this.waterNormals.wrapT = THREE.RepeatWrapping;
    this.buildComposer();
  }

  private buildComposer() {
    const r = this.three;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: this.quality === 'high' ? 4 : 2 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.7, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.size = [0, 0, 0];
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.sun.shadow.mapSize.set(q === 'high' ? 4096 : 2048, q === 'high' ? 4096 : 2048);
    this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    this.buildComposer();
    if (this.water) this.water.visible = q !== 'low';
  }

  /** Turn the material-grouped world geometry into batched PBR meshes. */
  addStatic(builders: MeshBuilder[], oceanFromX: number) {
    const sets: Record<number, TX.PBRSet> = {
      [MAT.PLAIN]: TX.plaster(), [MAT.ASPHALT]: TX.asphalt(), [MAT.PAVE]: TX.pavers(), [MAT.SAND]: TX.sand(), [MAT.WOOD]: TX.wood(),
      [MAT.BARK]: TX.bark(), [MAT.FOLIAGE]: TX.foliage(), [MAT.FACADE]: TX.facade(), [MAT.STORE]: TX.storefront(),
    };
    const grass = new THREE.TextureLoader().load(this.assetBase + 'grass.webp');
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.colorSpace = THREE.SRGBColorSpace; grass.anisotropy = 8; grass.repeat.set(1 / 9, 1 / 9);
    const std = (m: number, o: Record<string, unknown>) => {
      const s = sets[m];
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...o });
      if (s) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap'] as const) if (s[k]) { s[k].repeat.set(s.repeat[0], s.repeat[1]); (mat as any)[k] = s[k]; }
        if (s.roughnessMap) { mat.metalnessMap = s.roughnessMap; mat.metalness = 1; mat.roughness = 1; }
        if (s.emissiveMap) { mat.emissive = new THREE.Color(0xffffff); mat.emissiveIntensity = 0; this.nightMats.push(mat); }
      }
      return mat;
    };
    this.lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.poolMat = new THREE.MeshPhysicalMaterial({ color: 0x2fb7c9, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.86, normalMap: this.waterNormals, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.4 });
    const mats: Record<number, any> = {
      [MAT.PLAIN]: std(MAT.PLAIN, { roughness: 0.82 }),
      [MAT.FACADE]: std(MAT.FACADE, { envMapIntensity: 1.3 }),
      [MAT.STORE]: std(MAT.STORE, { envMapIntensity: 1.3 }),
      [MAT.EMISSIVE]: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      [MAT.LAMP]: this.lampMat,
      [MAT.WATER]: this.poolMat,
      [MAT.GRASS]: new THREE.MeshStandardMaterial({ vertexColors: true, map: grass, roughness: 1 }),
      [MAT.ASPHALT]: std(MAT.ASPHALT, { roughness: 1 }),
      [MAT.SAND]: std(MAT.SAND, { roughness: 1 }),
      [MAT.PAVE]: std(MAT.PAVE, { roughness: 0.88 }),
      [MAT.WOOD]: std(MAT.WOOD, { roughness: 0.75 }),
      [MAT.BARK]: std(MAT.BARK, { roughness: 1 }),
      [MAT.FOLIAGE]: std(MAT.FOLIAGE, { roughness: 0.8, side: THREE.DoubleSide }),
    };
    // align facade rows with the top of the storefront band
    sets[MAT.FACADE].map.offset.y = sets[MAT.FACADE].normalMap.offset.y = sets[MAT.FACADE].roughnessMap.offset.y = sets[MAT.FACADE].emissiveMap.offset.y = -(3.9 % 3.4) / (3.4 * 4);
    for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap'] as const) sets[MAT.STORE][k].offset.y = -0.15 / 3.75;
    this.poolMat.normalMap.repeat?.set(0.25, 0.25);

    for (const b of builders) {
      for (const [m, g] of b.groups) {
        if (m === MAT.OCEAN || !mats[m] || !g.idx.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col.map((c) => Math.pow(c, 2.2)), 3)); // palette is authored in sRGB
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
        geo.setIndex(g.idx);
        const mesh = new THREE.Mesh(geo, mats[m]);
        mesh.receiveShadow = m !== MAT.EMISSIVE && m !== MAT.LAMP;
        mesh.castShadow = m !== MAT.WATER && m !== MAT.EMISSIVE && m !== MAT.LAMP && m !== MAT.GRASS && m !== MAT.ASPHALT && m !== MAT.SAND;
        mesh.matrixAutoUpdate = false;
        this.scene.add(mesh);
      }
    }
    // reflective ocean
    const wg = new THREE.PlaneGeometry(3000, 4000);
    this.water = new Water(wg, { textureWidth: 512, textureHeight: 512, waterNormals: this.waterNormals, sunDirection: new THREE.Vector3(0, 1, 0), sunColor: 0xffffff, waterColor: 0x0b4a5c, distortionScale: 2.4, fog: false });
    // choppier normals + less mirror-like so the sea reads deep blue instead of copying the horizon
    const wm = this.water.material;
    wm.fragmentShader = wm.fragmentShader.replace('vec3( 1.5, 1.0, 1.5 )', 'vec3( 2.8, 1.0, 2.8 )').replace('vec3( 0.1 ) + reflectionSample * 0.9', 'reflectionSample * 0.5').replace('float rf0 = 0.3;', 'float rf0 = 0.04;')
      .replace('pow( ( 1.0 - theta ), 5.0 );', 'pow( ( 1.0 - theta ), 5.0 ); reflectance = min( reflectance, 0.55 );')
      .replace('max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor', '( 0.5 + 0.5 * max( 0.0, dot( surfaceNormal, eyeDirection ) ) ) * waterColor * 1.7');
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(oceanFromX + 1500, 0.02, 150);
    this.water.material.uniforms.size.value = 0.35;
    this.scene.add(this.water);
  }

  setCamera(eye: Vec3, target: Vec3, fov: number) {
    this.camera.fov = (fov * 180) / Math.PI;
    this.camera.position.set(eye[0], eye[1], eye[2]);
    this.camera.lookAt(target[0], target[1], target[2]);
    this.camPos = [...eye] as Vec3;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25) * this.resolutionScale;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.size[0] !== w || this.size[1] !== h || this.size[2] !== dpr) {
      this.size = [w, h, dpr];
      this.three.setPixelRatio(dpr);
      this.three.setSize(w, h, false);
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(w, h);
      this.camera.aspect = w / Math.max(1, h);
    }
    this.camera.updateProjectionMatrix();
  }

  private updateEnvironment(L: Lighting) {
    // re-bake image-based lighting only when the sun has moved noticeably
    const key = `${Math.round(L.sunElev * 40)}|${Math.round(L.night * 10)}`;
    if (key === this.lastEnvKey) return;
    this.lastEnvKey = key;
    const sky2 = this.sky.clone(); sky2.position.set(0, 0, 0);
    this.envScene.clear();
    this.envScene.add(sky2);
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, 4000);
    this.scene.environment = this.envTarget.texture;
    old?.dispose();
  }

  render(L: Lighting, center: Vec3) {
    const day = 1 - L.night;
    // sun / moon
    this.sun.position.set(center[0] + L.sunDir[0] * 200, L.sunDir[1] * 200, center[2] + L.sunDir[2] * 200);
    this.sun.target.position.set(center[0], 0, center[2]);
    const SR = THREE.SRGBColorSpace;
    this.sun.color.setRGB(L.sunColor[0], L.sunColor[1], L.sunColor[2], SR);
    this.sun.intensity = 4.2 * day + 0.45 * L.night;
    this.sun.castShadow = this.shadowsEnabled;
    this.hemi.color.setRGB(L.ambientSky[0], L.ambientSky[1], L.ambientSky[2], SR);
    this.hemi.groundColor.setRGB(L.ambientGround[0], L.ambientGround[1], L.ambientGround[2], SR);
    this.hemi.intensity = 0.32 * day + 0.6 * L.night;
    this.scene.environmentIntensity = 0.3 * day + 0.25;
    // sky
    const su = this.sky.material.uniforms;
    const boost = 2.3 * day + 0.5;
    su.uTop.value.setRGB(L.skyTop[0], L.skyTop[1], L.skyTop[2], SR).multiplyScalar(boost);
    su.uHor.value.setRGB(L.skyHorizon[0], L.skyHorizon[1], L.skyHorizon[2], SR).multiplyScalar(boost);
    su.uSun.value.set(L.sunDir[0], L.sunDir[1], L.sunDir[2]);
    su.uSunCol.value.setRGB(L.sunColor[0], L.sunColor[1], L.sunColor[2], SR);
    su.uNight.value = L.night; su.uTime.value = L.time;
    this.sky.position.set(this.camPos[0], 0, this.camPos[2]);
    this.stars.position.set(this.camPos[0], 0, this.camPos[2]);
    this.stars.material.opacity = Math.max(0, L.night - 0.3) * 1.3;
    this.updateEnvironment(L);
    this.scene.fog.color.setRGB(L.skyHorizon[0], L.skyHorizon[1], L.skyHorizon[2], SR).multiplyScalar(0.9 * day + 0.35);
    this.scene.fog.near = 260; this.scene.fog.far = this.fogFar * 3.2;
    this.three.toneMappingExposure = 0.5 * day + 0.9 * L.night;
    // night-time emissive windows and lamps
    for (const m of this.nightMats) m.emissiveIntensity = L.night * 1.5;
    if (this.lampMat) this.lampMat.color.setScalar(0.3 + L.night * 3.2);
    this.lamps.forEach((l, i) => {
      const p = L.pointLights[i];
      if (p) { l.position.set(p.pos[0], p.pos[1], p.pos[2]); l.intensity = L.night * 60; } else l.intensity = 0;
    });
    this.bloom.strength = 0.16 + L.night * 0.5;
    this.bloom.threshold = 1.0 - L.night * 0.25;
    // water
    this.waterNormals.offset.set(L.time * 0.012, L.time * 0.008);
    if (this.water) {
      const wu = this.water.material.uniforms;
      wu.time.value = L.time * 0.6;
      wu.sunDirection.value.set(L.sunDir[0], L.sunDir[1], L.sunDir[2]).normalize();
      wu.sunColor.value.setRGB(L.sunColor[0] * (0.25 + day * 0.75), L.sunColor[1] * (0.25 + day * 0.75), L.sunColor[2] * (0.25 + day * 0.75));
      wu.waterColor.value.setRGB(0.01 + 0.02 * day, 0.06 + 0.34 * day, 0.1 + 0.5 * day);
    }
    if (this.quality === 'low') this.three.render(this.scene, this.camera);
    else this.composer.render();
  }

  get drawCalls(): number { return this.three.info.render.calls; }

  /** Project a world point to CSS pixel coordinates; returns null if behind the camera. */
  private v = new THREE.Vector3();
  project(p: Vec3): { x: number; y: number; depth: number } | null {
    this.v.set(p[0], p[1], p[2]).applyMatrix4(this.camera.matrixWorldInverse);
    if (this.v.z > -0.2) return null;
    const depth = -this.v.z;
    this.v.applyMatrix4(this.camera.projectionMatrix);
    return { x: (this.v.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (1 - (this.v.y * 0.5 + 0.5)) * this.canvas.clientHeight, depth };
  }
}
