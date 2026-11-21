import { Renderer } from '../engine/renderer';
import { City, CITY, BEACH_X0, roadCenter, NB, type POIWithNodes } from '../world/city';
import { lightingAt } from '../world/sky';
import { rng, clamp, type Vec3, angleWrap } from '../engine/math';
import { AvatarLibrary, avatarFor, type CharacterView } from './characters';
import { OCEAN_X } from '../world/city';
import { Input, Player, OrbitCamera } from './player';
import { Vehicle, interNeighbors, type Inter } from './vehicle';
import { NPC, type NPCSave } from '../npc/npc';
import { PERSONAS, ambientPersona } from '../npc/personas';
import { InferenceRouter, OpenRouterProvider, ServerProvider } from '../ai/inference';
import { AudioSys } from '../systems/audio';
import { saveSlot, loadSlot, settingsStore } from '../systems/save';
import { UI, $, esc } from '../ui/ui';
import { formatClock, hourOf, ITEMS, VEHICLES_FOR_SALE, type WorldEvent, type ActiveJob } from './state';
import { DialogueSystem } from './dialogue';
import { drawMinimap } from '../ui/minimap';

export const SAVE_VERSION = 2;

interface Ride { npcId: string; vehId: string; dest: string; phase: 'walk' | 'wait' | 'drive' | 'arrived'; timer: number }

