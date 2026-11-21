// Provider-agnostic inference layer with tiered routing, budgets, rate limits,
// concurrency caps, response caching, timeouts, fallbacks and live cost tracking.
import { emptyCosts, type CostStats } from '../game/state';
import { estimateTokens } from './prompt';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatRequest { model: string; messages: ChatMessage[]; maxTokens: number; temperature: number; json: boolean }
export interface ChatResult { text: string; promptTokens: number; completionTokens: number; costUSD: number | null; model: string; ms: number; cachedTokens?: number }

export interface Provider {
  id: string;
  label: string;
  chat(req: ChatRequest, signal: AbortSignal): Promise<ChatResult>;
}

function openRouterBody(req: ChatRequest) {
  return {
    model: req.model,
    messages: req.messages,
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    usage: { include: true }, // OpenRouter returns exact billed cost
    reasoning: { effort: 'low', exclude: true }, // keep reasoning models cheap; ignored by others
    provider: { sort: 'price', allow_fallbacks: true },
  };
}

interface ORResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number } };
  model?: string;
  error?: { message?: string };
}

function parseOR(j: ORResponse, req: ChatRequest, t0: number): ChatResult {
  if (j.error) throw new Error(j.error.message ?? 'provider error');
  const text = j.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('empty completion');
  return {
    text,
    promptTokens: j.usage?.prompt_tokens ?? estimateTokens(req.messages.map((m) => m.content).join('\n')),
    completionTokens: j.usage?.completion_tokens ?? estimateTokens(text),
    costUSD: typeof j.usage?.cost === 'number' ? j.usage.cost : null,
    cachedTokens: j.usage?.prompt_tokens_details?.cached_tokens,
    model: j.model ?? req.model,
    ms: performance.now() - t0,
  };
}

/** Direct browser → OpenRouter (key stored only in this browser's localStorage). */
export class OpenRouterProvider implements Provider {
  id = 'openrouter';
  label = 'OpenRouter (browser key)';
  constructor(private apiKey: string, private baseUrl = 'https://openrouter.ai/api/v1') {}
  async chat(req: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
    const t0 = performance.now();
    const r = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}`, 'X-Title': 'PTO - Paid Time Off' },
      body: JSON.stringify(openRouterBody(req)),
    });
    if (!r.ok) throw new Error(`OpenRouter HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return parseOR(await r.json(), req, t0);
  }
}

/** Browser → PTO Node server → OpenRouter (key stays server-side in OPENROUTER_API_KEY). */
export class ServerProvider implements Provider {
  id = 'server';
  label = 'PTO server (OpenRouter)';
  constructor(private base = '/api') {}
  static async detect(base = '/api'): Promise<boolean> {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(`${base}/health`, { signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) return false;
      const j = await r.json();
      return !!j.ai;
    } catch { return false; }
  }
  async chat(req: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
    const t0 = performance.now();
    const r = await fetch(`${this.base}/chat`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(openRouterBody(req)) });
    if (!r.ok) throw new Error(`server HTTP ${r.status}`);
    return parseOR(await r.json(), req, t0);
  }
}

export interface ModelPrice { input: number; output: number } // USD per 1M tokens

export interface AIConfig {
  tier1Model: string;
  tier2Model: string;
  prices: Record<string, ModelPrice>;
  sessionBudgetUSD: number;
  maxRequestsPerMinute: number;
  globalConcurrency: number;
  perNpcConcurrency: number;
  timeoutMs: number;
  tier1MaxTokens: number;
  tier2MaxTokens: number;
  cacheTTLms: number;
}

// Defaults chosen from OpenRouter's catalog (Nov 2026). All configurable in Settings.
export const DEFAULT_AI_CONFIG: AIConfig = {
  tier1Model: 'openai/gpt-oss-20b',
  tier2Model: 'openai/gpt-oss-120b',
  prices: {
    // OpenRouter weighted-average effective prices, Nov 2026 (lowest providers are ~40% cheaper)
    'openai/gpt-oss-20b': { input: 0.045, output: 0.178 },
    'openai/gpt-oss-120b': { input: 0.096, output: 0.365 },
    'mistralai/mistral-nemo': { input: 0.02, output: 0.04 },
    'google/gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
    'deepseek/deepseek-chat': { input: 0.25, output: 1.0 },
  },
  sessionBudgetUSD: 0.5,
  maxRequestsPerMinute: 30,
  globalConcurrency: 3,
  perNpcConcurrency: 1,
  timeoutMs: 15000,
  tier1MaxTokens: 600, // gpt-oss reasons briefly before answering; headroom avoids empty replies
  tier2MaxTokens: 900,
  cacheTTLms: 10 * 60 * 1000,
};

export type DenyReason = 'no_provider' | 'budget' | 'rate' | 'busy';

