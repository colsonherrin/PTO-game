// LLMs PROPOSE actions; this module VALIDATES them against authoritative game state.
// Execution happens in the game layer (ActionExecutor) only after validation passes.
import { ITEMS, VEHICLES_FOR_SALE } from '../game/state';

export interface ProposedAction { name: string; args?: Record<string, unknown> }

export interface ActionContext {
  npcId: string;
  poiIds: string[];
  npcIds: string[];
  npcInventory: Record<string, number>;
  npcRelationships: string[]; // contacts the NPC knows
  hasCar: boolean;
  carId: string | null;
  sells: string[];
  vehiclesForSale: string[];
  jobIds: string[]; // jobs this NPC can offer right now
  knownEventIds: string[];
  activities: string[]; // activities this NPC can start right now
  isFollowing: boolean;
  isCop: boolean;
  playerHeat: number;
  playerMoney: number;
  relationship: number;
  priceFloor: (itemId: string) => number;
}

export interface ActionSpec { name: string; signature: string; description: string; available: (c: ActionContext) => boolean }

export const ACTION_SPECS: ActionSpec[] = [
  { name: 'move_to', signature: 'move_to(location_id)', description: 'Walk to a real location in town.', available: () => true },
  { name: 'follow_player', signature: 'follow_player()', description: 'Walk along with the player (hang out, show them around).', available: (c) => !c.isFollowing },
  { name: 'stop_following', signature: 'stop_following()', description: 'Stop following the player and return to your routine.', available: (c) => c.isFollowing },
  { name: 'enter_vehicle', signature: 'enter_vehicle(vehicle_id)', description: 'Walk to your own car and get in.', available: (c) => c.hasCar },
  { name: 'drive_to', signature: 'drive_to(destination)', description: 'Give the player a ride in your car to a location (they hop in the passenger seat).', available: (c) => c.hasCar },
  { name: 'give_item', signature: 'give_item(item_id)', description: 'Give the player an item you own, for free.', available: (c) => Object.keys(c.npcInventory).some((k) => (c.npcInventory[k] ?? 0) > 0 && ITEMS[k]?.giftable) },
  { name: 'trade_item', signature: 'trade_item(item_id, price)', description: 'Offer to sell the player an item or vehicle you own at a price in dollars. The player confirms.', available: (c) => c.sells.length > 0 || c.vehiclesForSale.length > 0 },
  { name: 'offer_job', signature: 'offer_job(job_id)', description: 'Offer the player one of your available paid jobs.', available: (c) => c.jobIds.length > 0 },
  { name: 'start_activity', signature: 'start_activity(activity_id)', description: 'Start an activity with the player.', available: (c) => c.activities.length > 0 },
  { name: 'call_contact', signature: 'call_contact(npc_id)', description: 'Phone someone you know to vouch for the player or pass along a message.', available: (c) => c.npcRelationships.length > 0 },
  { name: 'react_to_event', signature: 'react_to_event(event_id)', description: 'React to an event you witnessed or heard about.', available: (c) => c.knownEventIds.length > 0 },
  { name: 'change_relationship', signature: 'change_relationship(npc_id, delta)', description: 'Adjust how you feel about someone (delta -10..10). Use "player" for the player.', available: () => true },
  { name: 'issue_fine', signature: 'issue_fine(amount)', description: 'Police only: fine the player for crimes you know about ($20-$200).', available: (c) => c.isCop && c.playerHeat > 0 },
];

export function availableActions(c: ActionContext): ActionSpec[] {
  return ACTION_SPECS.filter((s) => s.available(c));
}

export type Validation = { ok: true; action: ProposedAction } | { ok: false; reason: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(/[$,]/g, '')) : NaN);

