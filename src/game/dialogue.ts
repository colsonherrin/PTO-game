// Bridges conversation ↔ world: builds what an NPC can perceive, routes to LLM or the
// simulated brain, validates proposed actions and executes them in the game world.
import type { Game } from './game';
import type { NPC } from '../npc/npc';
import { PERSONA_BY_ID, type JobTemplate } from '../npc/personas';
import { availableActions, parseNPCResponse, validateAction, type ActionContext, type NPCResponse, type ProposedAction } from '../ai/actions';
import { systemPrompt, situationPrompt, estimateTokens, type TalkContext } from '../ai/prompt';
import { simulateResponse } from '../ai/simulated';
import { ITEMS, VEHICLES_FOR_SALE, formatClock, type ActiveJob } from './state';
import { esc, type OfferCard, type QuickAction } from '../ui/ui';
import { clamp } from '../engine/math';

const ACTIVITY_DESC: Record<string, string> = {
  heal: 'treat the player\'s injuries for free',
  live_music_night: 'agree to book Lena for a live music night at The Low Tide (completes the gig request)',
  workout: 'run a quick training session with the player',
};
const VISIBLE_ITEMS = ['pastry_box', 'limes', 'painting', 'flowers'];

export class DialogueSystem {
  npc: NPC | null = null;
  speakingUntil = 0;
  private jobCounter = 0;
  private sessionTurns = 0;
  private game: Game;

  constructor(game: Game) { this.game = game; }

  // ---------------------------------------------------------------------------
  open(n: NPC) {
    const g = this.game;
    if (n.busy) return;
    this.npc = n;
    this.sessionTurns = 0;
    n.flags.prevMode = n.mode;
    n.mode = 'talking';
    n.hidden = false;
    g.input.unlock();
    g.ui.onSend = (t) => void this.send(t);
    g.ui.onCloseDialogue = () => this.close();
    g.ui.openDialogue(this.info(n), n.chat, n.firstName);
    // Tier-0 greeting (no inference): depends on memory + relationship
    const met = n.chat.length > 0 || n.memories.some((m) => m.about === 'player');
    const nm = n.knowsPlayerAs;
    let greet: string;
    if (n.relationship <= -30) greet = nm ? `${nm}. What do you want now?` : 'What do you want?';
    else if (met && nm) greet = n.relationship >= 30 ? `${nm}! There you are.` : `Oh, hey ${nm}.`;
    else if (met) greet = 'Oh — you again. Hi.';
    else if (nm && n.flags.nameFrom) greet = `Hey... you must be ${nm}? ${n.flags.nameFrom} mentioned you.`;
    else greet = n.p.barks[0];
    g.ui.addMessage('npc', greet, n.firstName, n.important ? '' : 'local resident');
    if (g.aiMode === 'sim') g.ui.addMessage('system', '◐ Simulated dialogue — add an OpenRouter key (Esc → AI) for live AI conversations.', n.firstName);
    this.refreshControls();
    g.audio.blip();
  }

  close() {
    const g = this.game, n = this.npc;
    if (!n) return;
    g.ui.closeDialogue();
    if (this.sessionTurns > 0) {
      n.addMemory(`Talked with ${n.knowsPlayerAs ?? 'a visitor'} at ${g.locationName(n.x, n.z)} (${formatClock(g.minutes)}).`, 'chat', 0.35, g.minutes, 'player');
      void g.saveGame(false).catch(() => {});
    }
    if (n.mode === 'talking') {
      const prev = n.flags.prevMode as string;
      n.mode = prev === 'following' ? 'following' : prev === 'to_vehicle' ? 'to_vehicle' : 'routine';
      if (n.mode === 'routine') { n.travelTo = null; n.atPoi = null; }
    }
    if (g.ride && g.ride.npcId === n.p.id && g.ride.phase === 'walk') n.mode = 'to_vehicle';
    this.npc = null;
  }

  update(dt: number) {
    const n = this.npc;
    void dt;
    if (!n) return;
    const p = this.game.player;
    if (Math.hypot(n.x - p.x, n.z - p.z) > 6 || p.vehicleId) this.close();
  }

  info(n: NPC) {
    const g = this.game;
    return {
      name: n.name, occupation: n.p.occupation, mood: n.mood, relationship: n.relationship, knownAs: n.knowsPlayerAs,
      status: n.statusLine(g.city), initials: n.name.replace(/".*?"\s*/, '').split(' ').filter((w) => w !== 'Officer').map((w) => w[0]).join('').slice(0, 2),
      color: n.p.appearance.shirt, aiLabel: g.aiMode === 'live' ? '<span class="badge-live" style="padding:3px 8px;border-radius:999px">live AI</span>' : '<span class="badge-sim" style="padding:3px 8px;border-radius:999px">simulated</span>',
    };
  }

