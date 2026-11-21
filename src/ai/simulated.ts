// Deterministic "simulated" dialogue brain used when no API key is configured,
// when the budget is exhausted, or when a live request fails. It produces the same
// structured output as the LLM (speech + validated actions), so every gameplay loop
// works offline. Responses are clearly labeled as simulated in the UI.
import type { NPC } from '../npc/npc';
import type { TalkContext } from './prompt';
import type { NPCResponse, ProposedAction } from './actions';

export interface SimExtras { priceFloor: (id: string) => number; heat: number }

const has = (m: string, re: RegExp) => re.test(m);
const pick = <T,>(a: T[], seed: number) => a[Math.abs(seed) % a.length];

const LOCATION_WORDS: [RegExp, string][] = [
  [/beach|ocean|boardwalk|sand/, 'beach'], [/park|pond/, 'palmetto_park'], [/plaza|fountain|downtown|center/, 'central_plaza'],
  [/caf[eé]|coffee|sol\b|rosa/, 'sol_cafe'], [/taco|truck|jaz/, 'food_truck'], [/bar|low tide|theo|drink/, 'low_tide_bar'],
  [/clinic|hospital|doctor|nurse/, 'clinic'], [/gym/, 'gym'], [/car lot|dealer|bellini|marco/, 'bellini_motors'],
  [/garage|mechanic|ellis|hank/, 'ellis_auto'], [/diner|marina/, 'marina_diner'], [/office|tidewater|labs|work/, 'tidewater_labs'],
  [/realty|real estate|priya/, 'nair_realty'], [/kiosk/, 'corner_kiosk'], [/news|omar/, 'newsstand'],
  [/seabreeze/, 'seabreeze_apts'], [/palm court/, 'palm_court_apts'], [/harbor|lofts/, 'harbor_lofts'],
];

export function findLocation(msg: string, valid: string[]): string | null {
  const m = msg.toLowerCase();
  for (const [re, id] of LOCATION_WORDS) if (re.test(m) && valid.includes(id)) return id;
  return null;
}

export function extractName(msg: string): string | null {
  const m = msg.match(/\b(?:i'?m|i am|my name is|my name's|call me|it'?s|this is)\s+([A-Z][a-zA-Z'-]{1,15})\b/i);
  if (!m) return null;
  const n = m[1];
  const stop = ['new', 'good', 'fine', 'okay', 'ok', 'here', 'just', 'looking', 'not', 'so', 'the', 'a', 'on', 'from', 'hungry', 'tired', 'lost', 'sorry', 'great', 'back', 'vacation', 'visiting', 'busy', 'free', 'interested'];
  if (stop.includes(n.toLowerCase())) return null;
  return n[0].toUpperCase() + n.slice(1);
}

export function extractPrice(msg: string): number | null {
  const m = msg.replace(/,/g, '').match(/\$\s?(\d{1,6})|(\d{2,6})\s?(?:dollars|bucks)/i);
  if (!m) return null;
  return parseInt(m[1] ?? m[2], 10);
}

