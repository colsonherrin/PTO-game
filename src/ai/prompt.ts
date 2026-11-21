import type { NPC } from '../npc/npc';
import type { ActionSpec } from './actions';

export interface TalkContext {
  timeStr: string;
  dayPart: string;
  locationName: string;
  npcStatus: string;
  nearby: string[];
  playerName: string | null; // only if this NPC actually knows it
  playerObservations: string[]; // what the NPC can SEE about the player
  knownEvents: { id: string; text: string }[];
  jobs: { id: string; title: string; description: string; pay: number }[];
  jobStatus: string[]; // relevant job progress the NPC is aware of
  sells: { id: string; name: string; price: number }[];
  vehicles: { id: string; name: string; asking: number }[];
  contacts: { id: string; name: string; label: string }[];
  activities: { id: string; description: string }[];
  actions: ActionSpec[];
  locations: { id: string; name: string }[];
  carId: string | null;
}

/** Stable system prompt (rules + persona). Kept byte-identical across turns so providers can prefix-cache it. */
export function systemPrompt(npc: NPC): string {
  const p = npc.p;
  return [
    `You are ${p.name}, a resident of Palmetto Heights, a sunny coastal neighborhood in the open-world game PTO (Paid Time Off). Stay fully in character. Never mention being an AI or a game.`,
    `PERSONA: ${p.age}-year-old ${p.occupation}. Personality: ${p.personality} Speaking style: ${p.speakingStyle}`,
    `BACKGROUND: ${p.background}`,
    `GOALS: ${p.goals.join('; ')}.`,
    `WHAT YOU KNOW ABOUT TOWN: ${p.knowledge.join('; ')}.`,
    `RULES: You only know what is listed in this prompt — your persona, your memories, and what you can currently see. Do not invent facts about the player. You can only act through the listed actions with the exact ids given; never invent items, money, places, jobs or abilities. If you agree to do something physical (a ride, following, selling), you MUST include the matching action — never just narrate it. Keep replies short (1-3 sentences) unless asked for detail. Speak naturally, in your own voice.`,
    `OUTPUT: reply with ONLY a JSON object: {"say": string, "mood": one of ecstatic|happy|content|neutral|tired|annoyed|upset|angry|scared, "relationship_delta": integer -10..10 (how this exchange changed your opinion of the player), "player_name": string or null (only if the player told you their name), "memory": short third-person note worth remembering about this exchange or "", "actions": [{"name": action_name, "args": {...}}]}`,
  ].join('\n');
}

export function situationPrompt(npc: NPC, ctx: TalkContext, playerMsg: string): string {
  const lines: string[] = [];
  lines.push(`NOW: ${ctx.timeStr} (${ctx.dayPart}). You are at ${ctx.locationName}. ${ctx.npcStatus}. Mood: ${npc.mood}.`);
  if (ctx.nearby.length) lines.push(`NEARBY YOU CAN SEE: ${ctx.nearby.join(', ')}.`);
  lines.push(`THE PLAYER: ${ctx.playerName ? `you know them as "${ctx.playerName}"` : 'you do not know their name'}. Your opinion: ${npc.opinion()} (relationship ${npc.relationship}/100). You observe: ${ctx.playerObservations.join('; ') || 'nothing unusual'}.`);
  if (npc.summary) lines.push(`OLDER MEMORIES (summary): ${npc.summary}`);
  const mems = npc.memories.slice(-8).map((m) => `- ${m.text}`);
  if (mems.length) lines.push(`YOUR MEMORIES:\n${mems.join('\n')}`);
  if (ctx.knownEvents.length) lines.push(`EVENTS YOU KNOW ABOUT: ${ctx.knownEvents.map((e) => `[${e.id}] ${e.text}`).join(' | ')}`);
  if (ctx.jobStatus.length) lines.push(`JOB STATUS: ${ctx.jobStatus.join(' | ')}`);
  const offer: string[] = [];
  if (ctx.jobs.length) offer.push(`jobs you can offer: ${ctx.jobs.map((j) => `${j.id} ("${j.title}": ${j.description} Pays $${j.pay})`).join('; ')}`);
  if (ctx.sells.length) offer.push(`items you sell: ${ctx.sells.map((s) => `${s.id} ($${s.price})`).join(', ')}`);
  if (ctx.vehicles.length) offer.push(`vehicles for sale: ${ctx.vehicles.map((v) => `${v.id} "${v.name}" asking $${v.asking} (you may haggle down a bit; you know your lowest acceptable price)`).join('; ')}`);
  if (ctx.carId) offer.push(`you own a car (${ctx.carId}) and can give rides`);
  if (ctx.activities.length) offer.push(`activities: ${ctx.activities.map((a) => `${a.id} (${a.description})`).join('; ')}`);
  if (ctx.contacts.length) offer.push(`contacts you can call: ${ctx.contacts.map((c) => `${c.id} (${c.name}, ${c.label})`).join('; ')}`);
  if (offer.length) lines.push(`WHAT YOU CAN OFFER: ${offer.join(' || ')}`);
  lines.push(`LOCATION IDS: ${ctx.locations.map((l) => `${l.id}=${l.name}`).join(', ')}`);
  lines.push(`ACTIONS AVAILABLE: ${ctx.actions.map((a) => `${a.signature} — ${a.description}`).join(' ; ')}`);
  const recent = npc.chat.slice(-6).map((c) => `${c.role === 'player' ? 'Player' : npc.firstName}: ${c.text}`);
  if (recent.length) lines.push(`CONVERSATION SO FAR:\n${recent.join('\n')}`);
  lines.push(`Player says: "${playerMsg.slice(0, 500)}"`);
  lines.push('Respond with the JSON object only.');
  return lines.join('\n');
}

export const estimateTokens = (s: string) => Math.ceil(s.length / 3.8);
