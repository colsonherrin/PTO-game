# Roadmap

## Done (MVP)
- [x] Playable 3D neighborhood, day/night, shadows, traffic, beach
- [x] Third-person controller, driving, carjacking, crashes, health, money, inventory
- [x] 16 named NPCs + 22 procedural residents with schedules
- [x] LLM conversations (OpenRouter) with simulated offline fallback
- [x] Persistent memory, rolling summaries, non-omniscient context
- [x] Validated tool calls that change the world (rides, trades, jobs, calls, fines)
- [x] Emergent loops: jobs, fetch quest, vehicle delivery, Lena's gig, car haggling, kiosk business, gossip, police heat
- [x] Save/load, settings, cost panel, voice in/out
- [x] Unit tests, headless gameplay test, cost measurement

## Next
- [ ] Live cost run with a real key; tune prompt size (target < 700 tokens) and default models
- [ ] Interiors for café, bar and clinic
- [ ] NPC-to-NPC LLM conversations at story beats (Tier 2, budgeted), e.g. Rosa and Jaz feuding
- [ ] NPCs proactively text the player (job offers, party invites) via a phone UI
- [ ] More jobs generated from NPC goals instead of templates
- [ ] Traffic lights and smarter intersection right-of-way
- [ ] Skinned/animated character models (glTF) and a Three.js/Babylon render backend behind the same `Renderer` interface
- [ ] Rapier physics for vehicles and ragdolls
- [ ] Coarse 1 Hz simulation tier + spatial hashing for thousands of off-screen NPCs
- [ ] Bigger map streamed in chunks
- [ ] Server-authoritative world state for multiplayer (prompt builder + validator already pure)
- [ ] Gamepad support
