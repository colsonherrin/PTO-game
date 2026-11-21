import { mat4, type Mat4, type Vec3 } from './math';
import { MeshBuilder, STRIDE } from './mesh';

export interface GPUMesh {
  vao: WebGLVertexArrayObject;
  shadowVao: WebGLVertexArrayObject;
  count: number;
  radius: number; // bounding radius for culling (dynamic meshes)
}

interface DrawItem {
  mesh: GPUMesh;
  model: Mat4;
  tint: Vec3 | null;
  shadow: boolean;
}

export interface Lighting {
  sunDir: Vec3; // direction TO the sun
  sunColor: Vec3;
  skyTop: Vec3;
  skyHorizon: Vec3;
  ambientSky: Vec3;
  ambientGround: Vec3;
  fogColor: Vec3;
  night: number; // 0 day .. 1 night
  time: number; // seconds, for animation
  pointLights: { pos: Vec3; color: Vec3 }[];
}

const MAIN_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in float aMat;
uniform mat4 uViewProj, uModel, uLightVP;
uniform vec3 uTint; uniform float uUseTint;
out vec3 vWorld; out vec3 vNormal; out vec3 vColor; out float vMat; out vec4 vLight; out vec3 vLocal;
void main(){
  vec4 w = uModel * vec4(aPos,1.0);
  vWorld = w.xyz; vLocal = aPos;
  vNormal = normalize(mat3(uModel) * aNormal);
  vColor = mix(aColor, aColor * uTint, uUseTint);
  vMat = aMat;
  vLight = uLightVP * w;
  gl_Position = uViewProj * w;
}`;

const MAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld; in vec3 vNormal; in vec3 vColor; in float vMat; in vec4 vLight; in vec3 vLocal;
uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor, uCamPos;
uniform float uFogNear, uFogFar, uNight, uTime, uShadowOn;
uniform sampler2DShadow uShadow;
uniform vec3 uPLPos[8]; uniform vec3 uPLCol[8]; uniform int uPLCount;
out vec4 frag;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float shadowAt(vec3 n){
  if(uShadowOn < 0.5) return 1.0;
  vec3 p = vLight.xyz / vLight.w * 0.5 + 0.5;
  if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0||p.z>1.0) return 1.0;
  float bias = 0.0012 + 0.002*(1.0-abs(dot(n,uSunDir)));
  float s = 0.0; float t = 1.0/2048.0;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) s += texture(uShadow, vec3(p.xy+vec2(x,y)*t, p.z-bias));
  return s/9.0;
}
void main(){
  vec3 n = normalize(vNormal);
  vec3 base = vColor;
  int mat = int(vMat+0.5);
  vec3 emissive = vec3(0.0);
  float spec = 0.0;
  if(mat==1 && abs(n.y)<0.5){
    // procedural facade windows
    vec2 uv = vec2(dot(vWorld.xz, vec2(-n.z, n.x)), vWorld.y);
    float floorH = 3.4; float colW = 2.6;
    vec2 cell = vec2(floor(uv.x/colW), floor((uv.y-0.2)/floorH));
    vec2 f = vec2(fract(uv.x/colW), fract((uv.y-0.2)/floorH));
    bool ground = uv.y < 3.6;
    bool win = ground ? (f.x>0.06 && f.x<0.94 && uv.y>0.5 && uv.y<3.0) : (f.x>0.18 && f.x<0.82 && f.y>0.28 && f.y<0.85);
    if(win){
      float h = hash(cell + floor(vWorld.xz*0.05));
      vec3 glass = mix(vec3(0.20,0.33,0.45), vec3(0.55,0.75,0.88), 0.35 + 0.4*f.y);
      base = glass; spec = 0.6;
      float lit = step(0.45, h) * uNight;
      if(ground) lit = uNight*0.9;
      emissive = lit * mix(vec3(1.0,0.78,0.45), vec3(0.9,0.95,1.0), step(0.8,h)) * 0.9;
    } else if(ground && uv.y>3.0 && uv.y<3.6){
      base = vColor*0.75; // awning band
    }
  } else if(mat==2){
    emissive = vColor;
  } else if(mat==6){
    emissive = vColor * (0.15 + uNight*1.6);
  } else if(mat==3){
    float w = noise(vWorld.xz*0.3 + vec2(uTime*0.3, uTime*0.2)) * 0.5 + noise(vWorld.xz*1.1 - uTime*0.4)*0.5;
    base = mix(vec3(0.05,0.45,0.62), vec3(0.25,0.75,0.82), w);
    spec = 1.0;
  } else if(mat==4){
    float g = noise(vWorld.xz*0.7)*0.5 + noise(vWorld.xz*3.1)*0.5;
    base = vColor * (0.85 + g*0.3);
  } else if(mat==5){
    float g = noise(vWorld.xz*2.0)*0.6 + hash(floor(vWorld.xz*6.0))*0.4;
    base = vColor * (0.9 + g*0.15);
  } else if(mat==7){
    float g = noise(vWorld.xz*1.5);
    base = vColor * (0.92 + g*0.12);
  }
  float d = max(dot(n, uSunDir), 0.0);
  // stylized two-tone terminator
  float band = smoothstep(0.0, 0.12, d) * 0.65 + d * 0.35;
  float sh = shadowAt(n);
  vec3 amb = mix(uAmbGround, uAmbSky, n.y*0.5+0.5);
  vec3 col = base * (amb + uSunColor * band * sh);
  // point lights (street lamps etc.)
  for(int i=0;i<8;i++){
    if(i>=uPLCount) break;
    vec3 L = uPLPos[i] - vWorld; float dl = length(L);
    float att = clamp(1.0 - dl/14.0, 0.0, 1.0); att *= att;
    col += base * uPLCol[i] * att * (0.35 + 0.65*max(dot(n, L/dl), 0.0));
  }
  vec3 V = normalize(uCamPos - vWorld);
  if(spec>0.0){
    vec3 H = normalize(V + uSunDir);
    col += uSunColor * pow(max(dot(n,H),0.0), 60.0) * spec * sh;
    float fr = pow(1.0-max(dot(n,V),0.0), 3.0);
    col = mix(col, mix(uFogColor, vec3(0.8,0.9,1.0), 0.5), fr*0.25*spec);
  }
  // rim light for readability of characters
  float rim = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  col += rim * 0.10 * (uAmbSky + uSunColor*0.3);
  col += emissive;
  float dist = length(uCamPos - vWorld);
  float fog = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFogColor, fog);
  // ACES filmic tonemap
  col *= 0.82;
  col = clamp((col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14), 0.0, 1.0);
  frag = vec4(pow(col, vec3(0.95)), 1.0);
}`;