  // ---------------------------------------------------------------------------
  /** What this NPC can actually perceive and offer right now (non-omniscient). */
  buildContext(n: NPC): TalkContext {
    const g = this.game, p = g.player;
    const h = g.hour;
    const dayPart = h < 5 ? 'late night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
    const nearby: string[] = [];
    for (const o of g.npcs) {
      if (o === n || o.hidden) continue;
      if (Math.hypot(o.x - n.x, o.z - n.z) > 20) continue;
      nearby.push(o.important && (n.npcRel[o.p.id] !== undefined || o.p.id === 'ray' || o.p.id === 'omar') ? `${o.name} (${o.p.occupation})` : o.important ? `someone (${o.p.occupation.toLowerCase()})` : 'a passerby');
      if (nearby.length > 5) break;
    }
    const obs: string[] = [];
    if (p.vehicleId || p.passengerIn) obs.push('they are in a car');
    for (const it of VISIBLE_ITEMS) if (p.inventory[it]) obs.push(`they are carrying ${ITEMS[it].name.toLowerCase()}`);
    if (p.health < 50) obs.push('they look hurt');
    if (p.ownedVehicles.length && Math.random() < 1) { const v = g.vehById.get(p.ownedVehicles[0]); if (v && Math.hypot(v.x - n.x, v.z - n.z) < 25) obs.push(`their ${v.name} is parked nearby`); }
    const jobStatus: string[] = [];
    for (const j of g.jobs) {
      if (j.status !== 'active') continue;
      const giverName = PERSONA_BY_ID[j.giver]?.name ?? j.giver;
      if (j.giver === n.p.id) jobStatus.push(`You hired the player for "${j.title}" — still in progress.`);
      if (j.deliverTo === n.p.id && j.item && p.inventory[j.item] && (j.kind === 'deliver_item' || j.stage === 1)) jobStatus.push(`The player is carrying ${ITEMS[j.item].name.toLowerCase()} for you from ${giverName}.`);
      if (j.pickupFrom === n.p.id && j.stage === 0) jobStatus.push(`${giverName} sent the player to pick up ${ITEMS[j.item!].name.toLowerCase()} from you.`);
      if (j.kind === 'persuade' && j.deliverTo === n.p.id) jobStatus.push(`The player may ask you to book ${giverName} for a gig.`);
    }
    const actx = this.buildActionContext(n);
    const locs = g.city.pois.map((q) => ({ id: q.id, name: q.name }));
    return {
      timeStr: formatClock(g.minutes), dayPart, locationName: g.locationName(n.x, n.z), npcStatus: n.statusLine(g.city), nearby,
      playerName: n.knowsPlayerAs, playerObservations: obs,
      knownEvents: g.events.filter((e) => n.seenEvents.has(e.id)).slice(-4).map((e) => ({ id: e.id, text: e.text })),
      jobs: (n.p.jobs ?? []).filter((t) => actx.jobIds.includes(t.id)).map((t) => ({ id: t.id, title: t.title, description: t.description, pay: t.pay })),
      jobStatus,
      sells: (n.p.sells ?? []).filter((id) => (n.inventory[id] ?? 0) > 0).map((id) => ({ id, name: ITEMS[id].name, price: ITEMS[id].price })),
      vehicles: (n.p.vehiclesForSale ?? []).filter((id) => g.vehById.get(id)?.forSale).map((id) => ({ id, name: VEHICLES_FOR_SALE[id].name, asking: VEHICLES_FOR_SALE[id].asking })),
      contacts: Object.entries(n.p.relationships).map(([id, r]) => ({ id, name: PERSONA_BY_ID[id]?.name ?? id, label: r.label })),
      activities: actx.activities.map((id) => ({ id, description: ACTIVITY_DESC[id] ?? id })),
      actions: availableActions(actx), locations: locs,
      carId: actx.carId,
    };
  }

  buildActionContext(n: NPC): ActionContext {
    const g = this.game, p = g.player;
    const car = n.p.car ? g.vehById.get(n.p.car.id) : null;
    const hasCar = !!car && car.owner === n.p.id && car.driver !== 'player' && !g.ride;
    const activities: string[] = [];
    if (n.p.canHeal && p.health < 95) activities.push('heal');
    if (n.p.id === 'nadia') activities.push('workout');
    if (n.p.id === 'theo' && g.jobs.some((j) => j.templateId === 'lena_gig' && j.status === 'active') && (n.relationship >= 15 || g.flags.limes_done)) activities.push('live_music_night');
    return {
      npcId: n.p.id, poiIds: g.city.pois.map((q) => q.id), npcIds: g.npcs.filter((o) => o.important).map((o) => o.p.id),
      npcInventory: n.inventory, npcRelationships: Object.keys(n.p.relationships), hasCar, carId: hasCar ? car!.id : null,
      sells: (n.p.sells ?? []).filter((id) => (n.inventory[id] ?? 0) > 0),
      vehiclesForSale: (n.p.vehiclesForSale ?? []).filter((id) => g.vehById.get(id)?.forSale),
      jobIds: this.availableJobs(n).map((t) => t.id),
      knownEventIds: g.events.filter((e) => n.seenEvents.has(e.id)).map((e) => e.id),
      activities, isFollowing: n.mode === 'following' || n.flags.prevMode === 'following', isCop: !!n.p.isCop, playerHeat: p.heat, playerMoney: p.money,
      relationship: n.relationship, priceFloor: (id) => this.priceFloor(n, id),
    };
  }