export function simulateResponse(npc: NPC, ctx: TalkContext, msg: string, x: SimExtras): NPCResponse {
  const m = msg.toLowerCase();
  const seed = msg.length + npc.chat.length + Math.floor(Date.now() / 1000);
  const name = ctx.playerName;
  const you = name ?? (npc.p.speakingStyle.includes('mijo') ? 'sweetheart' : npc.p.speakingStyle.includes('bro') ? 'bro' : 'friend');
  const actions: ProposedAction[] = [];
  let say = '';
  let delta = 0;
  let mood: string | undefined;
  let memory = '';
  let playerName: string | null = null;
  const act = new Set(ctx.actions.map((a) => a.name));
  const rel = npc.relationship;
  const busyWorking = npc.activity === 'work';

  const introduced = extractName(msg);
  if (introduced && !ctx.playerName) {
    playerName = introduced;
    delta += 3;
    memory = `Met someone named ${introduced}.`;
  }

  // Hostility first
  if (has(m, /\b(stupid|idiot|hate you|shut up|loser|ugly|dumb|screw you)\b/)) {
    say = pick([`Wow. Okay. Goodbye.`, `Excuse me?! Watch your mouth.`, `I don't need this today.`], seed);
    return { say, mood: 'angry', relationship_delta: -8, memory: 'The player insulted me.', actions: [], player_name: playerName };
  }

  // Police: fines
  if (npc.p.isCop && x.heat > 0 && act.has('issue_fine')) {
    const amt = Math.round(40 + x.heat * 40);
    return { say: `Hold it right there, ${you}. I've had reports about you. That's a $${amt} fine — pay up and keep it clean.`, mood: 'annoyed', relationship_delta: -3, memory: `Fined the player $${amt}.`, actions: [{ name: 'issue_fine', args: { amount: amt } }], player_name: playerName };
  }

  const ride = has(m, /\b(ride|lift|drive me|take me|give me a ride|can you drive|drop me)\b/);
  const follow = has(m, /\b(follow me|come with me|hang out|walk with me|come along|join me|show me around)\b/);
  const stop = has(m, /\b(stop following|go home|you can go|leave me|that's all|see you later)\b/);
  const work = has(m, /\b(job|work|gig for me|any work|money|hire|help you|need help|errand|task)\b/) && !has(m, /\bwhere do you work\b/);
  const buy = has(m, /\b(buy|sell|price|how much|cost|purchase|car for sale|deal|can i get|can i have|i'll have|i'll take|i want a|order)\b/) || extractPrice(m) !== null;
  const news = has(m, /\b(news|gossip|heard|what's new|whats new|going on|happening)\b/);
  const about = has(m, /\b(who are you|what do you do|about you|your job|tell me about yourself|how long)\b/);
  const greet = has(m, /^(hi|hey|hello|yo|sup|howdy|good (morning|afternoon|evening)|hola|ahoy)\b/);
  const thanks = has(m, /\b(thanks|thank you|appreciate|you're great|awesome|love this)\b/);

  if (stop && act.has('stop_following')) {
    actions.push({ name: 'stop_following', args: {} });
    say = pick([`Alright, I'll head back. Catch you later, ${you}!`, `Okay! This was fun. See you around.`], seed);
  } else if (ride) {
    const dest = findLocation(m, ctx.locations.map((l) => l.id)) ?? 'central_plaza';
    if (!ctx.carId) {
      say = pick([`I don't have a car, ${you}. Marco at Bellini Motors sells them, though.`, `Wish I could, but I don't drive. Try someone with wheels.`], seed);
    } else if (rel < -10) {
      say = `After how you've acted? Walk.`;
      mood = 'annoyed';
    } else if (busyWorking && rel < 20) {
      say = `I'm working right now. Ask me again when I'm off, or... buy me a coffee and maybe I'll make an exception.`;
    } else {
      const destName = ctx.locations.find((l) => l.id === dest)?.name ?? dest;
      say = pick([`Sure, I've got some time. Hop in — ${destName}, right?`, `Yeah, okay. Car's close. Let's go to ${destName}.`], seed);
      actions.push({ name: 'drive_to', args: { destination: dest } });
      delta += 2;
      memory = `Agreed to drive the player to ${destName}.`;
    }
  } else if (follow && act.has('follow_player')) {
    if (rel < -5) say = `Uh, no thanks. I don't really know you.`;
    else if (busyWorking && rel < 15 && npc.important) say = `I'd love to, but I'm on the clock. Later?`;
    else { say = pick([`Sure, lead the way!`, `Why not? I could use a walk.`], seed); actions.push({ name: 'follow_player', args: {} }); delta += 1; }
  } else if (buy && (ctx.vehicles.length || ctx.sells.length)) {
    const offer = extractPrice(m);
    if (ctx.vehicles.length && /(car|hatch|pickup|truck|vehicle|sunburst|coastline|\$\d{3,})/.test(m)) {
      const v = /pickup|truck|coastline/.test(m) ? ctx.vehicles.find((q) => q.id.includes('pickup')) ?? ctx.vehicles[0] : ctx.vehicles[0];
      const floor = x.priceFloor(v.id);
      if (offer === null) { say = `The ${v.name}? Beautiful machine, my friend. For you: $${v.asking}. Make me an offer.`; actions.push({ name: 'trade_item', args: { item_id: v.id, price: v.asking } }); }
      else if (offer >= floor) { say = `$${offer}? ...Mamma mia, you drive a hard bargain. Deal!`; actions.push({ name: 'trade_item', args: { item_id: v.id, price: offer } }); delta += 2; memory = `Agreed to sell the ${v.name} for $${offer}.`; }
      else { const counter = Math.max(floor, Math.round((v.asking + offer) / 2 / 10) * 10); say = `$${offer}? You're killing me! I can do $${counter}, final offer.`; actions.push({ name: 'trade_item', args: { item_id: v.id, price: counter } }); }
    } else if (ctx.sells.length) {
      const s = ctx.sells.find((q) => m.includes(q.id) || m.includes(q.name.toLowerCase())) ?? ctx.sells[0];
      say = `${s.name}? That's $${s.price}. Want one?`;
      actions.push({ name: 'trade_item', args: { item_id: s.id, price: s.price } });
    }
  } else if (work) {
    if (ctx.jobs.length) {
      const j = ctx.jobs[0];
      say = `Actually, yes! ${j.description} I'll pay $${j.pay}. Interested?`;
      actions.push({ name: 'offer_job', args: { job_id: j.id } });
      memory = `Offered the player a job: ${j.title}.`;
    } else if (ctx.jobStatus.length) {
      say = `You've still got my job going — ${ctx.jobStatus[0]}`;
    } else {
      const tip = npc.p.knowledge.find((k) => /deliver|needs|leasing|limes|for sale/i.test(k));
      say = tip ? `Not from me, but here's a tip: ${tip}.` : `Nothing right now. Rosa at Sol Café always needs delivery help.`;
    }
  } else if (ctx.activities.length && has(m, /\b(gig|music|book her|lena|play|heal|hurt|patch|injur|workout|train)\b/)) {
    const a = ctx.activities.find((q) => (q.id === 'live_music_night' && /gig|music|lena|play|book/.test(m)) || (q.id === 'heal' && /heal|hurt|patch|injur/.test(m)) || (q.id === 'workout' && /workout|train/.test(m)));
    if (a) { actions.push({ name: 'start_activity', args: { activity_id: a.id } }); say = a.id === 'live_music_night' ? `Arr... fine. You've earned some trust. Tell the busker she plays Friday night. If she's terrible, it's on you.` : a.id === 'heal' ? `Let me take a look... there. All patched up. Be careful out there.` : `Let's go! Drop and give me twenty!`; delta += 2; }
    else if (npc.p.id === 'theo' && /gig|music|lena|play|book/.test(m)) say = `Book the busker? Why should I do you any favors? Prove you're useful first — my lime delivery never showed up.`;
  } else if (news) {
    const ev = ctx.knownEvents[ctx.knownEvents.length - 1];
    const heard = npc.memories.filter((q) => q.kind === 'heard' || q.kind === 'event').slice(-1)[0];
    if (ev) { say = `Did you hear? ${ev.text}`; actions.push({ name: 'react_to_event', args: { event_id: ev.id } }); }
    else if (heard) say = `Word is... ${heard.text}`;
    else say = pick([`Quiet day. ${npc.p.knowledge[0]}.`, `Not much. Though ${npc.p.knowledge[npc.p.knowledge.length - 1].toLowerCase()}.`], seed);
  } else if (about) {
    say = `I'm ${npc.p.name} — ${npc.p.occupation.toLowerCase()}. ${npc.p.background.split('.')[0]}.`;
    delta += 1;
  } else if (thanks) {
    say = pick([`Anytime, ${you}!`, `Of course. You're alright, you know that?`], seed);
    delta += 2; mood = 'happy';
  } else if (introduced) {
    say = pick([`Nice to meet you, ${introduced}! I'm ${npc.firstName}.`, `${introduced}, huh? Welcome to Palmetto Heights. I'm ${npc.firstName}.`], seed);
  } else if (greet) {
    const met = npc.chat.length > 0 || npc.memories.some((q) => q.kind === 'chat');
    say = met
      ? pick([`Hey, ${you}! Good to see you again.`, `Oh hey, ${you}! Back so soon?`], seed)
      : pick([`Hi there! Don't think we've met. I'm ${npc.firstName}.`, `Hey. ${npc.p.barks[0]}`], seed);
  } else {
    const lines = [
      `${npc.p.barks[seed % npc.p.barks.length]} Anyway — ${npc.p.goals[0].toLowerCase()} is what's on my mind.`,
      `Hmm. ${npc.p.knowledge[seed % npc.p.knowledge.length]}. Just so you know.`,
      `Honestly? It's ${ctx.dayPart} at ${ctx.locationName} and I'm ${npc.mood}. What can I do for you?`,
    ];
    say = pick(lines, seed);
  }
  if (!memory && say) memory = `Chatted with ${name ?? 'a visitor'}: they said "${msg.slice(0, 60)}".`;
  return { say, mood, relationship_delta: delta, player_name: playerName, memory, actions };
}