export class InferenceRouter {
  provider: Provider | null = null;
  config: AIConfig;
  costs: CostStats = emptyCosts();
  private inflight = 0;
  private perNpc = new Map<string, number>();
  private recent: number[] = [];
  private cache = new Map<string, { t: number; result: ChatResult }>();

  constructor(cfg: Partial<AIConfig> = {}) {
    this.config = { ...DEFAULT_AI_CONFIG, ...cfg, prices: { ...DEFAULT_AI_CONFIG.prices, ...(cfg.prices ?? {}) } };
  }

  /** Tier router: escalate only when the exchange needs depth. */
  chooseTier(message: string, opts: { important: boolean; relationship: number; turnCount: number }): 1 | 2 {
    const m = message.toLowerCase();
    const complex = /\b(negotiat|deal|business|invest|lease|partner|plan|why|explain|story|price|offer|counter|buy|sell)/.test(m) || /\$\s?\d/.test(m);
    if (message.length > 220) return 2;
    if (complex && opts.important) return 2;
    if (opts.important && opts.relationship >= 45 && opts.turnCount > 6) return 2;
    return 1;
  }

  canRequest(npcId: string): DenyReason | null {
    if (!this.provider) return 'no_provider';
    if (this.costs.costUSD >= this.config.sessionBudgetUSD) return 'budget';
    const now = Date.now();
    this.recent = this.recent.filter((t) => now - t < 60000);
    if (this.recent.length >= this.config.maxRequestsPerMinute) return 'rate';
    if (this.inflight >= this.config.globalConcurrency) return 'busy';
    if ((this.perNpc.get(npcId) ?? 0) >= this.config.perNpcConcurrency) return 'busy';
    return null;
  }

  priceOf(model: string, prompt: number, completion: number): number {
    const p = this.config.prices[model] ?? { input: 0.1, output: 0.4 };
    return (prompt * p.input + completion * p.output) / 1e6;
  }

  private key(model: string, msgs: ChatMessage[]) {
    let h = 0;
    const s = model + '|' + msgs.map((m) => m.content).join('|');
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return String(h) + ':' + s.length;
  }

  async complete(npcId: string, tier: 1 | 2, messages: ChatMessage[], cacheable: boolean): Promise<ChatResult> {
    const deny = this.canRequest(npcId);
    if (deny) throw Object.assign(new Error('denied: ' + deny), { deny });
    const model = tier === 2 ? this.config.tier2Model : this.config.tier1Model;
    const k = this.key(model, messages);
    if (cacheable) {
      const hit = this.cache.get(k);
      if (hit && Date.now() - hit.t < this.config.cacheTTLms) {
        this.costs.cacheHits++;
        this.costs.log.push({ t: Date.now(), npc: npcId, model, tier, prompt: 0, completion: 0, cost: 0, ms: 0, source: 'cache' });
        return { ...hit.result, ms: 0 };
      }
    }
    this.inflight++;
    this.perNpc.set(npcId, (this.perNpc.get(npcId) ?? 0) + 1);
    this.recent.push(Date.now());
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.config.timeoutMs);
    try {
      const req: ChatRequest = { model, messages, maxTokens: tier === 2 ? this.config.tier2MaxTokens : this.config.tier1MaxTokens, temperature: 0.8, json: true };
      const res = await this.provider!.chat(req, ctl.signal);
      const cost = res.costUSD ?? this.priceOf(model, res.promptTokens, res.completionTokens);
      this.record(npcId, model, tier, res.promptTokens, res.completionTokens, cost, res.ms);
      if (cacheable) {
        this.cache.set(k, { t: Date.now(), result: res });
        if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
      }
      return { ...res, costUSD: cost };
    } catch (e) {
      this.costs.failures++;
      throw e;
    } finally {
      clearTimeout(timer);
      this.inflight--;
      this.perNpc.set(npcId, (this.perNpc.get(npcId) ?? 1) - 1);
    }
  }

  record(npc: string, model: string, tier: number, prompt: number, completion: number, cost: number, ms: number) {
    const c = this.costs;
    c.requests++;
    c.promptTokens += prompt;
    c.completionTokens += completion;
    c.costUSD += cost;
    const bt = (c.byTier['tier' + tier] ??= { requests: 0, costUSD: 0, tokens: 0 });
    bt.requests++; bt.costUSD += cost; bt.tokens += prompt + completion;
    c.log.push({ t: Date.now(), npc, model, tier, prompt, completion, cost, ms, source: 'live' });
    if (c.log.length > 300) c.log.splice(0, c.log.length - 300);
  }

  recordSimulated(npc: string, prompt: number, completion: number) {
    this.costs.simulated++;
    this.costs.log.push({ t: Date.now(), npc, model: 'simulated', tier: 0, prompt, completion, cost: 0, ms: 0, source: 'sim' });
    if (this.costs.log.length > 300) this.costs.log.splice(0, this.costs.log.length - 300);
  }

  avgCostPerInteraction(): number {
    const n = this.costs.requests;
    return n ? this.costs.costUSD / n : 0;
  }
}
