import { test } from 'node:test';
import assert from 'node:assert/strict';
import { City, CITY } from '../src/world/city';
import { PERSONAS } from '../src/npc/personas';
import { NPC } from '../src/npc/npc';
import { routeBFS, curbApproach } from '../src/game/vehicle';
import { systemPrompt } from '../src/ai/prompt';

const city = new City();
city.build();

test('every schedule location referenced by a persona exists', () => {
  const ids = new Set(city.pois.map((p) => p.id));
  for (const p of PERSONAS) for (const e of p.schedule) assert.ok(ids.has(e.poi), `${p.id} → ${e.poi}`);
  assert.ok(PERSONAS.length >= 15);
});

test('pedestrian nav graph connects every POI', () => {
  const from = city.getPOI('sol_cafe')!;
  for (const p of city.pois) {
    const path = city.path(from.door[0], from.door[1], (p as unknown as { doorNode: number }).doorNode);
    const end = path[path.length - 1];
    assert.ok(Math.hypot(end[0] - p.door[0], end[1] - p.door[1]) < 0.01, `no path to ${p.id}`);
  }
});

test('road routing and curb approach reach the beach side', () => {
  const r = routeBFS([0, 0], [4, 4]);
  assert.equal(r.length, 9);
  const beach = city.getPOI('beach')!;
  const a = curbApproach(beach.door[0], beach.door[1]);
  assert.ok(a.px > CITY - 10, 'stops on the beach-side curb');
});

test('ground heights: road vs sidewalk vs beach', () => {
  assert.equal(city.groundHeight(7, 7), 0);
  assert.equal(city.groundHeight(40, 40), 0.15);
  assert.ok(city.groundHeight(CITY + 10, 50) > 0);
});

test('NPC schedule state transitions follow the clock', () => {
  const rosa = new NPC(PERSONAS[0], true, 0, 0);
  assert.equal(rosa.currentEntry(3 * 60).activity, 'sleep');
  assert.equal(rosa.currentEntry(9 * 60).activity, 'work');
  assert.equal(rosa.currentEntry(20 * 60).activity, 'socialize');
});

test('memory compression keeps important memories and bounds the summary', () => {
  const n = new NPC(PERSONAS[0], true, 0, 0);
  n.addMemory('The player saved my café from a fire.', 'event', 1, 0, 'player');
  for (let i = 1; i < 200; i++) n.addMemory(`Small talk #${i}.`, 'chat', 0.3, i, 'player');
  assert.ok(n.memories.length <= 24);
  assert.ok(n.memories.some((m) => m.text.includes('fire')), 'important memory survives');
  assert.ok(n.summary.length <= 601);
});

test('system prompt is stable across turns (prefix-cache friendly)', () => {
  const n = new NPC(PERSONAS[0], true, 0, 0);
  const a = systemPrompt(n);
  n.addMemory('something happened', 'chat', 0.5, 10);
  n.relationship = 40;
  assert.equal(systemPrompt(n), a);
});
