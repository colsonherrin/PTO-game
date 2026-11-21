import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAction, parseNPCResponse, availableActions, type ActionContext } from '../src/ai/actions';

const ctx = (o: Partial<ActionContext> = {}): ActionContext => ({
  npcId: 'marco', poiIds: ['beach', 'sol_cafe', 'bellini_motors'], npcIds: ['rosa', 'hank', 'marco'],
  npcInventory: { coffee: 3, lucky_coin: 1 }, npcRelationships: ['hank', 'rosa'], hasCar: true, carId: 'car_dev',
  sells: ['coffee'], vehiclesForSale: ['sunburst_hatch'], jobIds: ['rosa_pastries'], knownEventIds: ['ev1'],
  activities: ['heal'], isFollowing: false, isCop: false, playerHeat: 0, playerMoney: 300, relationship: 0,
  priceFloor: (id) => (id === 'sunburst_hatch' ? 1050 : 4), ...o,
});

test('accepts valid actions and normalizes args', () => {
  const v = validateAction({ name: 'drive_to', args: { destination: 'beach' } }, ctx());
  assert.deepEqual(v, { ok: true, action: { name: 'drive_to', args: { location_id: 'beach' } } });
  assert.equal(validateAction({ name: 'trade_item', args: { item_id: 'sunburst_hatch', price: '$1,200' } }, ctx()).ok, true);
  assert.equal(validateAction({ name: 'follow_player' }, ctx()).ok, true);
});

test('rejects invented locations, items, jobs and contacts', () => {
  assert.equal(validateAction({ name: 'move_to', args: { location_id: 'moon_base' } }, ctx()).ok, false);
  assert.equal(validateAction({ name: 'give_item', args: { item_id: 'gold_bar' } }, ctx()).ok, false);
  assert.equal(validateAction({ name: 'give_item', args: { item_id: 'painting' } }, ctx()).ok, false, 'NPC does not own it');
  assert.equal(validateAction({ name: 'offer_job', args: { job_id: 'heist' } }, ctx()).ok, false);
  assert.equal(validateAction({ name: 'call_contact', args: { npc_id: 'president' } }, ctx()).ok, false);
  assert.equal(validateAction({ name: 'fly', args: {} }, ctx()).ok, false);
});

test('enforces economics: price floors and ownership', () => {
  const low = validateAction({ name: 'trade_item', args: { item_id: 'sunburst_hatch', price: 500 } }, ctx());
  assert.equal(low.ok, false);
  assert.equal(validateAction({ name: 'trade_item', args: { item_id: 'coastline_pickup', price: 3000 } }, ctx()).ok, false, 'not this NPC\'s vehicle');
  assert.equal(validateAction({ name: 'trade_item', args: { item_id: 'coffee', price: -4 } }, ctx()).ok, false);
});

test('capability gating: no car → no rides; non-cop cannot fine', () => {
  assert.equal(validateAction({ name: 'drive_to', args: { destination: 'beach' } }, ctx({ hasCar: false, carId: null })).ok, false);
  assert.equal(validateAction({ name: 'issue_fine', args: { amount: 100 } }, ctx()).ok, false);
  const cop = validateAction({ name: 'issue_fine', args: { amount: 999 } }, ctx({ isCop: true, playerHeat: 2, playerMoney: 80 }));
  assert.equal(cop.ok && cop.action.args!.amount, 80, 'fine capped by player money');
  assert.ok(!availableActions(ctx({ hasCar: false })).some((a) => a.name === 'drive_to'));
});

test('relationship deltas are clamped', () => {
  const v = validateAction({ name: 'change_relationship', args: { npc_id: 'player', delta: 99 } }, ctx());
  assert.equal(v.ok && v.action.args!.delta, 10);
});

test('parses model output robustly', () => {
  const r = parseNPCResponse('```json\n{"say":"Hop in!","mood":"Happy","relationship_delta":15,"actions":[{"name":"drive_to","args":{"destination":"beach"}}]}\n```');
  assert.equal(r.say, 'Hop in!');
  assert.equal(r.mood, 'happy');
  assert.equal(r.relationship_delta, 10);
  assert.equal(r.actions![0].name, 'drive_to');
  assert.equal(parseNPCResponse('Just plain words.').say, 'Just plain words.');
  assert.equal(parseNPCResponse('{"say": broken json').actions!.length, 0);
});
