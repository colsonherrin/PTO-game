import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractName, extractPrice, findLocation, simulateResponse } from '../src/ai/simulated';
import { NPC } from '../src/npc/npc';
import { PERSONA_BY_ID } from '../src/npc/personas';
import { availableActions } from '../src/ai/actions';
import type { TalkContext } from '../src/ai/prompt';

const baseCtx = (n: NPC, over: Partial<TalkContext> = {}): TalkContext => ({
  timeStr: 'Mon 9:00', dayPart: 'morning', locationName: 'Central Plaza', npcStatus: 'Relaxing', nearby: [], playerName: null,
  playerObservations: [], knownEvents: [], jobs: [], jobStatus: [], sells: [], vehicles: [], contacts: [], activities: [],
  actions: availableActions({ npcId: n.p.id, poiIds: ['beach'], npcIds: [], npcInventory: {}, npcRelationships: [], hasCar: !!over.carId, carId: over.carId ?? null, sells: [], vehiclesForSale: [], jobIds: [], knownEventIds: [], activities: [], isFollowing: false, isCop: false, playerHeat: 0, playerMoney: 100, relationship: 0, priceFloor: () => 0 }),
  locations: [{ id: 'beach', name: 'Palmetto Beach' }, { id: 'central_plaza', name: 'Central Plaza' }], carId: null, ...over,
});
const X = { priceFloor: () => 1000, heat: 0 };

test('extracts names, prices and locations from free text', () => {
  assert.equal(extractName("Hi, I'm Colson"), 'Colson');
  assert.equal(extractName('my name is alex'), 'Alex');
  assert.equal(extractName("I'm new here"), null);
  assert.equal(extractPrice('I can do $1,200'), 1200);
  assert.equal(extractPrice('900 bucks?'), 900);
  assert.equal(findLocation('take me to the beach please', ['beach']), 'beach');
});

test('NPC with a car agrees to a ride and emits a real drive_to action', () => {
  const dev = new NPC(PERSONA_BY_ID.dev, true, 0, 0);
  dev.activity = 'relax';
  const r = simulateResponse(dev, baseCtx(dev, { carId: 'car_dev' }), 'Can you give me a ride to the beach?', X);
  assert.ok(r.actions!.some((a) => a.name === 'drive_to' && a.args!.destination === 'beach'));
});

test('NPC without a car declines rides (no hallucinated action)', () => {
  const lena = new NPC(PERSONA_BY_ID.lena, true, 0, 0);
  const r = simulateResponse(lena, baseCtx(lena), 'Can you give me a ride to the beach?', X);
  assert.equal(r.actions!.length, 0);
});

test('insults damage the relationship', () => {
  const rosa = new NPC(PERSONA_BY_ID.rosa, true, 0, 0);
  const r = simulateResponse(rosa, baseCtx(rosa), 'shut up, you idiot', X);
  assert.ok((r.relationship_delta ?? 0) < 0);
});
