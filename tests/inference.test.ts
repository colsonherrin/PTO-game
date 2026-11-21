import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InferenceRouter, type Provider, type ChatRequest } from '../src/ai/inference';

class Mock implements Provider {
  id = 'mock'; label = 'mock'; calls = 0; fail = false;
  async chat(req: ChatRequest) {
    this.calls++;
    if (this.fail) throw new Error('boom');
    return { text: '{"say":"hi"}', promptTokens: 1000, completionTokens: 100, costUSD: null, model: req.model, ms: 5 };
  }
}
const msgs = [{ role: 'user' as const, content: 'hello' }];

test('computes cost from configured prices when provider gives none', async () => {
  const r = new InferenceRouter(); const m = new Mock(); r.provider = m;
  const res = await r.complete('rosa', 1, msgs, false);
  const p = r.config.prices[r.config.tier1Model];
  assert.equal(res.costUSD, (1000 * p.input + 100 * p.output) / 1e6);
  assert.equal(r.costs.requests, 1);
  assert.ok(r.avgCostPerInteraction() < 0.001, 'tier-1 interaction under $0.001');
});

test('response cache avoids repeat spend', async () => {
  const r = new InferenceRouter(); const m = new Mock(); r.provider = m;
  await r.complete('ped_1', 1, msgs, true);
  await r.complete('ped_1', 1, msgs, true);
  assert.equal(m.calls, 1);
  assert.equal(r.costs.cacheHits, 1);
});

test('budget, rate limit and no-provider denials', async () => {
  const r = new InferenceRouter({ sessionBudgetUSD: 0 });
  assert.equal(r.canRequest('x'), 'no_provider');
  r.provider = new Mock();
  assert.equal(r.canRequest('x'), 'budget');
  const r2 = new InferenceRouter({ maxRequestsPerMinute: 2 }); r2.provider = new Mock();
  await r2.complete('a', 1, msgs, false); await r2.complete('b', 1, msgs, false);
  assert.equal(r2.canRequest('c'), 'rate');
  await assert.rejects(r2.complete('c', 1, msgs, false));
});

test('failures are counted and surfaced for fallback', async () => {
  const r = new InferenceRouter(); const m = new Mock(); m.fail = true; r.provider = m;
  await assert.rejects(r.complete('rosa', 1, msgs, false));
  assert.equal(r.costs.failures, 1);
});

test('tier routing escalates only for complex exchanges', () => {
  const r = new InferenceRouter();
  assert.equal(r.chooseTier('hey!', { important: true, relationship: 0, turnCount: 1 }), 1);
  assert.equal(r.chooseTier("Let's negotiate the price of the car", { important: true, relationship: 0, turnCount: 2 }), 2);
  assert.equal(r.chooseTier("Let's negotiate", { important: false, relationship: 0, turnCount: 2 }), 1);
});
