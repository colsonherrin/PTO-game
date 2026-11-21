# AI cost measurement

Run `npm run measure`. It boots the real game in headless Chrome, plays a scripted 14-turn session (Rosa, Dev, Marco, Theo, an ambient resident, Omar), and records the exact system + situation prompts the game builds for each turn. Output: `docs/cost-report.json`.

## Latest result (projected — no API key was available in the build environment)

| Metric | Value |
|---|---|
| Interactions | 14 (11 Tier 1, 3 Tier 2) |
| Avg prompt tokens | ~962 |
| Avg reply tokens | ~59 (+150 assumed hidden reasoning tokens for gpt-oss) |
| Tier 1 model / price | `openai/gpt-oss-20b` · $0.045 in / $0.178 out per 1M |
| Tier 2 model / price | `openai/gpt-oss-120b` · $0.096 in / $0.365 out per 1M |
| **Avg cost per interaction** | **≈ $0.00010** |
| Cost per 1,000 interactions | ≈ $0.10 |

Prices are OpenRouter's weighted-average effective prices (Nov 2026); the cheapest providers list gpt-oss-20b at $0.018/$0.09. Token counts here are a chars/3.8 estimate of the real prompts, so treat the figure as ±20 %. It has **not** been confirmed against a billed run.

## Measuring live

```bash
OPENROUTER_API_KEY=sk-or-... npm run build && npm run measure
```

In live mode the script reports OpenRouter's billed `usage.cost` per request. In-game, open **Esc** for the running total, tokens, latency, cache hits and fallbacks.

## Cost controls in the game

- Tier 0 handles movement, schedules, traffic, greetings, barks, gossip, witnesses and job logic with zero inference.
- Inference runs only on a player message or a reaction to a deterministic event.
- Session budget (default $0.50), 30 requests/minute, 3 concurrent globally, 1 per NPC, 15 s timeout.
- Small talk with ambient residents is cached for 10 minutes.
- Stable system prompt for provider prefix caching; memory compression keeps the situation prompt bounded.
- Server proxy enforces its own token cap, rate limit, model allow-list and budget (`.env.example`).