const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uLightVP, uModel;
void main(){ gl_Position = uLightVP * uModel * vec4(aPos,1.0); }`;
const SHADOW_FS = `#version 300 es
precision mediump float; out vec4 f; void main(){ f = vec4(1.0); }`;

const SKY_VS = `#version 300 es
out vec2 vNdc;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vNdc = p*2.0-1.0; gl_Position = vec4(vNdc, 0.9999, 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc; uniform mat4 uInvVP; uniform vec3 uTop, uHorizon, uSunDir, uSunColor; uniform float uNight, uTime;
out vec4 frag;
float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
void main(){
  vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0); vec4 b = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(b.xyz/b.w - a.xyz/a.w);
  float t = clamp(dir.y*1.4, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(t, 0.7));
  if(dir.y < 0.0) col = uHorizon * 0.9;
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 900.0)*4.0 + pow(sd, 12.0)*0.25) * (1.0-uNight*0.85);
  // moon opposite the sun
  float md = max(dot(dir, -uSunDir), 0.0);
  col += vec3(0.85,0.9,1.0) * pow(md, 1500.0) * 3.0 * uNight;
  if(uNight > 0.0 && dir.y > 0.0){
    vec3 g = floor(dir*180.0);
    float s = step(0.9965, hash(g)) * (0.6+0.4*sin(uTime*2.0+hash(g+1.0)*30.0));
    col += vec3(s) * uNight * t;
  }
  col *= 0.82;
  col = clamp((col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14), 0.0, 1.0);
  frag = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader error: ' + gl.getShaderInfoLog(s) + '\n' + src.split('\n').slice(0, 5).join('\n'));
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
  return p;
}