  priceFloor(n: NPC, id: string): number {
    const v = VEHICLES_FOR_SALE[id];
    if (v) {
      const friendly = clamp(n.relationship, 0, 60) / 400; // up to 15% off for friends
      const vouched = this.game.flags[`vouched_${n.p.id}`] ? 0.05 : 0;
      return Math.round(v.floor * (1 - friendly - vouched));
    }
    const it = ITEMS[id];
    if (!it) return Infinity;
    return n.relationship >= 30 ? Math.ceil(it.price * 0.75) : it.price;
  }

  availableJobs(n: NPC): JobTemplate[] {
    const g = this.game;
    return (n.p.jobs ?? []).filter((t) => {
      if (n.relationship < t.minRelationship) return false;
      if (g.jobs.some((j) => j.templateId === t.id && (j.status === 'active' || j.status === 'ready'))) return false;
      if (!t.repeatable && g.jobs.some((j) => j.templateId === t.id && j.status === 'done')) return false;
      if (t.kind === 'deliver_item' && t.item && (n.inventory[t.item] ?? 0) <= 0) return false;
      if (t.kind === 'deliver_vehicle' && t.vehicleId) { const v = g.vehById.get(t.vehicleId); if (!v || v.owner !== 'hank') return false; }
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  async send(text: string) {
    const g = this.game, n = this.npc;
    if (!n || n.busy) return;
    this.sessionTurns++;
    n.chat.push({ role: 'player', text, t: g.minutes });
    g.ui.addMessage('player', text, n.firstName);
    g.ui.setSuggestions([]);
    const ctx = this.buildContext(n);
    const actx = this.buildActionContext(n);
    const sys = systemPrompt(n), user = situationPrompt(n, ctx, text);
    let res: NPCResponse;
    let meta = '';
    n.busy = true;
    g.ui.setThinking(true);
    const sim = () => simulateResponse(n, ctx, text, { priceFloor: (id) => this.priceFloor(n, id), heat: g.player.heat });
    if (g.ai.provider) {
      const tier = g.ai.chooseTier(text, { important: n.important, relationship: n.relationship, turnCount: n.chat.length });
      const cacheable = !n.important && n.chat.length <= 1 && text.length < 24;
      try {
        const r = await g.ai.complete(n.p.id, tier, [{ role: 'system', content: sys }, { role: 'user', content: user }], cacheable);
        res = parseNPCResponse(r.text);
        meta = `Tier ${tier} · ${r.model.split('/').pop()} · ${r.promptTokens}+${r.completionTokens} tok · $${(r.costUSD ?? 0).toFixed(5)} · ${Math.round(r.ms)} ms${r.ms === 0 ? ' · cached' : ''}`;
      } catch (e) {
        const reason = (e as { deny?: string }).deny ?? ((e as Error).name === 'AbortError' ? 'timeout' : 'error');
        res = sim();
        g.ai.recordSimulated(n.p.id, estimateTokens(sys + user), estimateTokens(JSON.stringify(res)));
        meta = `simulated fallback (${reason})`;
        if (reason === 'budget') g.ui.toast('AI session budget reached — NPCs use simulated dialogue now. Raise it in Esc → AI.', 'info');
        console.warn('AI fallback', e);
      }
    } else {
      res = sim();
      await new Promise((r) => setTimeout(r, 250 + Math.random() * 350));
      g.ai.recordSimulated(n.p.id, estimateTokens(sys + user), estimateTokens(JSON.stringify(res)));
      meta = 'simulated';
    }
    n.busy = false;
    g.ui.setThinking(false);
    this.apply(n, res, actx, meta);
  }

  apply(n: NPC, res: NPCResponse, actx: ActionContext, meta: string) {
    const g = this.game;
    const stillTalking = this.npc === n;
    n.chat.push({ role: 'npc', text: res.say, t: g.minutes });
    if (n.chat.length > 30) n.chat.splice(0, n.chat.length - 30);
    if (stillTalking) { g.ui.addMessage('npc', res.say, n.firstName, meta); g.audio.msg(); }
    else n.say(res.say.slice(0, 80), g.minutes, 5);
    this.speakingUntil = g.t + Math.min(6, 1 + res.say.length / 25);
    if (res.mood) n.setMood(res.mood);
    let relDelta = res.relationship_delta ?? 0;
    if (res.player_name && res.player_name !== n.knowsPlayerAs) {
      n.knowsPlayerAs = res.player_name;
      if (!g.player.name) g.player.name = res.player_name;
    }
    if (res.memory && res.memory.length > 3) n.addMemory(res.memory, 'chat', 0.6, g.minutes, 'player');
    // validate + execute actions (LLM proposes, engine disposes)
    const seen = new Set<string>();
    for (const a of (res.actions ?? []).slice(0, 4)) {
      if (seen.has(a.name)) continue;
      seen.add(a.name);
      const v = validateAction(a, actx);
      if (!v.ok) { if (stillTalking) g.ui.addMessage('system', `<span style="opacity:.6">⚠ ${esc(a.name)} rejected by game rules: ${esc(v.reason)}</span>`, n.firstName); continue; }
      if (v.action.name === 'change_relationship' && v.action.args!.npc_id === 'player') { relDelta += v.action.args!.delta as number; continue; }
      this.execute(n, v.action);
    }
    n.changeRelationship(clamp(relDelta, -10, 10));
    if (stillTalking) { g.ui.updateDialogueHeader(this.info(n)); this.refreshControls(); }
  }

  execute(n: NPC, a: ProposedAction) {
    const g = this.game, p = g.player;
    const args = a.args ?? {};
    const sys = (html: string) => { if (this.npc === n) g.ui.addMessage('system', html, n.firstName); };
    switch (a.name) {
      case 'move_to': {
        const id = args.location_id as string;
        n.commandPoi = id; n.commandUntil = g.minutes + 90; n.flags.prevMode = 'routine';
        sys(`→ ${esc(n.firstName)} is heading to ${esc(g.poi(id)!.name)}.`);
        break;
      }
      case 'follow_player':
        n.flags.prevMode = 'following'; n.modeUntil = g.minutes + 180;
        sys(`→ ${esc(n.firstName)} is now hanging out with you.`);
        g.ui.toast(`${n.firstName} is following you. Ask them to head home anytime.`, 'ai');
        break;
      case 'stop_following':
        n.flags.prevMode = 'routine';
        if (n.mode === 'following') this.stopFollowing(n, false);
        sys(`→ ${esc(n.firstName)} heads back to their day.`);
        break;
      case 'enter_vehicle': break; // covered by drive_to
      case 'drive_to': {
        const dest = args.location_id as string;
        if (g.startRide(n, dest)) {
          n.flags.prevMode = 'to_vehicle';
          sys(`→ ${esc(n.firstName)} agreed to drive you to <b>${esc(g.poi(dest)!.name)}</b>. Follow them to their car.`);
          setTimeout(() => { if (this.npc === n) this.close(); }, 1600);
        }
        break;
      }
      case 'give_item': {
        const id = args.item_id as string;
        n.inventory[id]--; p.addItem(id);
        sys(`→ ${esc(n.firstName)} gave you <b>${esc(ITEMS[id].name)}</b>.`);
        g.audio.cash();
        n.addMemory(`Gave the player a ${ITEMS[id].name.toLowerCase()} as a gift.`, 'chat', 0.6, g.minutes, 'player');
        break;
      }
      case 'trade_item': this.offerTrade(n, args.item_id as string, args.price as number); break;
      case 'offer_job': this.offerJob(n, args.job_id as string); break;
      case 'start_activity': this.startActivity(n, args.activity_id as string); break;
      case 'call_contact': {
        const t = g.npcById.get(args.npc_id as string)!;
        const vouch = n.relationship >= 15;
        t.addMemory(`${n.firstName} called me about ${n.knowsPlayerAs ?? 'a visitor'}${vouch ? ' and vouched for them' : ''}${args.message ? `: "${args.message}"` : ''}.`, 'heard', 0.75, g.minutes, 'player');
        if (n.knowsPlayerAs && !t.knowsPlayerAs) { t.knowsPlayerAs = n.knowsPlayerAs; t.flags.nameFrom = n.firstName; }
        if (vouch) { t.changeRelationship(8); g.flags[`vouched_${t.p.id}`] = true; }
        sys(`📞 ${esc(n.firstName)} called ${esc(t.name)}${vouch ? ' and put in a good word for you' : ''}.`);
        g.ui.toast(`📞 ${n.firstName} called ${t.firstName} about you.`, 'ai');
        break;
      }
      case 'react_to_event': {
        const e = g.events.find((q) => q.id === args.event_id);
        if (e && e.actor === 'player' && e.severity >= 0.5) n.setMood('upset', -0.1);
        break;
      }
      case 'change_relationship': {
        const o = g.npcById.get(args.npc_id as string);
        if (o) n.npcRel[o.p.id] = clamp((n.npcRel[o.p.id] ?? 0) + (args.delta as number), -100, 100);
        break;
      }
      case 'issue_fine': {
        const amt = Math.min(p.money, args.amount as number);
        p.money -= amt; n.money += amt; p.heat = 0;
        g.addEvent('fine', p.x, p.z, `Officer Daniels fined someone $${amt}.`, n.p.id, undefined, 0.3);
        sys(`🚔 You paid a <b>$${amt}</b> fine. Heat cleared.`);
        g.audio.cash();
        break;
      }
    }
  }

  stopFollowing(n: NPC, timedOut: boolean) {
    const g = this.game;
    n.mode = 'routine'; n.travelTo = null; n.atPoi = null; n.hidden = false;
    n.addMemory(`Spent some time hanging out with ${n.knowsPlayerAs ?? 'the visitor'}.`, 'chat', 0.6, g.minutes, 'player');
    n.changeRelationship(4);
    n.say(timedOut ? 'I should get going — this was fun!' : 'Catch you later!', g.minutes, 4);
  }

  // ---- offers ------------------------------------------------------------------
  offerTrade(n: NPC, id: string, price: number) {
    const g = this.game, p = g.player;
    const isVeh = !!VEHICLES_FOR_SALE[id];
    const name = isVeh ? VEHICLES_FOR_SALE[id].name : ITEMS[id].name;
    const card: OfferCard = {
      id: 'trade_' + id, title: `${n.firstName} offers: ${name}`, detail: `Price: $${price.toLocaleString()} · You have $${p.money.toLocaleString()}`, accept: `Buy for $${price}`, decline: 'Not now',
      onAccept: () => {
        if (p.money < price) { g.ui.addMessage('system', `You can't afford that ($${price}).`, n.firstName); return; }
        p.money -= price; n.money += price;
        g.audio.cash();
        if (isVeh) {
          const v = g.vehById.get(id)!;
          v.forSale = null; v.owner = 'player'; p.ownedVehicles.push(id);
          g.addEvent('purchase', v.x, v.z, `Someone bought the ${name} from Bellini Motors for $${price}.`, 'player', undefined, 0.2);
          n.addMemory(`Sold the ${name} to ${n.knowsPlayerAs ?? 'the visitor'} for $${price}.`, 'event', 0.85, g.minutes, 'player');
          n.changeRelationship(6);
          g.ui.bigMessage('New wheels!', `The ${name} is yours. It's parked on the lot — press F to drive.`, 4000);
        } else {
          n.inventory[id]--; p.addItem(id);
          if (id === 'kiosk_lease') {
            g.business.owned = true; g.business.lastDay = Math.floor(g.minutes / 1440);
            g.flags.kiosk = true;
            g.addEvent('business', 155, 112, 'Someone new just leased the corner kiosk next to Sol Café!', 'player', undefined, 0.4);
            for (const id2 of ['rosa', 'priya', 'sofia']) g.npcById.get(id2)!.addMemory(`${p.name ?? 'The visitor'} leased the corner kiosk next to Sol Café and is starting a business.`, 'event', 0.85, g.minutes, 'player');
            g.ui.bigMessage('You own a business!', 'The corner kiosk earns income every day. Reputation boosts profits.', 4500);
          } else if (ITEMS[id].heal) {
            g.ui.toast(`Bought ${name}. Open the Journal (J) to use it.`, 'good');
          }
          n.addMemory(`Sold the player a ${name.toLowerCase()}.`, 'chat', 0.4, g.minutes, 'player');
        }
        g.ui.addMessage('system', `✔ Bought <b>${esc(name)}</b> for $${price}.`, n.firstName);
        void g.saveGame(false);
      },
    };
    if (this.npc === n) g.ui.addOffer(card);
  }

  offerJob(n: NPC, templateId: string) {
    const g = this.game;
    const t = n.p.jobs!.find((j) => j.id === templateId)!;
    const card: OfferCard = {
      id: 'job_' + t.id, title: `Job: ${t.title} — $${t.pay}`, detail: t.description, accept: 'Accept job', decline: 'Pass',
      onAccept: () => this.acceptJob(n, t),
      onDecline: () => { n.changeRelationship(-1); },
    };
    if (this.npc === n) g.ui.addOffer(card);
  }

  acceptJob(n: NPC, t: JobTemplate) {
    const g = this.game, p = g.player;
    const job: ActiveJob = { id: `job${++this.jobCounter}`, templateId: t.id, giver: n.p.id, title: t.title, description: t.description, kind: t.kind, item: t.item, pickupFrom: t.pickupFrom, deliverTo: t.deliverTo, destinationPoi: t.destinationPoi, vehicleId: t.vehicleId, pay: t.pay, status: 'active', stage: 0, acceptedAt: g.minutes };
    if (t.kind === 'deliver_item' && t.item) { n.inventory[t.item] = (n.inventory[t.item] ?? 1) - 1; p.addItem(t.item); }
    g.jobs.push(job);
    n.addMemory(`Hired ${n.knowsPlayerAs ?? 'the visitor'} for "${t.title}" ($${t.pay}).`, 'event', 0.8, g.minutes, 'player');
    g.ui.addMessage('system', `✔ Job accepted: <b>${esc(t.title)}</b>. ${esc(this.jobStepText(job))}`, n.firstName);
    g.ui.toast(`New job: ${t.title}`, 'good');
    g.audio.blip();
    this.refreshControls();
  }

  startActivity(n: NPC, id: string) {
    const g = this.game, p = g.player;
    const sys = (html: string) => { if (this.npc === n) g.ui.addMessage('system', html, n.firstName); };
    if (id === 'heal') { p.health = 100; n.addMemory('Patched up the player\'s injuries.', 'chat', 0.6, g.minutes, 'player'); sys('❤ Fully healed.'); }
    if (id === 'workout') { p.stamina = 100; n.changeRelationship(3); n.addMemory('Ran a training session with the player.', 'chat', 0.5, g.minutes, 'player'); sys('💪 Great workout. Stamina refilled.'); }
    if (id === 'live_music_night') {
      const job = g.jobs.find((j) => j.templateId === 'lena_gig' && j.status === 'active');
      if (!job) return;
      g.flags.lena_gig = true;
      this.applyStoryFlags();
      const lena = g.npcById.get('lena')!;
      lena.addMemory(`${p.name ?? 'My new friend'} convinced Theo to book me at The Low Tide! I play there every night now.`, 'event', 1, g.minutes, 'player');
      lena.setMood('ecstatic', 0.5);
      n.addMemory('Agreed to book Lena the busker for live music nights, because the player vouched for her.', 'event', 0.9, g.minutes, 'player');
      g.addEvent('gig', n.x, n.z, 'Theo booked Lena Fischer for live music nights at The Low Tide!', n.p.id, undefined, 0.3);
      this.completeJob(job, n);
    }
  }

  /** Re-apply persistent consequences of story flags to NPC schedules. */
  applyStoryFlags() {
    const g = this.game;
    if (g.flags.lena_gig) {
      const lena = g.npcById.get('lena')!;
      if (!lena.p.schedule.some((e) => e.poi === 'low_tide_bar')) {
        lena.p = { ...lena.p, schedule: [...lena.p.schedule.filter((e) => e.from < 19), { from: 19, activity: 'work', poi: 'low_tide_bar' }, { from: 23.5, activity: 'sleep', poi: 'seabreeze_apts' }], knowledge: [...lena.p.knowledge, 'She now plays live music at The Low Tide every night from 7pm'] };
      }
    }
  }

  // ---- jobs ----------------------------------------------------------------------
  completeJob(job: ActiveJob, recipient: NPC | null) {
    const g = this.game, p = g.player;
    job.status = 'done';
    const giver = g.npcById.get(job.giver)!;
    p.money += job.pay;
    giver.money = Math.max(0, giver.money - job.pay);
    p.reputation += 1;
    giver.changeRelationship(9);
    giver.setMood('happy', 0.2);
    giver.addMemory(`${p.name ?? 'The visitor'} finished the "${job.title}" job for me. Reliable — I'd hire them again.`, 'event', 0.9, g.minutes, 'player');
    if (recipient && recipient !== giver) { recipient.changeRelationship(4); recipient.addMemory(`${p.name ?? 'Someone'} delivered something to me on behalf of ${giver.firstName}.`, 'event', 0.7, g.minutes, 'player'); }
    if (job.templateId === 'theo_limes') g.flags.limes_done = true;
    g.addEvent('job_done', p.x, p.z, `${p.name ?? 'A newcomer'} completed a job for ${giver.name}.`, 'player', undefined, 0.2);
    g.audio.cash();
    g.ui.bigMessage(`+$${job.pay}`, `Job complete: ${job.title}. ${giver.firstName} will remember this.`, 3200);
    if (this.npc) g.ui.addMessage('system', `💰 Job complete — <b>+$${job.pay}</b>. ${esc(giver.firstName)}'s opinion of you improved.`, this.npc.firstName);
    void g.saveGame(false);
  }

  handOver(n: NPC, job: ActiveJob) {
    const g = this.game, p = g.player;
    if (!job.item || !p.removeItem(job.item)) return;
    n.inventory[job.item] = (n.inventory[job.item] ?? 0) + 1;
    g.ui.addMessage('player', `*hands over the ${ITEMS[job.item].name.toLowerCase()}*`, n.firstName);
    this.completeJob(job, n);
    void this.react(n, `(The player just handed you the ${ITEMS[job.item].name.toLowerCase()} from ${g.npcById.get(job.giver)!.firstName}. Thank them in character.)`, `Oh, perfect — this is from ${g.npcById.get(job.giver)!.firstName}? Thank you!`);
    this.refreshControls();
  }

  pickUp(n: NPC, job: ActiveJob) {
    const g = this.game, p = g.player;
    if (job.item) { n.inventory[job.item] = Math.max(0, (n.inventory[job.item] ?? 1) - 1); p.addItem(job.item); }
    job.stage = 1;
    const giver = g.npcById.get(job.giver)!;
    n.addMemory(`Handed ${ITEMS[job.item!].name.toLowerCase()} to the player for ${giver.firstName}.`, 'chat', 0.6, g.minutes, 'player');
    g.ui.addMessage('system', `✔ Picked up <b>${esc(ITEMS[job.item!].name)}</b>. ${esc(this.jobStepText(job))}`, n.firstName);
    void this.react(n, `(The player came to pick up ${ITEMS[job.item!].name.toLowerCase()} for ${giver.firstName}. Hand it over in character.)`, `Here you go — tell ${giver.firstName} I said hi.`);
    this.refreshControls();
  }

  gift(n: NPC, id: string) {
    const g = this.game, p = g.player;
    if (!p.removeItem(id)) return;
    n.inventory[id] = (n.inventory[id] ?? 0) + 1;
    const loved = (id === 'coffee' && n.p.id === 'ray') || (id === 'taco' && n.p.id === 'tyler') || (id === 'lucky_coin' && n.p.id === 'lena') || (id === 'flowers');
    n.changeRelationship(loved ? 10 : 5);
    n.setMood('happy', 0.2);
    n.addMemory(`${p.name ?? 'The visitor'} gave me a ${ITEMS[id].name.toLowerCase()} as a gift${loved ? ' — exactly what I wanted' : ''}.`, 'event', 0.75, g.minutes, 'player');
    g.ui.addMessage('player', `*gives ${n.firstName} a ${ITEMS[id].name.toLowerCase()}*`, n.firstName);
    void this.react(n, `(The player just gave you a ${ITEMS[id].name.toLowerCase()} as a gift. React in character.)`, loved ? 'Oh! You remembered? This is exactly what I needed. Thank you!' : 'Aw, for me? That\'s really sweet. Thanks!');
    this.refreshControls();
  }

  /** NPC reaction to a deterministic event: one cheap Tier-1 call when live, scripted line otherwise. */
  async react(n: NPC, prompt: string, fallback: string) {
    const g = this.game;
    if (g.ai.provider && !n.busy) {
      try {
        n.busy = true; g.ui.setThinking(true);
        const ctx = this.buildContext(n);
        const r = await g.ai.complete(n.p.id, 1, [{ role: 'system', content: systemPrompt(n) }, { role: 'user', content: situationPrompt(n, ctx, prompt) }], false);
        const res = parseNPCResponse(r.text);
        n.busy = false; g.ui.setThinking(false);
        res.actions = (res.actions ?? []).filter((a) => a.name !== 'trade_item' && a.name !== 'offer_job');
        this.apply(n, res, this.buildActionContext(n), `Tier 1 · ${r.promptTokens}+${r.completionTokens} tok · $${(r.costUSD ?? 0).toFixed(5)}`);
        return;
      } catch { n.busy = false; g.ui.setThinking(false); }
    }
    this.apply(n, { say: fallback, relationship_delta: 0, actions: [] }, this.buildActionContext(n), g.ai.provider ? 'simulated fallback' : 'simulated');
  }

  checkVehicleJobs() {
    const g = this.game;
    for (const j of g.jobs) {
      if (j.status !== 'active' || j.kind !== 'deliver_vehicle') continue;
      const v = g.vehById.get(j.vehicleId!)!;
      const poi = g.poi(j.destinationPoi!)!;
      if (Math.hypot(v.x - poi.door[0], v.z - poi.door[1]) < 16 && Math.abs(v.speed) < 0.6) {
        v.owner = 'parked';
        if (g.player.vehicleId === v.id) g.exitVehicle();
        this.completeJob(j, null);
      }
    }
  }

  // ---- controls ------------------------------------------------------------------
  refreshControls() {
    const g = this.game, n = this.npc;
    if (!n) return;
    const p = g.player;
    const qa: QuickAction[] = [];
    for (const j of g.jobs) {
      if (j.status !== 'active') continue;
      if (j.deliverTo === n.p.id && j.item && p.inventory[j.item] && (j.kind === 'deliver_item' || j.stage === 1)) qa.push({ label: `Hand over ${ITEMS[j.item].name}`, primary: true, run: () => this.handOver(n, j) });
      if (j.kind === 'fetch_item' && j.pickupFrom === n.p.id && j.stage === 0) qa.push({ label: `Pick up ${ITEMS[j.item!].name} for ${g.npcById.get(j.giver)!.firstName}`, primary: true, run: () => this.pickUp(n, j) });
    }
    const giftables = Object.keys(p.inventory).filter((id) => ITEMS[id]?.giftable && p.inventory[id] > 0 && !g.jobs.some((j) => j.status === 'active' && j.item === id)).slice(0, 2);
    for (const id of giftables) qa.push({ label: `Give ${ITEMS[id].name}`, run: () => this.gift(n, id) });
    g.ui.setQuickActions(qa);
    const s: string[] = [];
    const met = n.chat.length > 1;
    if (!n.knowsPlayerAs) s.push("Hi! I'm new in town.");
    if (!met) s.push('What do you do around here?');
    if (this.availableJobs(n).length) s.push('Got any work for me?');
    else if (!met) s.push('Know anyone who needs help?');
    if (n.p.car && !g.ride) s.push('Can you give me a ride to the beach?');
    if ((n.p.vehiclesForSale ?? []).some((id) => g.vehById.get(id)?.forSale)) s.push("I'm looking to buy a car.");
    if ((n.p.sells ?? []).length) s.push(`What are you selling?`);
    if (n.p.canHeal && p.health < 95) s.push('I got hurt — can you help?');
    if (n.p.id === 'theo' && g.jobs.some((j) => j.templateId === 'lena_gig' && j.status === 'active')) s.push('Would you book Lena for a gig?');
    if (n.p.id === 'priya' && !g.business.owned) s.push('Tell me about the corner kiosk.');
    if (n.mode === 'following' || n.flags.prevMode === 'following') s.push('You can head home, thanks!');
    else if (met) s.push('Want to hang out?');
    s.push("What's new around town?");
    g.ui.setSuggestions(s.slice(0, 4));
  }

  // ---- objective / HUD -------------------------------------------------------
  jobStepText(j: ActiveJob): string {
    const g = this.game;
    const nm = (id?: string) => (id ? g.npcById.get(id)?.name ?? id : '');
    const where = (id?: string) => { const n = id ? g.npcById.get(id) : null; return n ? g.poi(n.p.work)?.name ?? 'around town' : ''; };
    switch (j.kind) {
      case 'deliver_item': return `Deliver the ${ITEMS[j.item!].name.toLowerCase()} to ${nm(j.deliverTo)} (usually around ${where(j.deliverTo)}).`;
      case 'fetch_item': return j.stage === 0 ? `Pick up the ${ITEMS[j.item!].name.toLowerCase()} from ${nm(j.pickupFrom)} at ${where(j.pickupFrom)}.` : `Bring the ${ITEMS[j.item!].name.toLowerCase()} to ${nm(j.deliverTo)} at ${where(j.deliverTo)}.`;
      case 'deliver_vehicle': return `Drive the ${g.vehById.get(j.vehicleId!)?.name ?? 'vehicle'} from Ellis Auto to ${g.poi(j.destinationPoi!)?.name} and stop there.`;
      case 'persuade': return `Convince ${nm(j.deliverTo)} at ${where(j.deliverTo)} to book Lena. (He's opened from 1pm.)`;
    }
  }

  /** World-space target for the current objective (minimap marker). */
  objectiveTarget(): [number, number] | null {
    const g = this.game;
    if (g.ride) { const v = g.vehById.get(g.ride.vehId)!; return g.ride.phase === 'drive' ? g.poi(g.ride.dest)!.door : [v.x, v.z]; }
    const j = g.jobs.find((q) => q.status === 'active');
    if (!j) return null;
    const npcPos = (id?: string): [number, number] | null => { const n = id ? g.npcById.get(id) : null; if (!n) return null; if (n.hidden && n.atPoi) return g.poi(n.atPoi)!.door; return [n.x, n.z]; };
    if (j.kind === 'deliver_vehicle') { const v = g.vehById.get(j.vehicleId!)!; return g.player.vehicleId === v.id ? g.poi(j.destinationPoi!)!.door : [v.x, v.z]; }
    if (j.kind === 'fetch_item' && j.stage === 0) return npcPos(j.pickupFrom);
    return npcPos(j.deliverTo);
  }

  objectiveHTML(): string {
    const g = this.game;
    if (g.ride) {
      const n = g.npcById.get(g.ride.npcId)!;
      const dest = g.poi(g.ride.dest)!.name;
      return g.ride.phase === 'walk' ? `<b>Ride</b> · ${esc(n.firstName)} is walking to their car.` : g.ride.phase === 'wait' ? `<b>Ride</b> · Get in ${esc(n.firstName)}'s car (<kbd>E</kbd>) → ${esc(dest)}` : `<b>Ride</b> · ${esc(n.firstName)} is driving you to ${esc(dest)}`;
    }
    const j = g.jobs.find((q) => q.status === 'active');
    if (j) return `<b>${esc(j.title)}</b> · $${j.pay}<br>${esc(this.jobStepText(j))}`;
    const f = g.npcs.find((n) => n.mode === 'following');
    if (f) return `<b>Hanging out</b> with ${esc(f.firstName)}`;
    if (!g.jobs.length && g.player.money < 400) return `<b>Explore</b> · Walk up to anyone and press <kbd>E</kbd> to talk. Rosa at Sol Café might have work.`;
    return '';
  }

  serialize() { return { jobCounter: this.jobCounter }; }
  load(s?: { jobCounter: number }) { this.jobCounter = s?.jobCounter ?? this.game.jobs.length; this.applyStoryFlags(); }
}