/** Validate a single proposed action. Never trusts the model: unknown ids, invented items, or money are rejected. */
export function validateAction(a: ProposedAction, c: ActionContext): Validation {
  if (!a || typeof a.name !== 'string') return { ok: false, reason: 'malformed action' };
  const spec = ACTION_SPECS.find((s) => s.name === a.name);
  if (!spec) return { ok: false, reason: `unknown action ${a.name}` };
  if (!spec.available(c)) return { ok: false, reason: `${a.name} not available to this NPC now` };
  const args = (a.args ?? {}) as Record<string, unknown>;
  const first = (...keys: string[]) => { for (const k of keys) if (args[k] !== undefined) return args[k]; return Object.values(args)[0]; };
  switch (a.name) {
    case 'move_to': case 'drive_to': {
      const loc = str(first('location_id', 'destination', 'location'));
      if (!c.poiIds.includes(loc)) return { ok: false, reason: `unknown location "${loc}"` };
      return { ok: true, action: { name: a.name, args: { location_id: loc } } };
    }
    case 'follow_player': case 'stop_following': return { ok: true, action: { name: a.name, args: {} } };
    case 'enter_vehicle': {
      const v = str(first('vehicle_id')) || c.carId!;
      if (v !== c.carId) return { ok: false, reason: 'NPC can only enter their own vehicle' };
      return { ok: true, action: { name: a.name, args: { vehicle_id: v } } };
    }
    case 'give_item': {
      const item = str(first('item_id', 'item'));
      if (!ITEMS[item]) return { ok: false, reason: `item "${item}" does not exist` };
      if ((c.npcInventory[item] ?? 0) <= 0) return { ok: false, reason: `NPC does not own ${item}` };
      if (!ITEMS[item].giftable) return { ok: false, reason: `${item} cannot be given away` };
      return { ok: true, action: { name: a.name, args: { item_id: item } } };
    }
    case 'trade_item': {
      const item = str(first('item_id', 'item'));
      const price = Math.round(num(args.price ?? Object.values(args)[1]));
      const isVehicle = !!VEHICLES_FOR_SALE[item];
      if (!ITEMS[item] && !isVehicle) return { ok: false, reason: `item "${item}" does not exist` };
      if (isVehicle ? !c.vehiclesForSale.includes(item) : !c.sells.includes(item) || (c.npcInventory[item] ?? 0) <= 0) return { ok: false, reason: `NPC does not sell ${item}` };
      if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: 'invalid price' };
      const floor = c.priceFloor(item);
      if (price < floor) return { ok: false, reason: `price $${price} below NPC floor` };
      return { ok: true, action: { name: a.name, args: { item_id: item, price } } };
    }
    case 'offer_job': {
      const id = str(first('job_id', 'job'));
      if (!c.jobIds.includes(id)) return { ok: false, reason: `job "${id}" not available` };
      return { ok: true, action: { name: a.name, args: { job_id: id } } };
    }
    case 'start_activity': {
      const id = str(first('activity_id', 'activity'));
      if (!c.activities.includes(id)) return { ok: false, reason: `activity "${id}" not available` };
      return { ok: true, action: { name: a.name, args: { activity_id: id } } };
    }
    case 'call_contact': {
      const id = str(first('npc_id', 'contact'));
      if (!c.npcRelationships.includes(id) || !c.npcIds.includes(id)) return { ok: false, reason: `NPC does not know "${id}"` };
      return { ok: true, action: { name: a.name, args: { npc_id: id, message: str(args.message).slice(0, 160) } } };
    }
    case 'react_to_event': {
      const id = str(first('event_id'));
      if (!c.knownEventIds.includes(id)) return { ok: false, reason: 'NPC does not know about that event' };
      return { ok: true, action: { name: a.name, args: { event_id: id } } };
    }
    case 'change_relationship': {
      const id = str(args.npc_id ?? 'player') || 'player';
      const delta = Math.max(-10, Math.min(10, Math.round(num(args.delta))));
      if (!Number.isFinite(delta)) return { ok: false, reason: 'invalid delta' };
      if (id !== 'player' && !c.npcIds.includes(id)) return { ok: false, reason: `unknown npc ${id}` };
      return { ok: true, action: { name: a.name, args: { npc_id: id, delta } } };
    }
    case 'issue_fine': {
      const amount = Math.max(20, Math.min(200, Math.round(num(first('amount')))));
      if (!Number.isFinite(amount)) return { ok: false, reason: 'invalid amount' };
      return { ok: true, action: { name: a.name, args: { amount: Math.min(amount, c.playerMoney) } } };
    }
  }
  return { ok: false, reason: 'unhandled' };
}

export interface NPCResponse {
  say: string;
  mood?: string;
  relationship_delta?: number;
  player_name?: string | null;
  memory?: string;
  actions?: ProposedAction[];
}

/** Robustly parse a model reply into an NPCResponse (handles code fences, trailing text, plain text). */
export function parseNPCResponse(raw: string): NPCResponse {
  let t = (raw ?? '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try {
      const j = JSON.parse(t.slice(s, e + 1));
      const actions = Array.isArray(j.actions) ? j.actions.filter((x: unknown) => x && typeof x === 'object').map((x: { name?: string; action?: string; args?: Record<string, unknown> }) => ({ name: x.name ?? x.action ?? '', args: x.args ?? {} })) : [];
      return {
        say: String(j.say ?? j.reply ?? j.text ?? '').slice(0, 600) || '...',
        mood: typeof j.mood === 'string' ? j.mood.toLowerCase() : undefined,
        relationship_delta: Number.isFinite(+j.relationship_delta) ? Math.max(-10, Math.min(10, Math.round(+j.relationship_delta))) : 0,
        player_name: typeof j.player_name === 'string' && j.player_name.length < 30 ? j.player_name : null,
        memory: typeof j.memory === 'string' ? j.memory.slice(0, 200) : undefined,
        actions,
      };
    } catch { /* fall through */ }
  }
  return { say: t.slice(0, 600) || '...', actions: [] };
}
