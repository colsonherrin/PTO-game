import type { City, POIWithNodes } from '../world/city';
import { approachAngle, clamp, type Vec3 } from '../engine/math';
import type { Persona, Activity, ScheduleEntry } from './personas';
import type { AnimState } from '../game/models';
import type { ChatTurn, Memory } from '../game/state';
import { hourOf } from '../game/state';

export type NPCMode = 'routine' | 'talking' | 'following' | 'command' | 'to_vehicle' | 'in_vehicle' | 'knocked' | 'fleeing' | 'chasing' | 'activity';

export interface NPCSave {
  id: string; x: number; z: number; yaw: number; relationship: number; knowsPlayerAs: string | null;
  memories: Memory[]; chat: ChatTurn[]; summary: string; mood: string; moodScore: number;
  inventory: Record<string, number>; money: number; npcRel: Record<string, number>; flags: Record<string, boolean | number | string>;
}

export const MOODS = ['ecstatic', 'happy', 'content', 'neutral', 'tired', 'annoyed', 'upset', 'angry', 'scared'] as const;

export class NPC {
  p: Persona;
  important: boolean;
  x: number; z: number; y = 0.15; yaw = 0;
  speed = 0;
  path: [number, number][] = [];
  pathIdx = 0;
  travelTo: string | null = null;
  atPoi: string | null = null;
  activity: Activity = 'relax';
  mode: NPCMode = 'routine';
  modeUntil = 0; // game minutes
  hidden = false;
  phase = Math.random() * 6;
  anim: AnimState = 'idle';
  idleTarget: [number, number] | null = null;
  nextWander = 0;
  mood = 'content';
  moodScore = 0.2; // -1..1
  relationship = 0; // toward the player, -100..100
  knowsPlayerAs: string | null = null;
  memories: Memory[] = [];
  chat: ChatTurn[] = [];
  summary = '';
  inventory: Record<string, number>;
  money: number;
  npcRel: Record<string, number> = {};
  flags: Record<string, boolean | number | string> = {};
  bark: { text: string; until: number } | null = null;
  commandPoi: string | null = null;
  commandUntil = 0;
  vehicleId: string | null = null; // vehicle currently occupied
  knockedTimer = 0;
  lastGossip = 0;
  busy = false; // an LLM request is in flight
  seenEvents = new Set<string>();

  constructor(p: Persona, important: boolean, x: number, z: number) {
    this.p = p;
    this.important = important;
    this.x = x; this.z = z;
    this.inventory = { ...p.inventory };
    this.money = p.money;
    for (const [k, v] of Object.entries(p.relationships)) this.npcRel[k] = v.score;
  }

  get name() { return this.p.name; }
  get firstName() { const q = this.p.name.match(/"(.+?)"/); if (q) return q[1]; const w = this.p.name.split(' '); return w[0] === 'Officer' ? w[1] : w[0]; }

  currentEntry(mins: number): ScheduleEntry {
    const h = hourOf(mins);
    let cur = this.p.schedule[0];
    for (const e of this.p.schedule) if (h >= e.from) cur = e;
    return cur;
  }

  opinion(): string {
    const r = this.relationship;
    if (r <= -50) return 'hostile — dislikes and distrusts the player';
    if (r <= -15) return 'wary — has a bad impression of the player';
    if (r < 15) return this.memories.some((m) => m.about === 'player' || m.kind === 'chat') ? 'neutral acquaintance' : 'stranger — has never met the player';
    if (r < 45) return 'friendly — likes the player';
    return 'close friend — trusts the player';
  }

  addMemory(text: string, kind: Memory['kind'], importance: number, t: number, about?: string) {
    // avoid exact duplicates
    if (this.memories.length && this.memories[this.memories.length - 1].text === text) return;
    this.memories.push({ t, text, kind, importance, about });
    this.compressMemories();
  }

  /** Deterministic context compression: oldest low-importance memories fold into a rolling summary. */
  compressMemories(max = 24) {
    if (this.memories.length <= max) return;
    const sorted = [...this.memories].sort((a, b) => a.t - b.t);
    const old = sorted.slice(0, sorted.length - Math.floor(max * 0.6));
    const keep = new Set(sorted.slice(sorted.length - Math.floor(max * 0.6)));
    // important old memories survive verbatim
    const survivors = old.filter((m) => m.importance >= 0.8).slice(-4);
    const folded = old.filter((m) => !survivors.includes(m));
    const gist = folded.map((m) => m.text.replace(/\.$/, '')).join('; ');
    this.summary = (this.summary ? this.summary + '; ' : '') + gist;
    if (this.summary.length > 600) this.summary = '…' + this.summary.slice(this.summary.length - 600);
    this.memories = [...survivors, ...sorted.filter((m) => keep.has(m))];
  }

  setMood(m: string, delta = 0) {
    if ((MOODS as readonly string[]).includes(m)) this.mood = m;
    this.moodScore = clamp(this.moodScore + delta, -1, 1);
  }

  changeRelationship(d: number) { this.relationship = clamp(Math.round(this.relationship + d), -100, 100); }

  say(text: string, mins: number, dur = 4) { this.bark = { text, until: mins + dur }; }

  goTo(city: City, poiId: string) {
    const poi = city.getPOI(poiId) as POIWithNodes | undefined;
    if (!poi) return false;
    if (this.hidden && this.atPoi) {
      const cur = city.getPOI(this.atPoi);
      if (cur) { this.x = cur.door[0]; this.z = cur.door[1]; }
      this.hidden = false;
    }
    this.path = city.path(this.x, this.z, poi.doorNode);
    this.path.push([poi.spot[0], poi.spot[1]]);
    this.pathIdx = 0;
    this.travelTo = poiId;
    this.atPoi = null;
    this.idleTarget = null;
    return true;
  }