export class Game {
  canvas: HTMLCanvasElement;
  r: Renderer;
  city = new City();
  input: Input;
  cam = new OrbitCamera();
  player = new Player();
  audio = new AudioSys();
  ai = new InferenceRouter();
  ui = new UI();
  dialogue: DialogueSystem;
  npcs: NPC[] = [];
  npcById = new Map<string, NPC>();
  vehicles: Vehicle[] = [];
  vehById = new Map<string, Vehicle>();
  events: WorldEvent[] = [];
  jobs: ActiveJob[] = [];
  flags: Record<string, boolean | number | string> = {};
  minutes = 9 * 60;
  timeScale = 1; // game minutes per real second
  t = 0;
  running = false;
  paused = true;
  ride: Ride | null = null;
  business = { owned: false, lastDay: 0, earned: 0 };
  aiMode: 'live' | 'sim' = 'sim';
  aiProviderLabel = 'Simulated';
  private lastFrame = 0;
  private autosaveAt = 0;
  private gossipAt = 0;
  private barkAt = 0;
  private evCounter = 0;
  private fps = 60;
  private frame = 0;
  private lastLoc = '';
  private stepAt = 0;
  private lastBarkFor = new Map<string, number>();
  avatars = new AvatarLibrary();
  private views = new Map<string, CharacterView>();
  private lastRender = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.r = new Renderer(canvas);
    this.input = new Input(canvas);
    this.dialogue = new DialogueSystem(this);
  }

  // ---------------------------------------------------------------------------
  async init() {
    this.ui.setLoading('Building Palmetto Heights…');
    await new Promise((r) => setTimeout(r, 20));
    this.r.addStatic(this.city.build(), OCEAN_X);
    await this.avatars.load((d, t) => this.ui.setLoading(`Waking up the residents… ${Math.round((d / t) * 100)}%`));
    this.spawnNPCs();
    this.spawnVehicles();
    this.applySettings();
    await this.configureAI();
    this.bindUI();
    this.ui.setLoading(null);
    this.resetPlayer();
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    const has = !!(await loadSlot('slot1'));
    this.showTitle(has);
    (window as unknown as { pto: Game }).pto = this; // debugging & automated tests
  }

  showTitle(hasSave: boolean) {
    this.paused = true;
    this.cam.yaw = Math.PI * 0.75; this.cam.pitch = 0.18; this.cam.targetDist = 14;
    this.ui.showTitle(hasSave, () => this.newGame(), () => void this.loadGame(), () => { this.fillSettings(); this.ui.setCosts(this.costHTML()); this.ui.showPanel('pause'); this.fromTitle = true; });
  }

  resetPlayer() {
    const p = this.player;
    p.x = 155.6; p.z = 104; p.y = 0.15; p.yaw = -Math.PI / 2;
    this.cam.yaw = -Math.PI / 2 + 0.4; this.cam.pitch = 0.3;
  }

  newGame() {
    this.audio.start();
    this.resetPlayer();
    this.cam.targetDist = 6.5; this.cam.dist = 6.5;
    this.paused = false;
    this.ui.bigMessage('Day 1', 'Your PTO starts now. Palmetto Heights is yours.', 3500);
    this.ui.toast('Tip: walk up to anyone and press <kbd>E</kbd> to talk. Rosa at Sol Café (right here) always needs help.', 'info', 9000);
    this.r.canvas.focus();
  }

  // ---------------------------------------------------------------------------
  spawnNPCs() {
    for (const p of PERSONAS) {
      const n = new NPC(p, true, 0, 0);
      n.syncToSchedule(this.minutes, this.city);
      this.addNPC(n);
    }
    const R = rng(4242);
    for (let i = 0; i < 22; i++) {
      const n = new NPC(ambientPersona(i, R), false, 0, 0);
      n.syncToSchedule(this.minutes, this.city);
      // spread ambient folks around their POI
      n.x += (R() - 0.5) * 8; n.z += (R() - 0.5) * 8;
      this.addNPC(n);
    }
  }
  addNPC(n: NPC) { this.npcs.push(n); this.npcById.set(n.p.id, n); }

  spawnVehicles() {
    const r = this.r;
    const add = (v: Vehicle) => { this.vehicles.push(v); this.vehById.set(v.id, v); return v; };
    add(new Vehicle(r, 'car_rental', 'hatch', '#ff6b6b', roadCenter(2) + 5.2, 116, Math.PI, 'rental', 'PTO Rentals hatchback'));
    add(new Vehicle(r, 'car_dev', 'sedan', '#2f5fa7', 112, roadCenter(1) - 5.2, -Math.PI / 2, 'dev', "Dev's sedan"));
    add(new Vehicle(r, 'car_hank', 'pickup', '#c0392b', 266, roadCenter(2) + 5.2, Math.PI / 2, 'hank', "Hank's pickup"));
    add(new Vehicle(r, 'car_repair_van', 'van', '#f5f2ea', 250, roadCenter(2) + 5.2, Math.PI / 2, 'hank', 'Repaired van'));
    const sale = Object.values(VEHICLES_FOR_SALE);
    sale.forEach((s, k) => {
      const spot = this.city.forSaleSpots[k];
      const v = add(new Vehicle(r, s.id, s.type, s.color, spot.x, spot.z, spot.yaw, 'dealer', s.name));
      v.forSale = s.id;
    });
    const R = rng(99);
    const colors = ['#e9573f', '#f6bb42', '#8cc152', '#37bc9b', '#3bafda', '#4a89dc', '#967adc', '#d770ad', '#e6e9ed', '#434a54', '#f5f7fa'];
    const types = ['sedan', 'hatch', 'sedan', 'van', 'taxi', 'hatch'] as const;
    const used = new Set<number>();
    for (let k = 0; k < 9; k++) {
      let idx = Math.floor(R() * this.city.parking.length);
      while (used.has(idx)) idx = (idx + 1) % this.city.parking.length;
      used.add(idx);
      const s = this.city.parking[idx];
      if (this.vehicles.some((v) => Math.hypot(v.x - s.x, v.z - s.z) < 7)) continue;
      add(new Vehicle(r, `parked_${k}`, types[Math.floor(R() * types.length)] === 'taxi' ? 'sedan' : types[Math.floor(R() * types.length)], colors[Math.floor(R() * colors.length)], s.x, s.z, s.yaw, 'parked'));
    }
    for (let k = 0; k < 13; k++) {
      const from: Inter = [Math.floor(R() * (NB + 1)), Math.floor(R() * (NB + 1))];
      const nbs = interNeighbors(from);
      const to = nbs[Math.floor(R() * nbs.length)];
      const type = types[Math.floor(R() * types.length)];
      const v = add(new Vehicle(r, `traffic_${k}`, type, type === 'taxi' ? '#f7c948' : colors[Math.floor(R() * colors.length)], 0, 0, 0, 'traffic'));
      v.driver = 'traffic';
      v.initTraffic(from, to, 8.5 + R() * 3);
      if (this.vehicles.some((o) => o !== v && Math.hypot(o.x - v.x, o.z - v.z) < 9)) v.initTraffic(from, to, 9);
    }
  }

  // ---------------------------------------------------------------------------
  async configureAI() {
    const pref = settingsStore.get<string>('provider', 'auto');
    const key = settingsStore.get<string>('orKey', '');
    const cfg = settingsStore.get<Record<string, unknown>>('aiConfig', {});
    Object.assign(this.ai.config, cfg);
    this.ai.provider = null;
    if (pref === 'sim') { /* simulated */ }
    else if ((pref === 'auto' || pref === 'server') && (await ServerProvider.detect())) this.ai.provider = new ServerProvider();
    else if ((pref === 'auto' || pref === 'openrouter') && key) this.ai.provider = new OpenRouterProvider(key);
    this.aiMode = this.ai.provider ? 'live' : 'sim';
    this.aiProviderLabel = this.ai.provider ? this.ai.provider.label : 'Simulated (no API key)';
  }

  aiBadge(): string {
    return this.aiMode === 'live'
      ? `<span class="badge-live" style="padding:5px 10px;border-radius:999px">● Live AI · ${esc(this.ai.config.tier1Model.split('/').pop()!)}</span>`
      : `<span class="badge-sim" style="padding:5px 10px;border-radius:999px">◐ Simulated dialogue · add key in Esc menu</span>`;
  }

  applySettings() {
    this.r.shadowsEnabled = settingsStore.get('shadows', true);
    this.r.resolutionScale = settingsStore.get('res', 1);
    this.r.setQuality(settingsStore.get('quality', 'high'));
    this.audio.setVolume(settingsStore.get('vol', 0.6));
    this.cam.sensitivity = settingsStore.get('sens', 1);
    this.timeScale = settingsStore.get('timescale', 1);
    this.ui.tts = settingsStore.get('tts', false);
  }

  bindUI() {
    const sel = (id: string) => $<HTMLInputElement>('#' + id);
    const fill = () => {
      sel('set-provider').value = settingsStore.get('provider', 'auto');
      sel('set-key').value = settingsStore.get('orKey', '');
      sel('set-t1').value = this.ai.config.tier1Model;
      sel('set-t2').value = this.ai.config.tier2Model;
      sel('set-budget').value = String(this.ai.config.sessionBudgetUSD);
      sel('set-rpm').value = String(this.ai.config.maxRequestsPerMinute);
      sel('set-tts').checked = this.ui.tts;
      sel('set-shadows').checked = this.r.shadowsEnabled;
      sel('set-res').value = String(this.r.resolutionScale);
      sel('set-quality').value = this.r.quality;
      sel('set-vol').value = String(this.audio.volume);
      sel('set-sens').value = String(this.cam.sensitivity);
      sel('set-timescale').value = String(this.timeScale);
      $('#ai-status').textContent = `Active: ${this.aiProviderLabel}`;
    };
    fill();
    this.fillSettings = fill;
    $('#btn-resume').onclick = () => this.setPaused(false);
    $('#btn-save').onclick = () => void this.saveGame(true);
    $('#btn-load').onclick = () => void this.loadGame();
    $('#btn-quit').onclick = () => { void this.saveGame(false); this.ui.showPanel(null); this.showTitle(true); };
    $('#journal-close').onclick = () => this.toggleJournal();
    $('#journal-body').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).dataset?.use;
      if (!id || !ITEMS[id]?.heal) return;
      if (this.player.removeItem(id)) { this.player.health = Math.min(100, this.player.health + ITEMS[id].heal!); this.ui.toast(`Used ${ITEMS[id].name}. +${ITEMS[id].heal} health`, 'good'); this.ui.setJournal(this.journalHTML()); }
    });
    $('#btn-apply-ai').onclick = async () => {
      settingsStore.set('provider', sel('set-provider').value);
      settingsStore.set('orKey', sel('set-key').value.trim());
      const cfg = { tier1Model: sel('set-t1').value.trim() || this.ai.config.tier1Model, tier2Model: sel('set-t2').value.trim() || this.ai.config.tier2Model, sessionBudgetUSD: parseFloat(sel('set-budget').value) || 0.5, maxRequestsPerMinute: parseInt(sel('set-rpm').value) || 30 };
      settingsStore.set('aiConfig', cfg);
      await this.configureAI();
      fill();
      this.ui.toast(`AI provider: ${this.aiProviderLabel}`, 'ai');
    };
    const live = (id: string, key: string, conv: (e: HTMLInputElement) => unknown) => sel(id).addEventListener('change', () => { settingsStore.set(key, conv(sel(id))); this.applySettings(); });
    live('set-tts', 'tts', (e) => e.checked);
    live('set-shadows', 'shadows', (e) => e.checked);
    live('set-res', 'res', (e) => parseFloat(e.value));
    live('set-quality', 'quality', (e) => e.value);
    live('set-vol', 'vol', (e) => parseFloat(e.value));
    live('set-sens', 'sens', (e) => parseFloat(e.value));
    live('set-timescale', 'timescale', (e) => parseFloat(e.value));
    this.canvas.addEventListener('click', () => { if (!this.paused && !this.ui.isDialogueOpen) this.input.lock(); this.audio.start(); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.ui.isDialogueOpen) { this.dialogue.close(); return; }
        if (this.fromTitle) { this.setPaused(false); return; }
        if ($('#title').style.display === 'flex') return;
        this.setPaused(!this.paused);
      }
    });
    window.addEventListener('beforeunload', () => { if (!this.paused || this.running) void this.saveGame(false); });
  }
  fillSettings: () => void = () => {};

  fromTitle = false;
  setPaused(p: boolean) {
    if (this.fromTitle && !p) { this.fromTitle = false; this.ui.showPanel(null); void loadSlot('slot1').then((s) => this.showTitle(!!s)); return; }
    if ($('#title').style.display === 'flex') return;
    this.paused = p;
    if (p) { this.fillSettings(); this.ui.setCosts(this.costHTML()); this.ui.showPanel('pause'); this.input.unlock(); }
    else { this.ui.showPanel(null); }
  }

  toggleJournal() {
    const open = $('#journal').classList.contains('open');
    if (open) { this.ui.showPanel(null); this.paused = false; return; }
    this.ui.setJournal(this.journalHTML());
    this.ui.showPanel('journal');
    this.paused = true;
    this.input.unlock();
  }

  // ---------------------------------------------------------------------------
  loop(now: number) {
    if (!this.running) return;
    const raw = Math.max(1e-3, (now - this.lastFrame) / 1000);
    const dt = Math.min(0.05, raw);
    this.lastFrame = now;
    this.fps = this.fps * 0.9 + (1 / raw) * 0.1;
    this.t += dt;
    try {
      if (!this.paused) this.update(dt);
      else this.idleCamera(dt);
      this.render();
    } catch (e) {
      console.error(e);
    }
    this.input.endFrame();
    requestAnimationFrame((t) => this.loop(t));
  }

  /** Advance the simulation without rendering (used by automated tests). */
  simulate(seconds: number, step = 1 / 30) {
    const n = Math.ceil(seconds / step);
    for (let i = 0; i < n; i++) { if (!this.paused) this.update(step); this.input.pressed.clear(); this.input.mouseDX = this.input.mouseDY = 0; }
  }

  titleShowing() { return $('#title').style.display === 'flex'; }

  idleCamera(dt: number) {
    if ($('#title').style.display === 'flex') {
      this.cam.yaw += dt * 0.05;
      this.cam.update(dt, this.input, this.player.pos(), this.city, false, 0, 0);
      this.minutes += dt * 0.6; // gentle sky motion on the title screen
    }
  }

  update(dt: number) {
    const inp = this.input;
    const talking = this.ui.isDialogueOpen;
    inp.enabled = !talking;
    const prevMin = this.minutes;
    this.minutes += dt * this.timeScale * (talking ? 0.25 : 1);
    if (Math.floor(prevMin / 1440) !== Math.floor(this.minutes / 1440)) this.onNewDay();

    if (inp.hit('KeyJ')) this.toggleJournal();
    if (inp.hit('KeyP')) this.setPaused(true);
    if (inp.hit('KeyH')) { this.audio.horn(); this.honk(); }

    const p = this.player;
    const veh = p.vehicleId ? this.vehById.get(p.vehicleId)! : null;
    const passengerVeh = p.passengerIn ? this.vehById.get(p.passengerIn)! : null;

    // --- player
    if (veh) {
      const throttle = inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0;
      const brake = inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0;
      const steer = (inp.down('KeyA') || inp.down('ArrowLeft') ? 1 : 0) - (inp.down('KeyD') || inp.down('ArrowRight') ? 1 : 0);
      const impact = veh.drive(dt, throttle, brake, steer, inp.down('Space'), this.city);
      if (impact > 7 && this.t - veh.lastCrash > 1) this.onCrash(veh, impact);
      p.x = veh.x; p.z = veh.z; p.y = 0.5;
      if (inp.hit('KeyF') || inp.hit('KeyE')) this.exitVehicle();
      if (Math.abs(veh.speed) > 17 && this.nearPlaza(p.x, p.z) && Math.random() < dt * 0.5) this.addEvent('reckless_driving', p.x, p.z, 'Someone was speeding recklessly through Central Plaza.', 'player', undefined, 0.3);
    } else if (passengerVeh) {
      p.x = passengerVeh.x; p.z = passengerVeh.z; p.y = 0.5;
      if (inp.hit('KeyE') || inp.hit('KeyF')) this.leaveRide(true);
    } else {
      const blockers: [number, number, number][] = [];
      for (const v of this.vehicles) if (Math.hypot(v.x - p.x, v.z - p.z) < 6) for (const c of v.circles()) blockers.push([c[0], c[1], 0.9]);
      for (const n of this.npcs) if (!n.hidden && n.mode !== 'in_vehicle' && Math.hypot(n.x - p.x, n.z - p.z) < 2) blockers.push([n.x, n.z, 0.3]);
      p.update(dt, inp, this.cam.yaw, this.city, blockers);
      if (p.speed > 1 && p.onGround && this.t > this.stepAt) { this.audio.step(); this.stepAt = this.t + (p.speed > 5 ? 0.28 : 0.42); }
      this.handleInteract();
    }

    // --- vehicles
    this.updateVehicles(dt);
    // --- NPCs
    this.updateNPCs(dt);
    this.updateRide(dt);
    this.updateCop(dt);
    this.dialogue.update(dt);
    if (this.t > this.gossipAt) { this.gossip(); this.gossipAt = this.t + 4; }
    if (this.t > this.barkAt) { this.ambientBarks(); this.barkAt = this.t + 1.5; }
    // heat decay
    p.heat = Math.max(0, p.heat - dt * 0.02);
    // camera
    const target = veh ?? passengerVeh;
    this.cam.update(dt, inp, target ? [target.x, 0.2, target.z] : p.pos(), this.city, !!target, target?.yaw ?? 0, target?.speed ?? 0);
    // jobs
    this.dialogue.checkVehicleJobs();
    // audio
    const nearBeach = clamp((p.x - (BEACH_X0 - 40)) / 50, 0, 1);
    this.audio.update({ night: lightingAt(this.minutes, this.t).night, nearBeach, driving: !!veh, speed: veh?.speed ?? 0, t: this.t });
    // health
    if (p.health <= 0) this.onWasted();
    if (this.t > this.autosaveAt) { this.autosaveAt = this.t + 90; if (this.t > 5) void this.saveGame(false); }
  }

  nearPlaza(x: number, z: number) { return Math.hypot(x - 112, z - 112) < 40; }

  // ---------------------------------------------------------------------------
  handleInteract() {
    const p = this.player;
    const n = this.nearestTalkable();
    const v = this.nearestVehicle(3.4);
    if (this.input.hit('KeyE')) {
      if (this.ride && v && v.id === this.ride.vehId && this.ride.phase === 'wait') { this.boardRide(); return; }
      if (n) { this.dialogue.open(n); return; }
      if (v) { this.tryEnterVehicle(v); return; }
    }
    if (this.input.hit('KeyF') && v) this.tryEnterVehicle(v);
    void p;
  }

  nearestTalkable(): NPC | null {
    const p = this.player;
    let best: NPC | null = null, bs = Infinity;
    for (const n of this.npcs) {
      if (n.hidden || n.mode === 'in_vehicle' || n.mode === 'knocked') continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d > 2.9) continue;
      // prefer whoever the player is facing, and named characters
      const facing = Math.cos(Math.atan2(n.x - p.x, n.z - p.z) - p.yaw);
      const score = d - facing * 0.8 - (n.important ? 0.5 : 0);
      if (score < bs) { bs = score; best = n; }
    }
    return best;
  }

  nearestVehicle(maxD: number): Vehicle | null {
    const p = this.player;
    let best: Vehicle | null = null, bd = maxD;
    for (const v of this.vehicles) {
      if (v.driver === 'player') continue;
      let d = Infinity;
      for (const c of v.circles()) d = Math.min(d, Math.hypot(c[0] - p.x, c[1] - p.z));
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  vehicleAccess(v: Vehicle): { ok: boolean; why: string; steal: boolean } {
    if (v.forSale) return { ok: false, why: `For sale at Bellini Motors — talk to Marco`, steal: false };
    if (v.owner === 'player' || v.owner === 'rental') return { ok: true, why: '', steal: false };
    if (v.id === 'car_repair_van') {
      const job = this.jobs.find((j) => j.vehicleId === v.id && j.status === 'active');
      return job ? { ok: true, why: '', steal: false } : { ok: false, why: "Locked — Hank's customer van", steal: false };
    }
    if (this.ride && v.id === this.ride.vehId) return { ok: false, why: '', steal: false };
    if (v.driver && v.driver !== 'traffic') return { ok: false, why: 'Occupied', steal: false };
    return { ok: true, why: '', steal: true };
  }

  tryEnterVehicle(v: Vehicle) {
    const acc = this.vehicleAccess(v);
    if (!acc.ok) { if (acc.why) this.ui.toast(acc.why, 'info'); return; }
    if (acc.steal) {
      const victimName = v.driver === 'traffic' ? 'a driver' : (this.npcById.get(v.owner)?.firstName ?? 'someone') + "'s";
      const text = v.driver === 'traffic' ? 'Someone yanked a driver out of their car and stole it!' : `Someone stole ${victimName} ${v.name}!`;
      this.addEvent('carjack', v.x, v.z, text, 'player', this.npcById.has(v.owner) ? v.owner : undefined, 0.85);
      this.player.heat = Math.min(5, this.player.heat + (v.driver === 'traffic' ? 2 : 1.2));
      if (v.driver === 'traffic') { v.ai = null; this.ui.toast('Carjacked! Expect people to remember this.', 'bad'); }
      v.owner = 'stolen';
    }
    this.player.vehicleId = v.id;
    v.driver = 'player';
    v.ai = null;
    this.audio.door();
    this.input.lock();
  }

  exitVehicle() {
    const p = this.player;
    const v = this.vehById.get(p.vehicleId!)!;
    if (Math.abs(v.speed) > 4) { this.ui.toast('Slow down to get out.', 'info', 1500); return; }
    v.driver = null; v.speed = 0;
    p.vehicleId = null;
    let [sx, sz] = v.sidePoint(1);
    if (this.city.query(sx, sz, 0.5).some((c) => sx > c.x0 && sx < c.x1 && sz > c.z0 && sz < c.z1)) [sx, sz] = v.sidePoint(-1);
    p.x = sx; p.z = sz; p.y = this.city.groundHeight(sx, sz);
    this.audio.door();
  }

  honk() {
    const p = this.player;
    for (const n of this.npcs) {
      if (n.hidden) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < 12 && Math.random() < 0.6) { n.say(['Hey!', 'Rude!', 'I see you!', 'Easy on the horn!'][Math.floor(Math.random() * 4)], this.minutes, 3); n.yaw = Math.atan2(p.x - n.x, p.z - n.z); }
    }
  }

  // ---------------------------------------------------------------------------
  updateVehicles(dt: number) {
    const p = this.player;
    for (const v of this.vehicles) {
      if (v.driver === 'traffic' && v.ai) {
        const ob = this.obstacleAhead(v);
        // gridlock breaker: after waiting a while, creep forward anyway (unless it's the player)
        v.updateAI(dt, this.city, v.ai.blocked > 7 && !this.playerBlocking(v) ? 9 : ob);
        if (v.ai.blocked > 7 && ob > 3) v.ai.blocked = 0;
        if (v.ai.blocked > 4 && v.ai.blocked < 4 + dt * 1.5 && this.playerBlocking(v)) { if (Math.hypot(v.x - p.x, v.z - p.z) < 30) this.audio.horn(); }
      } else if (v.driver && v.driver !== 'player' && v.ai) {
        const ob = this.obstacleAhead(v);
        const arrived = v.updateAI(dt, this.city, v.ai.blocked > 5 ? 9 : ob);
        if (v.ai && v.ai.blocked > 5 && ob > 3) v.ai.blocked = 0;
        if (arrived) this.onRideArrived();
      } else if (v.driver !== 'player') {
        // parked: settle velocity
        if (Math.abs(v.speed) > 0.01) { v.speed *= Math.pow(0.2, dt); v.x += v.fx * v.speed * dt; v.z += v.fz * v.speed * dt; v.collideWorld(this.city); }
      }
    }
    // car-car collisions
    for (let i = 0; i < this.vehicles.length; i++) for (let j = i + 1; j < this.vehicles.length; j++) {
      const a = this.vehicles[i], b = this.vehicles[j];
      if (Math.abs(a.x - b.x) > 7 || Math.abs(a.z - b.z) > 7) continue;
      for (const ca of a.circles()) for (const cb of b.circles()) {
        const dx = ca[0] - cb[0], dz = ca[1] - cb[1], d = Math.hypot(dx, dz);
        if (d < 1.8 && d > 1e-4) {
          const push = (1.8 - d) / 2, ux = dx / d, uz = dz / d;
          const aMov = a.driver === null ? 0.3 : 1, bMov = b.driver === null ? 0.3 : 1;
          a.x += ux * push * aMov; a.z += uz * push * aMov; b.x -= ux * push * bMov; b.z -= uz * push * bMov;
          const rel = Math.abs(a.speed - b.speed);
          if (rel > 6 && (a.driver === 'player' || b.driver === 'player') && this.t - a.lastCrash > 1) this.onCrash(a.driver === 'player' ? a : b, rel, a.driver === 'player' ? b : a);
          if (b.driver === null) b.speed = a.speed * 0.4;
          if (a.driver === null) a.speed = b.speed * 0.4;
          a.speed *= 0.6; b.speed *= 0.6;
        }
      }
    }
    // car vs pedestrians (player-driven or any fast car)
    for (const v of this.vehicles) {
      if (Math.abs(v.speed) < 3.5) continue;
      for (const n of this.npcs) {
        if (n.hidden || n.mode === 'in_vehicle' || n.mode === 'knocked') continue;
        if (Math.abs(n.x - v.x) > 4 || Math.abs(n.z - v.z) > 4) continue;
        if (v.circles().some((c) => Math.hypot(c[0] - n.x, c[1] - n.z) < 1.25)) this.hitNPC(n, v);
      }
      if (!p.vehicleId && !p.passengerIn && v.driver !== 'player' && v.circles().some((c) => Math.hypot(c[0] - p.x, c[1] - p.z) < 1.2) && performance.now() > p.knockedUntil) {
        p.health -= Math.abs(v.speed) * 3;
        p.knockedUntil = performance.now() + 1500;
        this.audio.crash();
        this.ui.toast('Ouch! You got clipped by a car.', 'bad');
        v.speed *= 0.2;
      }
    }
  }

  /** Distance from the nearest road centerline (curb-parked cars sit ~5m out). */
  laneOffset(x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i <= NB; i++) { best = Math.min(best, Math.abs(x - roadCenter(i)), Math.abs(z - roadCenter(i))); }
    return best;
  }

  playerBlocking(v: Vehicle) { const p = this.player; return Math.hypot(p.x - v.x, p.z - v.z) < 12; }

  obstacleAhead(v: Vehicle): number {
    let best = Infinity;
    const fx = v.fx, fz = v.fz;
    const test = (x: number, z: number, w: number) => {
      const dx = x - v.x, dz = z - v.z;
      const along = dx * fx + dz * fz;
      if (along < 1 || along > 16) return;
      const lat = Math.abs(dx * fz - dz * fx);
      if (lat < w) best = Math.min(best, along - v.length / 2);
    };
    for (const o of this.vehicles) if (o !== v && Math.abs(o.x - v.x) < 18 && Math.abs(o.z - v.z) < 18) {
      const facing = o.fx * fx + o.fz * fz;
      if (o.driver === null && (!this.city.isRoad(o.x, o.z) || this.laneOffset(o.x, o.z) > 4.4)) continue; // parked at the curb
      test(o.x, o.z, facing < -0.5 ? 1.2 : 2.0);
    }
    const p = this.player;
    if (!p.vehicleId && !p.passengerIn) test(p.x, p.z, 1.8);
    for (const n of this.npcs) if (!n.hidden && n.mode !== 'in_vehicle' && Math.abs(n.x - v.x) < 18 && Math.abs(n.z - v.z) < 18 && this.city.isRoad(n.x, n.z)) test(n.x, n.z, 1.8);
    return best;
  }

  onCrash(v: Vehicle, impact: number, other?: Vehicle) {
    v.lastCrash = this.t;
    this.audio.crash();
    if (impact > 12) this.player.health -= (impact - 12) * 2;
    if (other && other.driver === 'traffic') this.addEvent('car_crash', v.x, v.z, 'Someone rammed into another car on the street.', 'player', undefined, 0.5);
  }

  hitNPC(n: NPC, v: Vehicle) {
    n.mode = 'knocked';
    n.knockedTimer = 5;
    n.anim = 'down';
    n.yaw = Math.atan2(v.fx, v.fz);
    n.x += v.fx * 1.5; n.z += v.fz * 1.5;
    v.speed *= 0.5;
    this.audio.crash();
    if (v.driver === 'player') {
      this.player.heat = Math.min(5, this.player.heat + 2);
      n.changeRelationship(-35);
      n.setMood('angry', -0.6);
      this.addEvent('hit_pedestrian', n.x, n.z, `Someone ran over ${n.important ? n.name : 'a pedestrian'} with a car near ${this.locationName(n.x, n.z)}!`, 'player', n.p.id, 0.95);
      this.ui.toast(`You hit ${n.important ? n.name : 'a pedestrian'}! People saw that.`, 'bad');
    }
  }

  // ---------------------------------------------------------------------------
  updateNPCs(dt: number) {
    const p = this.player;
    for (const n of this.npcs) {
      n.phase += dt * (n.anim === 'run' ? 11 : 6.5);
      if (n.bark && n.bark.until < this.minutes) n.bark = null;
      switch (n.mode) {
        case 'talking': {
          n.anim = n.busy ? 'idle' : this.dialogue.speakingUntil > this.t ? 'talk' : 'idle';
          n.yaw = Math.atan2(p.x - n.x, p.z - n.z);
          n.hidden = false;
          break;
        }
        case 'knocked': {
          n.knockedTimer -= dt;
          n.anim = 'down';
          if (n.knockedTimer <= 0) { n.mode = 'fleeing'; n.modeUntil = this.minutes + 20; n.say(['What is WRONG with you?!', 'Ow... I\'m calling the cops!', 'My back...'][Math.floor(Math.random() * 3)], this.minutes, 5); n.travelTo = null; n.atPoi = null; }
          break;
        }
        case 'fleeing': {
          const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz) || 1;
          if (d < 25) { n.x += (dx / d) * 4.5 * dt; n.z += (dz / d) * 4.5 * dt; n.yaw = Math.atan2(dx, dz); n.anim = 'run'; this.keepOutOfBuildings(n); }
          if (this.minutes > n.modeUntil || d >= 25) { n.mode = 'routine'; }
          break;
        }
        case 'following': {
          const tx = p.passengerIn || p.vehicleId ? p.x : p.x - Math.sin(p.yaw) * 1.6, tz = p.passengerIn || p.vehicleId ? p.z : p.z - Math.cos(p.yaw) * 1.6;
          const dx = tx - n.x, dz = tz - n.z, d = Math.hypot(dx, dz);
          if (p.vehicleId && d < 5) { n.hidden = true; n.x = p.x; n.z = p.z; n.anim = 'hidden'; }
          else {
            n.hidden = false;
            if (d > 1.2) { const sp = d > 7 ? 6.5 : d > 3 ? 3.4 : 1.6; n.x += (dx / d) * Math.min(d, sp * dt); n.z += (dz / d) * Math.min(d, sp * dt); n.yaw = Math.atan2(dx, dz); n.anim = sp > 5 ? 'run' : 'walk'; this.keepOutOfBuildings(n); }
            else { n.anim = 'idle'; n.yaw = Math.atan2(p.x - n.x, p.z - n.z); }
            if (d > 80) { n.x = p.x - 2; n.z = p.z - 2; }
          }
          if (this.minutes > n.modeUntil) this.dialogue.stopFollowing(n, true);
          break;
        }
        case 'to_vehicle': break; // driven by ride logic
        case 'in_vehicle': n.hidden = true; break;
        case 'chasing': break; // cop logic
        default: {
          n.mode = n.commandPoi ? 'command' : n.mode === 'command' ? 'command' : 'routine';
          n.updateRoutine(dt, this.minutes, this.city);
          if (n.mode === 'command' && !n.commandPoi) n.mode = 'routine';
        }
      }
      n.y = this.city.groundHeight(n.x, n.z);
    }
  }

  keepOutOfBuildings(n: NPC) {
    for (const c of this.city.query(n.x, n.z, 1)) {
      if (c.y1 < 1) continue;
      if (n.x > c.x0 - 0.3 && n.x < c.x1 + 0.3 && n.z > c.z0 - 0.3 && n.z < c.z1 + 0.3) {
        const pen = [n.x - (c.x0 - 0.3), c.x1 + 0.3 - n.x, n.z - (c.z0 - 0.3), c.z1 + 0.3 - n.z];
        const k = pen.indexOf(Math.min(...pen));
        if (k === 0) n.x = c.x0 - 0.3; else if (k === 1) n.x = c.x1 + 0.3; else if (k === 2) n.z = c.z0 - 0.3; else n.z = c.z1 + 0.3;
      }
    }
  }

  // ---- Tier-0 social simulation ------------------------------------------------
  gossip() {
    const vis = this.npcs.filter((n) => n.important && !n.hidden && n.mode === 'routine' && !n.travelTo);
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) > 7 || Math.random() > 0.35) continue;
      for (const [src, dst] of [[a, b], [b, a]] as [NPC, NPC][]) {
        const juicy = src.memories.filter((m) => (m.about === 'player' || m.kind === 'event') && m.importance >= 0.5 && !dst.memories.some((d) => d.text.includes(m.text.slice(0, 40))));
        const m = juicy[juicy.length - 1];
        if (!m) continue;
        dst.addMemory(`${src.firstName} told me: ${m.text}`, 'heard', m.importance * 0.8, this.minutes, m.about);
        if (m.about === 'player' && src.knowsPlayerAs && !dst.knowsPlayerAs) { dst.knowsPlayerAs = src.knowsPlayerAs; dst.flags.nameFrom = src.firstName; }
        if (m.about === 'player') dst.changeRelationship((src.relationship - dst.relationship) * 0.15);
        for (const e of this.events) if (src.seenEvents.has(e.id)) dst.seenEvents.add(e.id);
        src.anim = 'talk';
        if (Math.random() < 0.5) src.say(['You won\'t believe this...', 'Did you hear?', 'So get this—'][Math.floor(Math.random() * 3)], this.minutes, 3);
      }
    }
  }

  ambientBarks() {
    const p = this.player;
    for (const n of this.npcs) {
      if (n.hidden || n.mode !== 'routine' || n.bark) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d > 7 || d < 1) continue;
      const last = this.lastBarkFor.get(n.p.id) ?? -999;
      if (this.t - last < 45 || Math.random() > 0.25) continue;
      this.lastBarkFor.set(n.p.id, this.t);
      const known = n.knowsPlayerAs;
      let text = n.p.barks[Math.floor(Math.random() * n.p.barks.length)];
      if (n.relationship <= -20) text = ['Oh great, it\'s you.', 'Keep walking.', 'Don\'t start.'][Math.floor(Math.random() * 3)];
      else if (known && n.relationship > 10) text = [`Hey ${known}!`, `${known}! Good to see you.`, `Hola, ${known}!`][Math.floor(Math.random() * 3)];
      n.say(text, this.minutes, 4);
    }
  }

  // ---- Events & witnesses -------------------------------------------------------
  addEvent(type: WorldEvent['type'], x: number, z: number, text: string, actor: string, victim?: string, severity = 0.5): WorldEvent {
    const ev: WorldEvent = { id: `ev${++this.evCounter}`, t: this.minutes, type, x, z, text, actor, victim, witnesses: [], severity };
    for (const n of this.npcs) {
      if (n.hidden && n.p.id !== victim) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < 32 || n.p.id === victim) {
        ev.witnesses.push(n.p.id);
        n.seenEvents.add(ev.id);
        if (n.important) n.addMemory(`${formatClock(this.minutes).split('·').pop()!.trim()}: I saw it myself — ${text}`, 'event', severity, this.minutes, actor === 'player' ? 'player' : undefined);
        if (actor === 'player' && severity >= 0.5 && n.p.id !== victim) { n.changeRelationship(-severity * 12); n.setMood('upset', -0.2); }
        if (d < 15 && severity >= 0.5 && n.mode === 'routine') n.say(['Hey!!', 'Whoa!', 'Somebody call Officer Daniels!', 'Are you crazy?!'][Math.floor(Math.random() * 4)], this.minutes, 4);
      }
    }
    // Omar hears about anything with 2+ witnesses (he's the neighborhood news service)
    if (ev.witnesses.length >= 2) { const o = this.npcById.get('omar')!; o.seenEvents.add(ev.id); if (!ev.witnesses.includes('omar')) o.addMemory(`People are saying: ${text}`, 'heard', severity * 0.8, this.minutes, actor === 'player' ? 'player' : undefined); }
    this.events.push(ev);
    if (this.events.length > 60) this.events.shift();
    if (actor === 'player' && severity >= 0.5 && ev.witnesses.length) this.player.reputation -= Math.round(severity * 3);
    return ev;
  }

  // ---- Police (Tier 0) -----------------------------------------------------------
  updateCop(dt: number) {
    const ray = this.npcById.get('ray')!;
    const p = this.player;
    if (ray.hidden || ray.mode === 'talking' || ray.mode === 'knocked') return;
    const d = Math.hypot(ray.x - p.x, ray.z - p.z);
    if (ray.mode !== 'chasing' && p.heat >= 1 && d < 40 && !p.vehicleId && !p.passengerIn && ray.mode === 'routine') {
      ray.mode = 'chasing';
      ray.say('Hey! You! Stop right there!', this.minutes, 4);
      this.ui.toast('Officer Daniels is coming after you!', 'bad');
    }
    if (ray.mode === 'chasing') {
      if (p.heat < 0.5 || d > 70) { ray.mode = 'routine'; ray.say('...Lost them.', this.minutes, 3); return; }
      if (p.vehicleId || p.passengerIn) { ray.anim = 'idle'; ray.yaw = Math.atan2(p.x - ray.x, p.z - ray.z); return; }
      const dx = p.x - ray.x, dz = p.z - ray.z;
      ray.x += (dx / d) * 5.6 * dt; ray.z += (dz / d) * 5.6 * dt; ray.yaw = Math.atan2(dx, dz); ray.anim = 'run';
      this.keepOutOfBuildings(ray);
      if (d < 1.8) {
        const fine = Math.min(p.money, Math.round(40 * Math.ceil(p.heat)));
        p.money -= fine;
        ray.money += fine;
        p.heat = 0;
        ray.mode = 'routine';
        ray.say(`That's a $${fine} fine. Keep it clean, pal.`, this.minutes, 5);
        ray.addMemory(`Caught and fined the player $${fine} for causing trouble.`, 'event', 0.8, this.minutes, 'player');
        ray.changeRelationship(-5);
        this.addEvent('fine', p.x, p.z, `Officer Daniels fined someone $${fine}.`, 'ray', undefined, 0.3);
        this.ui.toast(`Busted! Officer Daniels fined you $${fine}.`, 'bad');
        this.audio.cash();
      }
    }
  }

  // ---- Rides: NPC drives the player somewhere (real in-world action) -------------
  startRide(n: NPC, dest: string): boolean {
    const v = n.p.car ? this.vehById.get(n.p.car.id) : null;
    if (!v || v.driver === 'player' || v.owner === 'stolen') { n.say("Wait... where's my car?!", this.minutes, 4); return false; }
    if (this.ride) return false;
    this.ride = { npcId: n.p.id, vehId: v.id, dest, phase: 'walk', timer: 0 };
    n.mode = 'to_vehicle';
    n.hidden = false;
    return true;
  }

  updateRide(dt: number) {
    const r = this.ride;
    if (!r) return;
    const n = this.npcById.get(r.npcId)!, v = this.vehById.get(r.vehId)!;
    const p = this.player;
    r.timer += dt;
    if (r.phase === 'walk') {
      if (n.mode === 'talking') return; // still chatting
      n.mode = 'to_vehicle';
      const [sx, sz] = v.sidePoint(-1);
      const dx = sx - n.x, dz = sz - n.z, d = Math.hypot(dx, dz);
      if (d > 0.8) { const sp = d > 20 ? 4 : 2.2; n.x += (dx / d) * sp * dt; n.z += (dz / d) * sp * dt; n.yaw = Math.atan2(dx, dz); n.anim = sp > 3 ? 'run' : 'walk'; }
      if (d < 1 || r.timer > 45) {
        n.mode = 'in_vehicle'; n.hidden = true; v.driver = n.p.id; n.vehicleId = v.id; r.phase = 'wait'; r.timer = 0;
        this.audio.door();
        this.ui.toast(`${n.firstName} is waiting in the car. Walk over and press <kbd>E</kbd> to hop in.`, 'ai', 7000);
      }
    } else if (r.phase === 'wait') {
      n.x = v.x; n.z = v.z;
      if (r.timer > 75) {
        this.ui.toast(`${n.firstName} got tired of waiting.`, 'info');
        n.addMemory('Offered the player a ride but they never got in the car.', 'chat', 0.5, this.minutes, 'player');
        n.changeRelationship(-3);
        this.endRide(false);
      }
    } else if (r.phase === 'drive') {
      n.x = v.x; n.z = v.z;
      if (r.timer > 150) this.onRideArrived(); // safety valve
    } else if (r.phase === 'arrived') {
      if (r.timer > 2.5) this.endRide(true);
    }
    void p;
  }

  boardRide() {
    const r = this.ride!;
    const v = this.vehById.get(r.vehId)!, n = this.npcById.get(r.npcId)!;
    this.player.passengerIn = v.id;
    v.passenger = 'player';
    const poi = this.city.getPOI(r.dest)!;
    v.routeTo(poi.door[0], poi.door[1]);
    r.phase = 'drive'; r.timer = 0;
    this.audio.door();
    n.say(`Buckle up! ${poi.name}, here we come.`, this.minutes, 4);
    this.ui.toast(`Riding with ${n.firstName} to ${poi.name}. Press <kbd>E</kbd> to get out early.`, 'ai', 6000);
  }

  onRideArrived() {
    const r = this.ride;
    if (!r || r.phase !== 'drive') return;
    const n = this.npcById.get(r.npcId)!, v = this.vehById.get(r.vehId)!;
    v.speed = 0;
    r.phase = 'arrived'; r.timer = 0;
    const poi = this.city.getPOI(r.dest)!;
    n.say(`Here we are — ${poi.name}!`, this.minutes, 4);
    n.addMemory(`Drove ${n.knowsPlayerAs ?? 'the player'} to ${poi.name}.`, 'chat', 0.7, this.minutes, 'player');
    n.changeRelationship(3);
    this.leaveRide(false);
    this.ui.toast(`${n.firstName} dropped you at ${poi.name}.`, 'good');
  }

  leaveRide(early: boolean) {
    const p = this.player;
    const v = p.passengerIn ? this.vehById.get(p.passengerIn) : null;
    if (!v) return;
    if (early && Math.abs(v.speed) > 3) { this.ui.toast('Wait for the car to slow down.', 'info', 1500); return; }
    p.passengerIn = null;
    v.passenger = null;
    const [sx, sz] = v.sidePoint(1);
    p.x = sx; p.z = sz; p.y = this.city.groundHeight(sx, sz);
    this.audio.door();
    if (early && this.ride) { this.npcById.get(this.ride.npcId)!.say('Oh — this is good? Okay, see ya!', this.minutes, 3); this.endRide(true); }
  }

  endRide(ok: boolean) {
    const r = this.ride;
    if (!r) return;
    const n = this.npcById.get(r.npcId)!, v = this.vehById.get(r.vehId)!;
    if (this.player.passengerIn === v.id) this.leaveRide(false);
    v.driver = null; v.ai = null; v.speed = 0;
    const [sx, sz] = v.sidePoint(1);
    n.x = sx; n.z = sz; n.hidden = false; n.mode = 'routine'; n.vehicleId = null; n.travelTo = null; n.atPoi = null;
    this.ride = null;
    void ok;
  }

  // ---------------------------------------------------------------------------
  onNewDay() {
    const day = Math.floor(this.minutes / 1440) + 1;
    if (this.business.owned) {
      const income = 80 + Math.max(0, this.player.reputation) * 5;
      this.player.money += income;
      this.business.earned += income;
      this.ui.toast(`Your corner kiosk made $${income} yesterday.`, 'good', 6000);
      this.audio.cash();
    }
    this.ui.bigMessage(`Day ${day}`, 'Another day of paid time off.', 3000);
  }

  onWasted() {
    const p = this.player;
    this.ui.fade(true);
    this.paused = true;
    setTimeout(() => {
      if (p.vehicleId) { const v = this.vehById.get(p.vehicleId)!; v.driver = null; p.vehicleId = null; }
      if (p.passengerIn) this.leaveRide(false);
      const clinic = this.city.getPOI('clinic')!;
      p.x = clinic.door[0]; p.z = clinic.door[1]; p.health = 100;
      const bill = Math.min(p.money, 100);
      p.money -= bill;
      this.minutes += 120;
      for (const n of this.npcs) if (n.mode === 'routine') n.syncToSchedule(this.minutes, this.city);
      const mei = this.npcById.get('mei')!;
      mei.addMemory('Treated the player at the clinic after they collapsed.', 'event', 0.7, this.minutes, 'player');
      this.ui.fade(false);
      this.paused = false;
      this.ui.bigMessage('Patched up', `You woke up at Palmetto Clinic. Medical bill: $${bill}.`, 4000);
    }, 900);
  }

  locationName(x: number, z: number): string {
    let best = 'the streets of Palmetto Heights', bd = Infinity;
    for (const p of this.city.pois) {
      const d = Math.hypot(p.spot[0] - x, p.spot[1] - z);
      if (d < Math.max(14, p.radius * 2) && d < bd) { bd = d; best = p.name; }
    }
    if (bd === Infinity) {
      if (x > BEACH_X0) return 'Palmetto Beach';
      if (this.city.isRoad(x, z)) return 'the street';
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  render() {
    const r = this.r;
    r.resize();
    const L = lightingAt(this.minutes, this.t);
    // fog distance tightens slightly at night
    r.fogFar = 420 - L.night * 120;
    r.setCamera(this.cam.eye, this.cam.look, 1.0);
    // point lights at night: nearest lamps
    if (L.night > 0.15) {
      const c = this.cam.look;
      const lamps = this.city.lamps.map((l) => ({ l, d: (l[0] - c[0]) ** 2 + (l[2] - c[2]) ** 2 })).sort((a, b) => a.d - b.d).slice(0, 8);
      L.pointLights = lamps.slice(0, 6).map(({ l }) => ({ pos: l, color: [1.0, 0.78, 0.5] as Vec3 }));
    }
    const p = this.player;
    const cx = this.cam.look[0], cz = this.cam.look[2];
    const now = performance.now();
    const rdt = Math.min(0.1, (now - (this.lastRender || now)) / 1000) * (this.paused && !this.titleShowing() ? 0 : 1);
    this.lastRender = now;
    for (const v of this.vehicles) v.draw(rdt, Math.abs(v.x - cx) < 260 && Math.abs(v.z - cz) < 260);
    const view = (id: string, h: number) => {
      let cv = this.views.get(id);
      if (!cv) { cv = this.avatars.create(avatarFor(id), h); this.views.set(id, cv); r.scene.add(cv.root); }
      return cv;
    };
    for (const n of this.npcs) {
      const d = Math.hypot(n.x - cx, n.z - cz);
      const vis = !n.hidden && d < 130;
      if (!vis && !this.views.has(n.p.id)) continue;
      view(n.p.id, 0.94 + n.p.appearance.height * 0.07).update(rdt, n.x, n.y, n.z, n.yaw, n.anim, n.speed || (n.anim === 'run' ? 4.5 : 1.4), vis, d < 70);
    }
    view('player', 1).update(rdt, p.x, p.y, p.z, p.yaw, p.anim, p.speed, !p.vehicleId && !p.passengerIn, true);
    r.render(L, [cx, 0, cz]);
    this.frame++;
    if (!this.paused || $('#title').style.display !== 'flex') this.renderUI(L.night);
  }

  renderUI(night: number) {
    const p = this.player;
    const veh = p.vehicleId ? this.vehById.get(p.vehicleId) : p.passengerIn ? this.vehById.get(p.passengerIn) : null;
    const loc = this.locationName(p.x, p.z);
    if (loc !== this.lastLoc && this.frame > 5) { this.lastLoc = loc; }
    const c = this.ai.costs;
    this.ui.hud({
      clock: formatClock(this.minutes), money: p.money, health: p.health, stamina: p.stamina, heat: p.heat,
      objective: this.dialogue.objectiveHTML(), ai: this.aiBadge(),
      cost: this.aiMode === 'live' ? `${c.requests} AI calls · $${c.costUSD.toFixed(4)} · avg $${this.ai.avgCostPerInteraction().toFixed(5)}` : `${c.simulated} simulated replies · $0.00`,
      location: loc, speed: p.vehicleId ? veh?.speed : undefined,
    });
    // prompt
    let prompt: string | null = null;
    if (!this.ui.isDialogueOpen && !this.paused) {
      if (p.vehicleId) prompt = null;
      else if (p.passengerIn) prompt = `<kbd>E</kbd> Get out`;
      else {
        const n = this.nearestTalkable();
        const v = this.nearestVehicle(3.4);
        if (this.ride && v && v.id === this.ride.vehId && this.ride.phase === 'wait') prompt = `<kbd>E</kbd> Hop in with ${esc(this.npcById.get(this.ride.npcId)!.firstName)}`;
        else if (n) prompt = `<kbd>E</kbd> Talk to <b>${esc(n.name)}</b> <small>· ${esc(n.p.occupation)}</small>`;
        else if (v) { const a = this.vehicleAccess(v); prompt = a.ok ? `<kbd>F</kbd> Drive ${esc(v.name)}${a.steal ? ' <small style="color:#ff8fa0">(steal)</small>' : ''}` : a.why ? `<small>${esc(a.why)}</small>` : null; }
      }
    }
    this.ui.prompt(prompt);
    // bubbles + name tags
    const list: { x: number; y: number; text?: string; name?: string; scale: number }[] = [];
    for (const n of this.npcs) {
      if (n.hidden) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d > 30 && !n.bark) continue;
      if (d > 45) continue;
      const s = this.r.project(n.headPos());
      if (!s) continue;
      const showName = d < 14 && n.important;
      const text = n.bark?.text;
      if (!showName && !text) continue;
      list.push({ x: s.x, y: s.y, text, name: showName ? n.name : undefined, scale: clamp(1.25 - d / 40, 0.6, 1.1) });
    }
    this.ui.bubbles(list);
    if (this.frame % 3 === 0) drawMinimap(this, $<HTMLCanvasElement>('#minimap'), night);
  }

  // ---------------------------------------------------------------------------
  serialize() {
    const p = this.player;
    return {
      version: SAVE_VERSION, savedAt: Date.now(), minutes: this.minutes,
      player: { x: p.x, z: p.z, yaw: p.yaw, health: p.health, money: p.money, inventory: p.inventory, name: p.name, heat: p.heat, reputation: p.reputation, ownedVehicles: p.ownedVehicles },
      npcs: this.npcs.filter((n) => n.important || n.chat.length || n.memories.length).map((n) => n.toSave()),
      vehicles: this.vehicles.filter((v) => v.owner !== 'traffic' || v.driver !== 'traffic').map((v) => ({ id: v.id, x: v.x, z: v.z, yaw: v.yaw, owner: v.owner, forSale: v.forSale })),
      jobs: this.jobs, events: this.events.slice(-40), flags: this.flags, business: this.business, costs: this.ai.costs,
      dialogueState: this.dialogue.serialize(),
    };
  }

  async saveGame(announce: boolean) {
    if (this.ui.isDialogueOpen && !announce) return;
    await saveSlot('slot1', this.serialize());
    if (announce) this.ui.toast('Game saved.', 'good');
  }

  async loadGame() {
    type SaveData = ReturnType<Game['serialize']>;
    const s = await loadSlot<SaveData>('slot1');
    if (!s) { this.ui.toast('No save found.', 'bad'); return; }
    this.audio.start();
    if (this.ride) this.endRide(false);
    const p = this.player;
    if (p.vehicleId) { const v = this.vehById.get(p.vehicleId); if (v) v.driver = null; p.vehicleId = null; }
    p.passengerIn = null;
    this.minutes = s.minutes;
    Object.assign(p, { x: s.player.x, z: s.player.z, yaw: s.player.yaw, health: s.player.health, money: s.player.money, inventory: s.player.inventory ?? {}, name: s.player.name, heat: s.player.heat ?? 0, reputation: s.player.reputation ?? 0, ownedVehicles: s.player.ownedVehicles ?? [] });
    p.y = this.city.groundHeight(p.x, p.z);
    for (const ns of s.npcs as NPCSave[]) { const n = this.npcById.get(ns.id); if (n) { n.load(ns); n.mode = 'routine'; n.syncToSchedule(this.minutes, this.city); if (!n.important) { n.x = ns.x; n.z = ns.z; } } }
    for (const vs of s.vehicles) {
      const v = this.vehById.get(vs.id);
      if (!v) continue;
      v.x = vs.x; v.z = vs.z; v.yaw = vs.yaw; v.owner = vs.owner; v.forSale = vs.forSale; v.speed = 0; v.driver = v.owner === 'traffic' ? 'traffic' : null;
      if (v.owner !== 'traffic') v.ai = null;
    }
    this.jobs = s.jobs ?? []; this.events = s.events ?? []; this.flags = s.flags ?? {}; this.business = s.business ?? this.business;
    if (s.costs) this.ai.costs = s.costs;
    this.evCounter = this.events.reduce((m, e) => Math.max(m, parseInt(e.id.slice(2)) || 0), 0);
    this.dialogue.load(s.dialogueState);
    this.ui.showPanel(null);
    this.paused = false;
    this.ui.bigMessage('Welcome back', formatClock(this.minutes), 2500);
  }

  // ---------------------------------------------------------------------------
  costHTML(): string {
    const c = this.ai.costs;
    const live = c.log.filter((l) => l.source === 'live');
    const avgMs = live.length ? live.reduce((s, l) => s + l.ms, 0) / live.length : 0;
    const rows = c.log.slice(-8).reverse().map((l) => `<tr><td>${esc(l.npc)}</td><td>${esc(l.model.split('/').pop()!)}</td><td>${l.source}</td><td>${l.prompt}/${l.completion}</td><td>$${l.cost.toFixed(6)}</td></tr>`).join('');
    return `<div>Provider: <b>${esc(this.aiProviderLabel)}</b> · Tier 1: <code>${esc(this.ai.config.tier1Model)}</code> · Tier 2: <code>${esc(this.ai.config.tier2Model)}</code></div>
      <div>Live requests: <b>${c.requests}</b> · Tokens in/out: <b>${c.promptTokens}/${c.completionTokens}</b> · Total: <b>$${c.costUSD.toFixed(5)}</b> · Avg per interaction: <b>$${this.ai.avgCostPerInteraction().toFixed(6)}</b> · Avg latency ${avgMs.toFixed(0)} ms</div>
      <div>Cache hits: ${c.cacheHits} · Failures (fell back to simulated): ${c.failures} · Simulated replies: ${c.simulated} · Budget: $${this.ai.config.sessionBudgetUSD.toFixed(2)}</div>
      ${rows ? `<table class="t" style="margin-top:8px"><tr><th>NPC</th><th>Model</th><th>Source</th><th>Tokens</th><th>Cost</th></tr>${rows}</table>` : ''}
      <div style="margin-top:6px">Costs come from OpenRouter's billed <code>usage.cost</code> when available; otherwise from token counts × configured prices.</div>`;
  }

  journalHTML(): string {
    const p = this.player;
    const jobs = this.jobs.filter((j) => j.status === 'active' || j.status === 'ready');
    const done = this.jobs.filter((j) => j.status === 'done');
    const people = this.npcs.filter((n) => n.important && (n.chat.length || n.memories.some((m) => m.about === 'player'))).sort((a, b) => b.relationship - a.relationship);
    const inv = Object.entries(p.inventory).filter(([, n]) => n > 0);
    const relLabel = (r: number) => r >= 45 ? 'Close friend' : r >= 15 ? 'Friendly' : r > -15 ? 'Neutral' : r > -50 ? 'Wary' : 'Hostile';
    return `
      <div class="small">You are ${p.name ? `<b>${esc(p.name)}</b>` : 'a visitor nobody knows yet'} · Reputation ${p.reputation >= 0 ? '+' : ''}${p.reputation} · ${p.ownedVehicles.length ? 'Owns: ' + p.ownedVehicles.map((id) => esc(this.vehById.get(id)?.name ?? id)).join(', ') : 'Driving the PTO Rentals hatchback'}${this.business.owned ? ` · Kiosk owner (earned $${this.business.earned})` : ''}</div>
      <h3>Active jobs</h3>${jobs.length ? jobs.map((j) => `<div class="person"><div><b>${esc(j.title)}</b> <span class="pill">$${j.pay}</span><div class="small">${esc(j.description)}</div><div class="small" style="color:var(--sun)">${this.dialogue.jobStepText(j)}</div></div></div>`).join('') : '<div class="small">No active jobs. Ask around — people in town have work.</div>'}
      ${done.length ? `<div class="small" style="margin-top:6px">Completed: ${done.map((j) => esc(j.title)).join(', ')}</div>` : ''}
      <h3>Inventory</h3>${inv.length ? inv.map(([id, n]) => `<button class="chip" data-use="${id}">${esc(ITEMS[id]?.name ?? id)} ×${n}${ITEMS[id]?.heal ? ' · use' : ''}</button>`).join(' ') : '<div class="small">Empty pockets.</div>'}
      <h3>People you've met</h3>${people.length ? people.map((n) => `<div class="person"><div class="av" style="background:${n.p.appearance.shirt}">${n.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div><div style="flex:1"><b>${esc(n.name)}</b> <span class="pill">${relLabel(n.relationship)} ${n.relationship > 0 ? '+' : ''}${n.relationship}</span><div class="small">${esc(n.p.occupation)} · ${esc(n.statusLine(this.city))}</div><div class="small">${esc(n.memories.filter((m) => m.about === 'player').slice(-1)[0]?.text ?? '')}</div></div></div>`).join('') : '<div class="small">You haven\'t really met anyone yet.</div>'}
      <h3>Recent town events</h3>${this.events.slice(-5).reverse().map((e) => `<div class="small">• ${esc(formatClock(e.t))} — ${esc(e.text)} <span class="pill">${e.witnesses.length} witnesses</span></div>`).join('') || '<div class="small">Quiet so far.</div>'}`;
  }

  get hour() { return hourOf(this.minutes); }
  get cityBounds() { return CITY; }
  poi(id: string) { return this.city.getPOI(id) as POIWithNodes | undefined; }
  angleTo(n: NPC) { return angleWrap(Math.atan2(n.x - this.player.x, n.z - this.player.z)); }
}