export class Renderer {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  private main: WebGLProgram;
  private shadowProg: WebGLProgram;
  private sky: WebGLProgram;
  private skyVao: WebGLVertexArrayObject;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private us: Record<string, WebGLUniformLocation | null> = {};
  private uk: Record<string, WebGLUniformLocation | null> = {};
  private shadowFbo: WebGLFramebuffer;
  private shadowTex: WebGLTexture;
  shadowSize = 2048;
  shadowsEnabled = true;
  resolutionScale = 1;
  private items: DrawItem[] = [];
  private statics: GPUMesh[] = [];
  view: Mat4 = mat4.create();
  proj: Mat4 = mat4.create();
  viewProj: Mat4 = mat4.create();
  invViewProj: Mat4 = mat4.create();
  lightVP: Mat4 = mat4.create();
  camPos: Vec3 = [0, 10, 0];
  fogNear = 90;
  fogFar = 260;
  drawCalls = 0;
  private identity = mat4.create();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.main = compile(gl, MAIN_VS, MAIN_FS);
    this.shadowProg = compile(gl, SHADOW_VS, SHADOW_FS);
    this.sky = compile(gl, SKY_VS, SKY_FS);
    this.skyVao = gl.createVertexArray()!;
    for (const n of ['uViewProj', 'uModel', 'uLightVP', 'uTint', 'uUseTint', 'uSunDir', 'uSunColor', 'uAmbSky', 'uAmbGround', 'uFogColor', 'uCamPos', 'uFogNear', 'uFogFar', 'uNight', 'uTime', 'uShadow', 'uShadowOn', 'uPLPos', 'uPLCol', 'uPLCount'])
      this.u[n] = gl.getUniformLocation(this.main, n);
    for (const n of ['uLightVP', 'uModel']) this.us[n] = gl.getUniformLocation(this.shadowProg, n);
    for (const n of ['uInvVP', 'uTop', 'uHorizon', 'uSunDir', 'uSunColor', 'uNight', 'uTime']) this.uk[n] = gl.getUniformLocation(this.sky, n);

    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  upload(b: MeshBuilder): GPUMesh {
    const gl = this.gl;
    const data = new Float32Array(b.v);
    const idx = new Uint32Array(b.i);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const ibo = gl.createBuffer()!;
    const mkVao = (full: boolean) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      const s = STRIDE * 4;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, s, 0);
      if (full) {
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, s, 12);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, s, 24);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, s, 36);
      }
      gl.bindVertexArray(null);
      return vao;
    };
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const vao = mkVao(true);
    const shadowVao = mkVao(false);
    let r = 0;
    for (let k = 0; k < data.length; k += STRIDE) r = Math.max(r, Math.hypot(data[k], data[k + 1], data[k + 2]));
    return { vao, shadowVao, count: idx.length, radius: r };
  }

  addStatic(m: GPUMesh) { this.statics.push(m); }

  draw(mesh: GPUMesh, model: Mat4, tint: Vec3 | null = null, shadow = true) {
    // cheap distance + behind-camera culling
    const x = model[12], y = model[13], z = model[14];
    const dx = x - this.camPos[0], dy = y - this.camPos[1], dz = z - this.camPos[2];
    const d = Math.hypot(dx, dy, dz);
    if (d - mesh.radius * 3 > this.fogFar) return;
    // clip-space check
    const vp = this.viewProj;
    const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (cw < -mesh.radius * 3 && !shadow) return;
    this.items.push({ mesh, model: new Float32Array(model), tint, shadow });
  }

  setCamera(eye: Vec3, target: Vec3, fov: number) {
    const w = this.canvas.width, h = this.canvas.height;
    mat4.perspective(this.proj, fov, w / h, 0.2, 600);
    mat4.lookAt(this.view, eye, target, [0, 1, 0]);
    mat4.multiply(this.viewProj, this.proj, this.view);
    mat4.invert(this.invViewProj, this.viewProj);
    this.camPos = [...eye] as Vec3;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.resolutionScale;
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(L: Lighting, shadowCenter: Vec3) {
    const gl = this.gl;
    this.drawCalls = 0;
    // ---- shadow pass (orthographic sun camera centered near the player)
    const sd = L.sunDir;
    const useShadows = this.shadowsEnabled && sd[1] > 0.05;
    if (useShadows) {
      const span = 70;
      const eye: Vec3 = [shadowCenter[0] + sd[0] * 150, shadowCenter[1] + sd[1] * 150, shadowCenter[2] + sd[2] * 150];
      const lv = mat4.create(), lp = mat4.create();
      mat4.lookAt(lv, eye, shadowCenter, [0, 1, 0]);
      // snap to texel grid to reduce shimmering
      const texel = (span * 2) / this.shadowSize;
      lv[12] = Math.round(lv[12] / texel) * texel;
      lv[13] = Math.round(lv[13] / texel) * texel;
      mat4.ortho(lp, -span, span, -span, span, 1, 400);
      mat4.multiply(this.lightVP, lp, lv);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.shadowProg);
      gl.uniformMatrix4fv(this.us.uLightVP, false, this.lightVP);
      gl.cullFace(gl.FRONT);
      gl.uniformMatrix4fv(this.us.uModel, false, this.identity);
      for (const s of this.statics) { gl.bindVertexArray(s.shadowVao); gl.drawElements(gl.TRIANGLES, s.count, gl.UNSIGNED_INT, 0); this.drawCalls++; }
      for (const it of this.items) {
        if (!it.shadow) continue;
        const dx = it.model[12] - shadowCenter[0], dz = it.model[14] - shadowCenter[2];
        if (Math.abs(dx) > span + 10 || Math.abs(dz) > span + 10) continue;
        gl.uniformMatrix4fv(this.us.uModel, false, it.model);
        gl.bindVertexArray(it.mesh.shadowVao);
        gl.drawElements(gl.TRIANGLES, it.mesh.count, gl.UNSIGNED_INT, 0);
        this.drawCalls++;
      }
      gl.cullFace(gl.BACK);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(L.fogColor[0], L.fogColor[1], L.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ---- sky
    gl.useProgram(this.sky);
    gl.depthMask(false);
    gl.uniformMatrix4fv(this.uk.uInvVP, false, this.invViewProj);
    gl.uniform3fv(this.uk.uTop, L.skyTop);
    gl.uniform3fv(this.uk.uHorizon, L.skyHorizon);
    gl.uniform3fv(this.uk.uSunDir, L.sunDir);
    gl.uniform3fv(this.uk.uSunColor, L.sunColor);
    gl.uniform1f(this.uk.uNight, L.night);
    gl.uniform1f(this.uk.uTime, L.time);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);

    // ---- main pass
    gl.useProgram(this.main);
    const u = this.u;
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP);
    gl.uniform3fv(u.uSunDir, L.sunDir);
    gl.uniform3fv(u.uSunColor, useShadows || sd[1] > 0 ? L.sunColor : [0, 0, 0]);
    gl.uniform3fv(u.uAmbSky, L.ambientSky);
    gl.uniform3fv(u.uAmbGround, L.ambientGround);
    gl.uniform3fv(u.uFogColor, L.fogColor);
    gl.uniform3fv(u.uCamPos, this.camPos);
    gl.uniform1f(u.uFogNear, this.fogNear);
    gl.uniform1f(u.uFogFar, this.fogFar);
    gl.uniform1f(u.uNight, L.night);
    gl.uniform1f(u.uTime, L.time);
    gl.uniform1f(u.uShadowOn, useShadows ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(u.uShadow, 0);
    const pl = L.pointLights.slice(0, 8);
    const pp = new Float32Array(24), pc = new Float32Array(24);
    pl.forEach((p, i) => { pp.set(p.pos, i * 3); pc.set(p.color, i * 3); });
    gl.uniform3fv(u.uPLPos, pp);
    gl.uniform3fv(u.uPLCol, pc);
    gl.uniform1i(u.uPLCount, pl.length);

    gl.uniformMatrix4fv(u.uModel, false, this.identity);
    gl.uniform1f(u.uUseTint, 0);
    gl.uniform3f(u.uTint, 1, 1, 1);
    for (const s of this.statics) { gl.bindVertexArray(s.vao); gl.drawElements(gl.TRIANGLES, s.count, gl.UNSIGNED_INT, 0); this.drawCalls++; }
    for (const it of this.items) {
      gl.uniformMatrix4fv(u.uModel, false, it.model);
      if (it.tint) { gl.uniform1f(u.uUseTint, 1); gl.uniform3fv(u.uTint, it.tint); }
      else gl.uniform1f(u.uUseTint, 0);
      gl.bindVertexArray(it.mesh.vao);
      gl.drawElements(gl.TRIANGLES, it.mesh.count, gl.UNSIGNED_INT, 0);
      this.drawCalls++;
    }
    gl.bindVertexArray(null);
    this.items.length = 0;
  }

  /** Project a world point to CSS pixel coordinates; returns null if behind camera. */
  project(p: Vec3): { x: number; y: number; depth: number } | null {
    const m = this.viewProj;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w <= 0.1) return null;
    return { x: (x / w * 0.5 + 0.5) * this.canvas.clientWidth, y: (1 - (y / w * 0.5 + 0.5)) * this.canvas.clientHeight, depth: w };
  }
}