  /** Move along the current path. Returns true when the path is complete. */
  stepPath(dt: number, speed: number): boolean {
    if (this.pathIdx >= this.path.length) return true;
    const [tx, tz] = this.path[this.pathIdx];
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) { this.pathIdx++; return this.pathIdx >= this.path.length; }
    const step = Math.min(d, speed * dt);
    this.x += (dx / d) * step; this.z += (dz / d) * step;
    this.yaw = approachAngle(this.yaw, Math.atan2(dx, dz), dt * 8);
    this.speed = speed;
    return false;
  }

  /** Tier-0 deterministic routine: follow the daily schedule. */
  updateRoutine(dt: number, mins: number, city: City) {
    const e = this.currentEntry(mins);
    this.activity = e.activity;
    if (this.commandPoi && mins > this.commandUntil) { this.commandPoi = null; if (this.mode === 'command') this.mode = 'routine'; }
    const target = this.commandPoi ?? e.poi;
    if (this.atPoi !== target && this.travelTo !== target) this.goTo(city, target);
    if (this.travelTo) {
      const run = false;
      const done = this.stepPath(dt, this.important ? 1.5 : 1.35);
      this.anim = run ? 'run' : 'walk';
      if (done) {
        this.atPoi = this.travelTo;
        this.travelTo = null;
        this.speed = 0;
        const poi = city.getPOI(this.atPoi)!;
        this.hidden = this.commandPoi ? false : poi.indoor || e.activity === 'sleep';
      }
    } else {
      this.speed = 0;
      // idle wandering within the POI radius (outdoor only)
      const poi = city.getPOI(this.atPoi!)!;
      if (!this.hidden && mins > this.nextWander) {
        const r = Math.min(poi.radius, 4);
        this.idleTarget = this.important && poi.kind !== 'outdoor' ? null : [poi.spot[0] + (Math.random() - 0.5) * r, poi.spot[1] + (Math.random() - 0.5) * r];
        this.nextWander = mins + 8 + Math.random() * 25;
        if (!this.idleTarget) this.yaw = this.faceYawFor(poi.spot, poi.door);
      }
      if (this.idleTarget) {
        const dx = this.idleTarget[0] - this.x, dz = this.idleTarget[1] - this.z, d = Math.hypot(dx, dz);
        if (d > 0.3) { this.x += (dx / d) * 1.0 * dt; this.z += (dz / d) * 1.0 * dt; this.yaw = approachAngle(this.yaw, Math.atan2(dx, dz), dt * 6); this.anim = 'walk'; }
        else { this.idleTarget = null; this.anim = 'idle'; }
      } else this.anim = this.activity === 'socialize' && Math.sin(mins * 0.7 + this.phase) > 0.3 ? 'talk' : 'idle';
    }
  }

  private faceYawFor(spot: [number, number], door: [number, number]) {
    return Math.atan2(door[0] - spot[0], door[1] - spot[1]);
  }

  /** Teleport to where the schedule says (after time skips / loading). */
  syncToSchedule(mins: number, city: City) {
    const e = this.currentEntry(mins);
    const poi = city.getPOI(e.poi);
    if (!poi) return;
    this.x = poi.spot[0] + (Math.random() - 0.5) * 2;
    this.z = poi.spot[1] + (Math.random() - 0.5) * 2;
    this.atPoi = e.poi; this.travelTo = null; this.path = [];
    this.hidden = poi.indoor || e.activity === 'sleep';
    this.mode = 'routine'; this.commandPoi = null;
  }

  statusLine(city: City): string {
    if (this.mode === 'following') return 'Hanging out with you';
    if (this.mode === 'in_vehicle') return 'Driving';
    if (this.mode === 'knocked') return 'Knocked down!';
    if (this.travelTo) return `Heading to ${city.getPOI(this.travelTo)?.name ?? 'somewhere'}`;
    const where = this.atPoi ? city.getPOI(this.atPoi)?.name : 'around town';
    const verb: Record<Activity, string> = { sleep: 'Sleeping at', work: 'Working at', eat: 'Eating at', socialize: 'Socializing at', exercise: 'Exercising at', errand: 'Running errands at', relax: 'Relaxing at' };
    return `${verb[this.activity]} ${where}`;
  }

  headPos(): Vec3 { return [this.x, this.y + 2.1 * this.p.appearance.height, this.z]; }

  toSave(): NPCSave {
    return { id: this.p.id, x: this.x, z: this.z, yaw: this.yaw, relationship: this.relationship, knowsPlayerAs: this.knowsPlayerAs, memories: this.memories, chat: this.chat.slice(-12), summary: this.summary, mood: this.mood, moodScore: this.moodScore, inventory: this.inventory, money: this.money, npcRel: this.npcRel, flags: this.flags };
  }

  load(s: NPCSave) {
    Object.assign(this, { x: s.x, z: s.z, yaw: s.yaw, relationship: s.relationship, knowsPlayerAs: s.knowsPlayerAs, memories: s.memories ?? [], chat: s.chat ?? [], summary: s.summary ?? '', mood: s.mood, moodScore: s.moodScore, inventory: s.inventory, money: s.money, npcRel: s.npcRel ?? this.npcRel, flags: s.flags ?? {} });
  }
}
