# PTO architecture

```
src/
  engine/      math, mesh builder, procedural PBR textures, three.js renderer
  world/       city generation (blocks, buildings, props, POIs, colliders, nav graph), sky/time-of-day
  game/        game loop, player + camera, vehicles + traffic AI, dialogue bridge, characters, car models, shared state
  npc/         personas (16 named + procedural ambient), NPC runtime (schedule, memory, mood)
  ai/          inference router + providers, prompt builder, action schema/validator, simulated brain
  systems/     procedural audio, IndexedDB saves
  ui/          DOM HUD, dialogue, journal, settings, minimap
server/        zero-dependency Node server: static hosting + OpenRouter proxy (key stays server-side)
tests/         node:test unit tests (bundled with esbuild)
scripts/       build (single-file bundle), e2e (Playwright), cost measurement
```

## Stack decision

- **Rendering: three.js (MIT).** `src/engine/renderer.ts` owns the scene: PBR materials, PMREM image-based lighting baked from the sky dome whenever the sun moves, a 4096² soft shadow map that follows the player, the three.js `Water` object for the ocean, and an `EffectComposer` chain (MSAA render target → bloom → ACES output). Quality presets switch the chain off for weak GPUs.
- **World geometry** is still generated in code (`MeshBuilder`), now grouped by material with world-space UVs so procedural texture sets (`src/engine/textures.ts`: asphalt, pavers, facades with lit windows, storefronts, wood, bark, foliage) tile correctly. Normal maps are derived from height canvases at load time.
- **Characters** are skinned GLB models converted from the Microsoft Rocketbox library (`scripts/assets/convert.mjs` runs FBXLoader + GLTFExporter in headless Chrome, then re-encodes textures as WebP). `src/game/characters.ts` clones them per NPC and cross-fades motion-capture clips driven by the simulation's animation state.
- **Vehicles** are extruded spline profiles with clear-coat paint and reflective glass (`src/game/models.ts`).
- **Physics** stays a small arcade implementation (circle-vs-AABB), and three.js is treated as untyped at the boundary (`src/types/three.d.ts`) to keep the dependency surface to one package.
- Bundled by esbuild into `dist/index.html`; models and two image textures live in `dist/assets/`.

## The tiered intelligence model

| Tier | What runs it | Used for |
|---|---|---|
| **0 — no LLM** | deterministic TypeScript | walking (A* over a sidewalk graph), schedules (sleep → travel → work → eat → socialize), traffic, police chases, ambient barks, gossip propagation, witnesses, job progress, greetings |
| **1 — cheap model** | `openai/gpt-oss-20b` (default) | normal conversation turns, short reactions (handing over an item, receiving a gift) |
| **2 — stronger model** | `openai/gpt-oss-120b` (default) | negotiation, business/price talk, long messages, deep conversations with close friends |

LLM inference happens **only when the player sends a message** (or triggers a reaction to a deterministic event). NPCs never think continuously. `InferenceRouter.chooseTier()` escalates by content and relationship depth.

### Inference router (`src/ai/inference.ts`)

- Provider-agnostic `Provider` interface: `OpenRouterProvider` (browser key), `ServerProvider` (Node proxy), easy to add others.
- Session budget (USD), requests-per-minute limit, global and per-NPC concurrency caps, timeouts with `AbortController`.
- Response cache (LRU + TTL) for short ambient small talk.
- Real-time cost tracking. Uses OpenRouter's billed `usage.cost` (`usage: {include: true}`); falls back to tokens × configured prices.
- Any denial or failure falls back to the simulated brain, labeled as such in the UI.

### Prompting for cost and caching (`src/ai/prompt.ts`)

- **System prompt** = rules + persona + knowledge. It is byte-identical across turns so providers that support automatic prefix caching can reuse it (unit-tested).
- **Situation prompt** = time, place, what the NPC can see, opinion of the player, rolling memory summary + last 8 memories, known events, job state, what they can offer, allowed action signatures, last 6 chat lines.
- Output is a JSON object: `say`, `mood`, `relationship_delta`, `player_name`, `memory`, `actions[]`.
- Typical prompt ≈ 960 tokens; replies ≈ 60 tokens.

### Memory & context compression (`src/npc/npc.ts`)

Each turn the model writes a one-line third-person `memory`. The engine also writes memories for job outcomes, gifts, rides and witnessed events. When an NPC has more than 24 memories, the oldest low-importance ones fold into a ≤600-char rolling summary; memories with importance ≥ 0.8 survive verbatim.

### Non-omniscience

What goes into the prompt is computed per NPC from the world state: nearby people within 20 m (named only if the NPC knows them), visible facts about the player (in a car, carrying a delivery box, hurt), events they witnessed (within 32 m) or heard via gossip, and the player's name only if they were told it — directly, through a phone call (`call_contact`), or by gossip between NPCs.

## Actions: the LLM proposes, the engine disposes (`src/ai/actions.ts`)

Each turn the NPC is offered only the actions it can currently perform (e.g. `drive_to` only if it owns an available car; `issue_fine` only for the cop when the player has heat). Every proposed action is validated against authoritative game state: locations must exist, items must exist *and* be owned, prices must clear the NPC's floor, jobs must be available, contacts must be real. Rejected actions are shown in the chat as "rejected by game rules" so behaviour stays transparent. Validated actions are executed by `DialogueSystem.execute()` and produce real changes: rides drive along the road network, purchases transfer money and ownership, jobs spawn inventory items and objectives, Theo booking Lena rewrites her schedule permanently.

## World simulation

- Every NPC runs a schedule state machine every frame. Distant NPCs keep simulating (cheap) but aren't drawn; indoor NPCs are hidden while inside.
- Traffic uses lane following on a 5×5 intersection grid with obstacle detection and a gridlock breaker. NPC-driven rides use BFS routing to a curb stop point on the correct side of the street.
- Events (crashes, carjacking, hitting pedestrians, purchases, completed jobs) record witnesses; witnesses remember, react, and lose trust if it was you. Omar the newsstand owner hears about anything with 2+ witnesses. NPCs who hang out together gossip about you every few seconds of game time.

## Persistence

`Game.serialize()` stores the clock, player, every NPC with history (memories, summary, chat, relationship, mood, inventory, money, known name), vehicles and ownership, jobs, events, story flags, business state and AI cost stats in IndexedDB.

## Scaling notes

- NPC update is O(n) per frame with no LLM involvement; the Tier-0 sim is the part that must scale to thousands (move distant NPCs to a coarse 1 Hz tick and spatial hashing — see roadmap).
- The prompt builder and validator are pure functions of world state, so they can move server-side for multiplayer unchanged.
