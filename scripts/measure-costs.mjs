// Measures real prompt/response sizes produced by the game for a scripted play session and
// reports per-interaction cost. With OPENROUTER_API_KEY set it uses live inference and reports
// OpenRouter's billed cost; otherwise it projects cost from measured token counts × model prices.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = 5198;
const live = !!process.env.OPENROUTER_API_KEY;
const server = spawn('node', ['server/server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => indexedDB.deleteDatabase('pto-save'));
await page.reload();
await page.waitForFunction(() => window.pto && document.getElementById('loading').style.display === 'none', null, { timeout: 30000 });
await page.evaluate(() => { localStorage.setItem('pto:provider', JSON.stringify('auto')); });
await page.evaluate(() => document.getElementById('btn-new').click());

const script = [
  ['rosa', ["Hi! I'm Colson, just got into town.", 'What do you do around here?', 'Got any work for me?', "What's new around town?"]],
  ['dev', ['Hey, are you Dev?', 'Can you give me a ride to the beach?']],
  ['marco', ["I'm looking to buy a car.", "I'll give you $1000 for the hatchback.", 'How about $1150?']],
  ['theo', ['Ahoy. Need any help?', 'Would you book Lena for a gig?']],
  ['ped_3', ['Hey, nice day huh?', 'Where can I get food?']],
  ['omar', ["What's the news today?"]],
];
const rows = await page.evaluate(async (script) => {
  const g = window.pto;
  const out = [];
  for (const [id, msgs] of script) {
    const n = g.npcById.get(id);
    n.hidden = false; n.mode = 'routine';
    g.player.x = n.x + 1; g.player.z = n.z;
    g.dialogue.open(n);
    for (const m of msgs) {
      const before = g.ai.costs.log.length;
      await g.dialogue.send(m);
      const e = g.ai.costs.log[before];
      const tier = g.ai.chooseTier(m, { important: n.important, relationship: n.relationship, turnCount: n.chat.length });
      out.push({ npc: id, msg: m, ...e, tier });
    }
    g.dialogue.close();
  }
  return { out, config: g.ai.config, costs: g.ai.costs, provider: g.aiProviderLabel };
}, script);
await browser.close();
server.kill();

const { out, config } = rows;
// gpt-oss models emit hidden reasoning tokens (billed as output) even at effort "low"; budget ~150 per reply.
const REASONING = (model) => (/gpt-oss|r1|thinking/.test(model) ? 150 : 0);
const price = (model, p, c) => { const pr = config.prices[model]; return (p * pr.input + (c + REASONING(model)) * pr.output) / 1e6; };
const lines = out.map((r) => {
  const model = r.tier === 2 ? config.tier2Model : config.tier1Model;
  const cost = r.source === 'live' ? r.cost : price(model, r.prompt, r.completion);
  return { ...r, model, cost };
});
const total = lines.reduce((s, l) => s + l.cost, 0);
const avg = total / lines.length;
const avgPrompt = lines.reduce((s, l) => s + l.prompt, 0) / lines.length;
const avgCompl = lines.reduce((s, l) => s + l.completion, 0) / lines.length;
const t1 = lines.filter((l) => l.tier === 1), t2 = lines.filter((l) => l.tier === 2);
const report = {
  mode: live ? 'LIVE (billed by OpenRouter)' : 'PROJECTED from measured prompt sizes (no API key in this environment)',
  tier1Model: config.tier1Model, tier2Model: config.tier2Model, prices: { [config.tier1Model]: config.prices[config.tier1Model], [config.tier2Model]: config.prices[config.tier2Model] },
  interactions: lines.length, tier1: t1.length, tier2: t2.length,
  avgPromptTokens: Math.round(avgPrompt), avgCompletionTokens: Math.round(avgCompl), assumedReasoningTokensPerReply: live ? 0 : REASONING(config.tier1Model), tokenCounting: live ? 'provider usage' : 'chars/3.8 estimate of the exact prompts the game builds',
  avgCostPerInteractionUSD: +avg.toFixed(7), totalUSD: +total.toFixed(6),
  costPer1000Interactions: +(avg * 1000).toFixed(4),
  lines: lines.map((l) => ({ npc: l.npc, tier: l.tier, prompt: l.prompt, completion: l.completion, cost: +l.cost.toFixed(7), msg: l.msg })),
};
mkdirSync('docs', { recursive: true });
writeFileSync('docs/cost-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, lines: undefined }, null, 2));
