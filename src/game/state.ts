// Shared game-state types and the authoritative catalogs the AI is validated against.

export interface ItemDef { id: string; name: string; price: number; description: string; heal?: number; giftable?: boolean }

export const ITEMS: Record<string, ItemDef> = {
  coffee: { id: 'coffee', name: 'Coffee', price: 4, description: 'Hot café con leche from Sol Café.', heal: 10, giftable: true },
  pastry: { id: 'pastry', name: 'Pastry', price: 3, description: 'Guava pastelito.', heal: 8, giftable: true },
  taco: { id: 'taco', name: 'Taco', price: 6, description: 'Al pastor taco from Jaz\'s truck.', heal: 20, giftable: true },
  newspaper: { id: 'newspaper', name: 'Newspaper', price: 2, description: 'The Palmetto Gazette — local news.' },
  pastry_box: { id: 'pastry_box', name: 'Box of pastries', price: 25, description: 'A delivery box from Sol Café.' },
  limes: { id: 'limes', name: 'Crate of limes', price: 20, description: 'Fresh limes for The Low Tide.' },
  lucky_coin: { id: 'lucky_coin', name: 'Lucky coin', price: 1, description: 'An old Spanish coin Gus found while fishing.', giftable: true },
  painting: { id: 'painting', name: 'Sunset painting', price: 120, description: 'A small oil painting of Palmetto Beach by Sofia.', giftable: true },
  kiosk_lease: { id: 'kiosk_lease', name: 'Corner kiosk lease', price: 1500, description: 'Lease for the vacant corner kiosk next to Sol Café. Earns daily income.' },
  flowers: { id: 'flowers', name: 'Flowers', price: 10, description: 'A small bouquet.', giftable: true },
};

export interface VehicleForSaleDef { id: string; name: string; type: 'hatch' | 'pickup'; color: string; asking: number; floor: number }
export const VEHICLES_FOR_SALE: Record<string, VehicleForSaleDef> = {
  sunburst_hatch: { id: 'sunburst_hatch', name: 'Sunburst hatchback', type: 'hatch', color: '#f2a541', asking: 1400, floor: 1050 },
  coastline_pickup: { id: 'coastline_pickup', name: 'Coastline pickup', type: 'pickup', color: '#3fa7a3', asking: 2200, floor: 1750 },
};

export type MemoryKind = 'chat' | 'event' | 'heard' | 'fact' | 'summary';
export interface Memory { t: number; text: string; kind: MemoryKind; importance: number; about?: string }

export interface ChatTurn { role: 'player' | 'npc'; text: string; t: number }

export interface WorldEvent {
  id: string;
  t: number;
  type: 'hit_pedestrian' | 'car_crash' | 'carjack' | 'job_done' | 'purchase' | 'gift' | 'reckless_driving' | 'business' | 'fine' | 'gig';
  x: number; z: number;
  text: string; // third-person description
  actor: string; // 'player' or npc id
  victim?: string;
  witnesses: string[];
  severity: number; // 0..1
}

export type JobStatus = 'offered' | 'active' | 'ready' | 'done' | 'failed';
export interface ActiveJob {
  id: string; // instance id
  templateId: string;
  giver: string;
  title: string;
  description: string;
  kind: 'deliver_item' | 'fetch_item' | 'deliver_vehicle' | 'persuade';
  item?: string;
  pickupFrom?: string;
  deliverTo?: string;
  destinationPoi?: string;
  vehicleId?: string;
  pay: number;
  status: JobStatus;
  stage: number; // fetch: 0 pick up, 1 deliver
  acceptedAt: number;
}

export interface CostStats {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  costUSD: number;
  cacheHits: number;
  failures: number;
  simulated: number;
  byTier: Record<string, { requests: number; costUSD: number; tokens: number }>;
  log: { t: number; npc: string; model: string; tier: number; prompt: number; completion: number; cost: number; ms: number; source: 'live' | 'cache' | 'sim' }[];
}

export function emptyCosts(): CostStats {
  return { requests: 0, promptTokens: 0, completionTokens: 0, costUSD: 0, cacheHits: 0, failures: 0, simulated: 0, byTier: {}, log: [] };
}

export function formatClock(mins: number): string {
  const d = Math.floor(mins / 1440) + 1;
  const m = Math.floor(mins % 1440);
  const h = Math.floor(m / 60), mm = m % 60;
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return `${days[(d - 1) % 7]} · Day ${d} · ${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}

export function hourOf(mins: number) { return (mins % 1440) / 60; }
