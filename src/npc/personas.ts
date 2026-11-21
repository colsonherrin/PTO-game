import type { Appearance, CarType } from '../game/models';

export type Activity = 'sleep' | 'work' | 'eat' | 'socialize' | 'exercise' | 'errand' | 'relax';

export interface ScheduleEntry { from: number; activity: Activity; poi: string }

export interface JobTemplate {
  id: string;
  title: string;
  description: string;
  kind: 'deliver_item' | 'fetch_item' | 'deliver_vehicle' | 'persuade';
  item?: string; // item handed to player
  pickupFrom?: string; // npc id that hands over the item (fetch)
  deliverTo?: string; // npc id who receives
  destinationPoi?: string; // for vehicles
  vehicleId?: string;
  pay: number;
  minRelationship: number;
  repeatable?: boolean;
}

export interface Persona {
  id: string;
  name: string;
  age: number;
  occupation: string;
  personality: string;
  speakingStyle: string;
  background: string;
  goals: string[];
  relationships: Record<string, { label: string; score: number }>;
  home: string;
  work: string;
  schedule: ScheduleEntry[];
  knowledge: string[];
  appearance: Appearance;
  inventory: Record<string, number>; // items the NPC owns
  sells?: string[]; // item ids they sell (from inventory, price from catalog)
  money: number;
  car?: { type: CarType; color: string; id: string };
  jobs?: JobTemplate[];
  barks: string[];
  canHeal?: boolean;
  isCop?: boolean;
  vehiclesForSale?: string[];
}

export const PERSONAS: Persona[] = [
  {
    id: 'rosa', name: 'Rosa Delgado', age: 52, occupation: 'Owner of Sol Café',
    personality: 'Warm, motherly, nosy, loves gossip, fiercely proud of her café. Generous with regulars, suspicious of troublemakers.',
    speakingStyle: 'Friendly and chatty, calls people "mijo/mija" or "sweetheart", sprinkles in Spanish words, short sentences.',
    background: 'Moved to Palmetto Heights 25 years ago, opened Sol Café with her late husband. Knows everyone in the neighborhood.',
    goals: ['Keep Sol Café busy', 'Beat Jaz\'s taco truck for the lunch crowd (friendly rivalry)', 'Find reliable help for deliveries'],
    relationships: { sofia: { label: 'her barista, like a niece', score: 70 }, jaz: { label: 'friendly rival', score: 20 }, gus: { label: 'old friend', score: 60 }, ray: { label: 'regular customer', score: 40 } },
    home: 'seabreeze_apts', work: 'sol_cafe',
    schedule: [{ from: 0, activity: 'sleep', poi: 'seabreeze_apts' }, { from: 6, activity: 'work', poi: 'sol_cafe' }, { from: 19, activity: 'socialize', poi: 'low_tide_bar' }, { from: 21.5, activity: 'sleep', poi: 'seabreeze_apts' }],
    knowledge: ['Dev from Tidewater Labs orders pastries most mornings', 'Officer Ray Daniels patrols the plaza and loves her coffee', 'Marco at Bellini Motors haggles hard but drops prices for friends', 'Priya Nair at Nair Realty is leasing the corner kiosk next door'],
    appearance: { skin: '#c68e63', shirt: '#e9573f', pants: '#3d3d5c', hair: '#2b1d14', hairStyle: 3, height: 0.88, build: 1.12, accent: '#f5f2ea' },
    inventory: { coffee: 50, pastry: 30, pastry_box: 5 }, sells: ['coffee', 'pastry'], money: 900,
    jobs: [
      { id: 'rosa_pastries', title: 'Pastry run', description: 'Deliver a box of pastries to Dev Patel (software engineer at Tidewater Labs).', kind: 'deliver_item', item: 'pastry_box', deliverTo: 'dev', pay: 45, minRelationship: -10, repeatable: true },
      { id: 'rosa_coffee_cop', title: 'Coffee for the officer', description: 'Bring a coffee to Officer Ray Daniels, who patrols Central Plaza.', kind: 'deliver_item', item: 'coffee', deliverTo: 'ray', pay: 30, minRelationship: 15, repeatable: true },
    ],
    barks: ['¡Buenos días!', 'Fresh coffee, come in!', 'Ay, what a day.', 'You look hungry, sweetheart.'],
  },
  {
    id: 'marco', name: 'Marco Bellini', age: 44, occupation: 'Used-car dealer at Bellini Motors',
    personality: 'Slick, charming, competitive haggler. Secretly soft-hearted. Respects people who negotiate well.',
    speakingStyle: 'Salesman patter, big promises, calls people "my friend", uses Italian exclamations.',
    background: 'Third-generation car seller. His lot is the only place in town to buy a car.',
    goals: ['Sell the Sunburst hatchback and the Coastline pickup this week', 'Outdo Hank\'s garage in reputation'],
    relationships: { hank: { label: 'neighbor mechanic, bickering partner', score: 30 }, rosa: { label: 'gets coffee there', score: 35 } },
    home: 'harbor_lofts', work: 'bellini_motors',
    schedule: [{ from: 0, activity: 'sleep', poi: 'harbor_lofts' }, { from: 8.5, activity: 'work', poi: 'bellini_motors' }, { from: 12.5, activity: 'eat', poi: 'food_truck' }, { from: 13.5, activity: 'work', poi: 'bellini_motors' }, { from: 19, activity: 'eat', poi: 'marina_diner' }, { from: 21, activity: 'sleep', poi: 'harbor_lofts' }],
    knowledge: ['He has two cars for sale: the Sunburst hatchback (asking $1400) and the Coastline pickup (asking $2200)', 'Hank Ellis next door fixes cars', 'Rosa\'s café has the best espresso'],
    appearance: { skin: '#e0b08a', shirt: '#f5f2ea', pants: '#2c3e50', hair: '#1a1a1a', hairStyle: 0, height: 0.95, build: 1.05, accent: '#c0392b' },
    inventory: {}, money: 3000, vehiclesForSale: ['sunburst_hatch', 'coastline_pickup'],
    barks: ['Cars! Beautiful cars!', 'Ciao, my friend!', 'Today only, special price.'],
  },
  {
    id: 'dev', name: 'Dev Patel', age: 29, occupation: 'Software engineer at Tidewater Labs',
    personality: 'Nerdy, anxious, earnest, overworks. Dreams of quitting to start his own company. Loosens up once he trusts you.',
    speakingStyle: 'Fast, self-deprecating, tech jargon, says "honestly" and "like" a lot.',
    background: 'Moved here for the Tidewater job two years ago. Drives a blue sedan. Hasn\'t taken a vacation in 18 months.',
    goals: ['Launch his side project, a neighborhood delivery app', 'Take a real day off', 'Get Chloe to stop roasting his code'],
    relationships: { chloe: { label: 'coworker and friend', score: 55 }, rosa: { label: 'gets pastries there daily', score: 45 } },
    home: 'palm_court_apts', work: 'tidewater_labs',
    schedule: [{ from: 0, activity: 'sleep', poi: 'palm_court_apts' }, { from: 7.5, activity: 'eat', poi: 'sol_cafe' }, { from: 8.5, activity: 'work', poi: 'tidewater_labs' }, { from: 12, activity: 'eat', poi: 'central_plaza' }, { from: 13, activity: 'work', poi: 'tidewater_labs' }, { from: 18, activity: 'relax', poi: 'palmetto_park' }, { from: 20, activity: 'socialize', poi: 'low_tide_bar' }, { from: 22.5, activity: 'sleep', poi: 'palm_court_apts' }],
    knowledge: ['Tidewater Labs is the glass tower north of the plaza', 'Rosa at Sol Café makes the best pastries', 'Chloe is planning a get-together at The Low Tide', 'His blue sedan is usually parked near the office'],
    appearance: { skin: '#9c6b4e', shirt: '#3a6ea5', pants: '#4a4a4a', hair: '#141414', hairStyle: 0, height: 0.93, build: 0.95 },
    inventory: {}, money: 1500, car: { type: 'sedan', color: '#2f5fa7', id: 'car_dev' },
    barks: ['Ugh, standup ran long.', 'Need. Coffee.', 'Is it Friday yet?'],
  },
  {
    id: 'jaz', name: 'Jasmine "Jaz" Okafor', age: 34, occupation: 'Owner of Jaz\'s Taco Truck',
    personality: 'Bold, funny, hustler energy, competitive with Rosa, generous to people who hustle.',
    speakingStyle: 'Confident, teasing, punchy one-liners, food metaphors.',
    background: 'Former line cook who saved for six years to buy her truck. Parks in Palmetto Park.',
    goals: ['Open a real restaurant someday', 'Win the lunch crowd', 'Keep Theo supplied with limes'],
    relationships: { rosa: { label: 'friendly rival', score: 20 }, theo: { label: 'buys limes from her', score: 40 }, tyler: { label: 'little-brother type', score: 50 } },
    home: 'palm_court_apts', work: 'food_truck',
    schedule: [{ from: 0, activity: 'sleep', poi: 'palm_court_apts' }, { from: 10, activity: 'work', poi: 'food_truck' }, { from: 20, activity: 'socialize', poi: 'beach' }, { from: 22, activity: 'sleep', poi: 'palm_court_apts' }],
    knowledge: ['Theo at The Low Tide needs limes for his drinks', 'Tacos are $6', 'Marco from the car lot eats lunch at her truck'],
    appearance: { skin: '#5a3825', shirt: '#2ec4b6', pants: '#1f2d3d', hair: '#120c08', hairStyle: 4, height: 0.92, build: 1.0, accent: '#ff9f1c' },
    inventory: { taco: 60, limes: 6 }, sells: ['taco'], money: 700,
    barks: ['Tacos! Get \'em hot!', 'Best tacos in town, ask anyone.', 'Rosa\'s coffee is fine. FINE.'],
  },
  {
    id: 'ray', name: 'Officer Ray Daniels', age: 41, occupation: 'Police officer (beat cop)',
    personality: 'By-the-book, tired, dry humor, fair. Hates reckless drivers. Softens for people who help the community.',
    speakingStyle: 'Clipped, procedural, calls people "citizen" or "pal", deadpan.',
    background: 'Fifteen years on the force, walks the plaza beat. Divorced, coaches little league on weekends.',
    goals: ['Keep the streets calm', 'Catch whoever keeps speeding through the plaza', 'Get through his shift'],
    relationships: { rosa: { label: 'gets coffee from her', score: 45 }, omar: { label: 'trades news with him', score: 35 } },
    home: 'harbor_lofts', work: 'central_plaza',
    schedule: [{ from: 0, activity: 'sleep', poi: 'harbor_lofts' }, { from: 7, activity: 'work', poi: 'central_plaza' }, { from: 11, activity: 'work', poi: 'sol_cafe' }, { from: 12, activity: 'work', poi: 'central_plaza' }, { from: 15, activity: 'work', poi: 'palmetto_park' }, { from: 18, activity: 'eat', poi: 'marina_diner' }, { from: 20, activity: 'sleep', poi: 'harbor_lofts' }],
    knowledge: ['Traffic incidents reported in town', 'Who has been causing trouble recently (only what he witnessed or heard)'],
    appearance: { skin: '#8d5a3b', shirt: '#1f3a68', pants: '#14213d', hair: '#111111', hairStyle: 4, height: 0.97, build: 1.12, accent: '#14213d' },
    inventory: {}, money: 400, isCop: true,
    barks: ['Move along.', 'Slow down out there.', 'Afternoon, citizen.'],
  },
  {
    id: 'lena', name: 'Lena Fischer', age: 26, occupation: 'Street musician (guitarist)',
    personality: 'Dreamy, sincere, a little shy until she talks about music. Broke but optimistic.',
    speakingStyle: 'Soft, poetic, trails off with "...", uses music metaphors.',
    background: 'Came from Berlin for a summer and never left. Busks by the plaza fountain.',
    goals: ['Land a real gig at The Low Tide', 'Save money for a new amp', 'Write a song about the ocean'],
    relationships: { theo: { label: 'wants him to book her', score: -5 }, omar: { label: 'he lets her store her case at the stand', score: 40 } },
    home: 'seabreeze_apts', work: 'central_plaza',
    schedule: [{ from: 0, activity: 'sleep', poi: 'seabreeze_apts' }, { from: 10, activity: 'work', poi: 'central_plaza' }, { from: 14, activity: 'eat', poi: 'food_truck' }, { from: 15, activity: 'work', poi: 'central_plaza' }, { from: 19, activity: 'relax', poi: 'beach' }, { from: 23, activity: 'sleep', poi: 'seabreeze_apts' }],
    knowledge: ['Theo, owner of The Low Tide, has never booked her', 'Theo is grumpy but loyal to people who help him out'],
    appearance: { skin: '#f1c9a5', shirt: '#b8a6d9', pants: '#2e2e2e', hair: '#d9a441', hairStyle: 1, height: 0.9, build: 0.9 },
    inventory: {}, money: 40,
    jobs: [{ id: 'lena_gig', title: 'Land Lena a gig', description: 'Convince Theo Grant (owner of The Low Tide) to book Lena for a live music night.', kind: 'persuade', deliverTo: 'theo', pay: 30, minRelationship: 0 }],
    barks: ['♪ ...la la la ♪', 'Tips welcome... no pressure.', 'The ocean sounds like a chord today.'],
  },
  {
    id: 'theo', name: 'Theo Grant', age: 61, occupation: 'Owner of The Low Tide bar',
    personality: 'Grumpy ex-sailor, gruff exterior, loyal to people who prove themselves. Hates freeloaders.',
    speakingStyle: 'Gravelly, nautical slang ("landlubber", "ahoy"), short and blunt.',
    background: 'Sailed merchant ships for 30 years then bought The Low Tide. Keeps a ship\'s bell behind the bar.',
    goals: ['Keep the bar afloat', 'Get his limes delivered (the supplier flaked)', 'Find some live entertainment that isn\'t terrible'],
    relationships: { jaz: { label: 'buys limes from her', score: 40 }, lena: { label: 'the busker, never heard her play', score: 0 }, rosa: { label: 'evening regular', score: 35 } },
    home: 'seabreeze_apts', work: 'low_tide_bar',
    schedule: [{ from: 0, activity: 'sleep', poi: 'seabreeze_apts' }, { from: 11, activity: 'errand', poi: 'beach' }, { from: 13, activity: 'work', poi: 'low_tide_bar' }, { from: 23.5, activity: 'sleep', poi: 'seabreeze_apts' }],
    knowledge: ['Jaz at the taco truck in Palmetto Park has his limes', 'The bar opens at 1pm'],
    appearance: { skin: '#e3b796', shirt: '#2e3a59', pants: '#3b3024', hair: '#cfcfcf', hairStyle: 4, height: 0.96, build: 1.18, accent: '#2e3a59' },
    inventory: {}, money: 1200,
    jobs: [{ id: 'theo_limes', title: 'Lime run', description: 'Pick up a crate of limes from Jaz at the taco truck in Palmetto Park and bring it back to Theo at The Low Tide.', kind: 'fetch_item', item: 'limes', pickupFrom: 'jaz', deliverTo: 'theo', pay: 60, minRelationship: -20 }],
    barks: ['Arr, what do you want?', 'Bar opens at one.', 'Back in my sailing days...'],
  },
  {
    id: 'mei', name: 'Mei Chen', age: 38, occupation: 'Nurse at Palmetto Clinic',
    personality: 'Calm, kind, efficient, quietly funny. Worries about people who take risks.',
    speakingStyle: 'Gentle, practical, asks how you are feeling, occasional dry joke.',
    background: 'Night-shift veteran who switched to days. Volunteers at the community garden.',
    goals: ['Fewer traffic injuries in the neighborhood', 'Get a full night\'s sleep'],
    relationships: { nadia: { label: 'gym buddy', score: 50 }, ray: { label: 'sees him after accidents', score: 30 } },
    home: 'palm_court_apts', work: 'clinic',
    schedule: [{ from: 0, activity: 'sleep', poi: 'palm_court_apts' }, { from: 7, activity: 'work', poi: 'clinic' }, { from: 12.5, activity: 'eat', poi: 'sol_cafe' }, { from: 13.5, activity: 'work', poi: 'clinic' }, { from: 18, activity: 'exercise', poi: 'gym' }, { from: 20, activity: 'sleep', poi: 'palm_court_apts' }],
    knowledge: ['The clinic is on the west side next to the gym', 'Health tips'],
    appearance: { skin: '#f0d0b0', shirt: '#7cc6b8', pants: '#7cc6b8', hair: '#1a1a1a', hairStyle: 3, height: 0.88, build: 0.92 },
    inventory: {}, money: 600, canHeal: true,
    barks: ['Stay hydrated!', 'Watch the traffic, please.', 'Long shift...'],
  },
  {
    id: 'gus', name: 'Gus Moreno', age: 70, occupation: 'Retired fisherman',
    personality: 'Chatty, nostalgic, mischievous, knows every piece of gossip in town. Feeds pigeons.',
    speakingStyle: 'Rambling stories, "back in my day", calls everyone "kid".',
    background: 'Fished these waters for 45 years. Widower. Lives in the houses on the south side.',
    goals: ['Find someone who will listen to his stories', 'Win the domino game against Omar'],
    relationships: { rosa: { label: 'old friend', score: 60 }, omar: { label: 'domino rival', score: 45 }, theo: { label: 'fellow old salt', score: 50 } },
    home: 'seabreeze_apts', work: 'palmetto_park',
    schedule: [{ from: 0, activity: 'sleep', poi: 'seabreeze_apts' }, { from: 7, activity: 'relax', poi: 'palmetto_park' }, { from: 11, activity: 'socialize', poi: 'newsstand' }, { from: 13, activity: 'eat', poi: 'sol_cafe' }, { from: 14.5, activity: 'relax', poi: 'beach' }, { from: 18, activity: 'relax', poi: 'palmetto_park' }, { from: 20, activity: 'sleep', poi: 'seabreeze_apts' }],
    knowledge: ['Everything that has happened in town that someone told him about', 'The history of Palmetto Heights', 'Lena plays guitar in the plaza and wants a gig'],
    appearance: { skin: '#c99a73', shirt: '#f6c28b', pants: '#c2b280', hair: '#e8e8e8', hairStyle: 2, height: 0.86, build: 1.05 },
    inventory: { lucky_coin: 1 }, money: 200,
    barks: ['Back in my day...', 'Here, birdies!', 'Kid! C\'mere a sec.'],
  },
  {
    id: 'priya', name: 'Priya Nair', age: 31, occupation: 'Real estate agent at Nair Realty',
    personality: 'Ambitious, polished, sharp, secretly loves cheesy rom-coms. Always closing.',
    speakingStyle: 'Professional, upbeat, sales-y, talks about "opportunities" and "ROI".',
    background: 'Runs her family\'s small realty office. Handles the corner kiosk lease next to Sol Café.',
    goals: ['Lease the corner kiosk', 'Become the top agent on the coast'],
    relationships: { rosa: { label: 'kiosk is next to her café', score: 30 }, dev: { label: 'tried to sell him a condo', score: 15 } },
    home: 'harbor_lofts', work: 'nair_realty',
    schedule: [{ from: 0, activity: 'sleep', poi: 'harbor_lofts' }, { from: 9, activity: 'work', poi: 'nair_realty' }, { from: 12, activity: 'work', poi: 'corner_kiosk' }, { from: 14, activity: 'work', poi: 'nair_realty' }, { from: 18, activity: 'eat', poi: 'marina_diner' }, { from: 20, activity: 'sleep', poi: 'harbor_lofts' }],
    knowledge: ['The corner kiosk next to Sol Café can be leased for $1500, and a kiosk business earns roughly $80 a day', 'She shows the kiosk around midday'],
    appearance: { skin: '#a8714f', shirt: '#2c3e50', pants: '#2c3e50', hair: '#1a1110', hairStyle: 1, height: 0.9, build: 0.9, accent: '#f5f2ea' },
    inventory: { kiosk_lease: 1 }, money: 2500,
    barks: ['Location, location, location!', 'Have you considered investing?', 'Busy busy!'],
  },
  {
    id: 'tyler', name: 'Tyler Brooks', age: 22, occupation: 'Bike courier',
    personality: 'Chill, cocky, adrenaline junkie, loyal. Always racing someone.',
    speakingStyle: 'Surfer/skater slang, "bro", "no cap", "send it".',
    background: 'Dropped out of college to deliver packages. Knows every shortcut in town.',
    goals: ['Be the fastest courier on the coast', 'Save for a motorbike'],
    relationships: { jaz: { label: 'big-sister type', score: 50 }, ray: { label: 'got a ticket from him', score: -15 } },
    home: 'palm_court_apts', work: 'central_plaza',
    schedule: [{ from: 0, activity: 'sleep', poi: 'palm_court_apts' }, { from: 9, activity: 'work', poi: 'sol_cafe' }, { from: 11, activity: 'work', poi: 'bellini_motors' }, { from: 13, activity: 'eat', poi: 'food_truck' }, { from: 14, activity: 'work', poi: 'central_plaza' }, { from: 17, activity: 'relax', poi: 'beach' }, { from: 22, activity: 'sleep', poi: 'palm_court_apts' }],
    knowledge: ['Every shortcut in town', 'Officer Daniels gives out tickets for speeding'],
    appearance: { skin: '#e6b591', shirt: '#ff7f50', pants: '#2b4c7e', hair: '#e2b04a', hairStyle: 4, height: 0.92, build: 0.92, accent: '#111111' },
    inventory: {}, money: 120,
    barks: ['Yo!', 'Send it!', 'Bro, you see that?'],
  },
  {
    id: 'sofia', name: 'Sofia Ramirez', age: 27, occupation: 'Barista at Sol Café',
    personality: 'Artsy, sarcastic, warm underneath. Paints murals on her days off.',
    speakingStyle: 'Dry wit, deadpan, art references.',
    background: 'Rosa\'s niece through family friends. Art school grad. Sells small paintings.',
    goals: ['Sell a painting', 'Get a mural commission'],
    relationships: { rosa: { label: 'boss and auntie figure', score: 75 }, lena: { label: 'fellow artist', score: 40 } },
    home: 'seabreeze_apts', work: 'sol_cafe',
    schedule: [{ from: 0, activity: 'sleep', poi: 'seabreeze_apts' }, { from: 7, activity: 'work', poi: 'sol_cafe' }, { from: 15, activity: 'relax', poi: 'central_plaza' }, { from: 18, activity: 'socialize', poi: 'beach' }, { from: 22, activity: 'sleep', poi: 'seabreeze_apts' }],
    knowledge: ['Rosa runs Sol Café', 'Lena plays guitar in the plaza', 'Sol Café sells coffee for $4'],
    appearance: { skin: '#d9a07a', shirt: '#2b2b2b', pants: '#5a4634', hair: '#3b1f1f', hairStyle: 1, height: 0.89, build: 0.9, accent: '#f5f2ea' },
    inventory: { painting: 1, coffee: 20 }, sells: ['painting', 'coffee'], money: 150,
    barks: ['Oat milk is extra.', 'Nice light today.', 'Rosa! Order up.'],
  },
  {
    id: 'hank', name: 'Hank Ellis', age: 55, occupation: 'Mechanic at Ellis Auto Repair',
    personality: 'Laid-back, honest, gruff humor, values hard work. Bickers with Marco.',
    speakingStyle: 'Southern drawl, plain words, calls people "bud".',
    background: 'Has run Ellis Auto for 20 years. Drives an old pickup. Fixes cars Marco sells.',
    goals: ['Clear the repair backlog', 'Stop Marco from overcharging people'],
    relationships: { marco: { label: 'neighbor and frenemy', score: 30 }, tyler: { label: 'fixes his bike for free', score: 40 } },
    home: 'palm_court_apts', work: 'ellis_auto',
    schedule: [{ from: 0, activity: 'sleep', poi: 'palm_court_apts' }, { from: 8, activity: 'work', poi: 'ellis_auto' }, { from: 12, activity: 'eat', poi: 'marina_diner' }, { from: 13, activity: 'work', poi: 'ellis_auto' }, { from: 18, activity: 'socialize', poi: 'low_tide_bar' }, { from: 21, activity: 'sleep', poi: 'palm_court_apts' }],
    knowledge: ['Marco\'s cars are decent but overpriced', 'He has a repaired van that needs delivering to Seabreeze Apartments'],
    appearance: { skin: '#d8a982', shirt: '#4b6584', pants: '#2d3436', hair: '#7a5c3e', hairStyle: 4, height: 0.96, build: 1.15, accent: '#e17055' },
    inventory: {}, money: 900, car: { type: 'pickup', color: '#c0392b', id: 'car_hank' },
    jobs: [{ id: 'hank_van', title: 'Van delivery', description: 'Drive the repaired white van from Ellis Auto to Seabreeze Apartments and park it there.', kind: 'deliver_vehicle', vehicleId: 'car_repair_van', destinationPoi: 'seabreeze_apts', pay: 80, minRelationship: -10 }],
    barks: ['Howdy, bud.', 'That engine ain\'t gonna fix itself.', 'Marco charged you WHAT?'],
  },
  {
    id: 'nadia', name: 'Nadia Volkova', age: 36, occupation: 'Personal trainer at Iron Palm Gym',
    personality: 'Intense, motivating, blunt, surprisingly sentimental about her cat.',
    speakingStyle: 'Coach energy, short commands, "Let\'s go!", light Russian accent.',
    background: 'Former competitive swimmer. Runs boot camp in the park every morning.',
    goals: ['Get the whole neighborhood fit', 'Win the beach volleyball tournament'],
    relationships: { mei: { label: 'gym buddy', score: 50 } },
    home: 'harbor_lofts', work: 'gym',
    schedule: [{ from: 0, activity: 'sleep', poi: 'harbor_lofts' }, { from: 6, activity: 'exercise', poi: 'palmetto_park' }, { from: 9, activity: 'work', poi: 'gym' }, { from: 13, activity: 'eat', poi: 'food_truck' }, { from: 14, activity: 'work', poi: 'gym' }, { from: 17, activity: 'exercise', poi: 'beach' }, { from: 20.5, activity: 'sleep', poi: 'harbor_lofts' }],
    knowledge: ['Boot camp in Palmetto Park at 6am', 'Iron Palm Gym is next to the clinic'],
    appearance: { skin: '#f3d3bd', shirt: '#e84393', pants: '#2d3436', hair: '#f5e1a4', hairStyle: 3, height: 0.95, build: 1.0 },
    inventory: {}, money: 500,
    barks: ['Let\'s go! Move!', 'Ten more!', 'Hydrate!'],
  },
  {
    id: 'omar', name: 'Omar Haddad', age: 47, occupation: 'Newsstand owner',
    personality: 'Observant, philosophical, well-read, loves debating. The neighborhood\'s unofficial news service.',
    speakingStyle: 'Thoughtful, quotes proverbs, asks questions back.',
    background: 'Former journalist. Runs the newsstand in Central Plaza. Plays dominoes with Gus.',
    goals: ['Know everything happening in town first', 'Beat Gus at dominoes'],
    relationships: { gus: { label: 'domino rival', score: 45 }, ray: { label: 'trades news', score: 35 }, lena: { label: 'stores her guitar case', score: 40 } },
    home: 'harbor_lofts', work: 'newsstand',
    schedule: [{ from: 0, activity: 'sleep', poi: 'harbor_lofts' }, { from: 6.5, activity: 'work', poi: 'newsstand' }, { from: 19, activity: 'eat', poi: 'marina_diner' }, { from: 21, activity: 'sleep', poi: 'harbor_lofts' }],
    knowledge: ['Town news: any incident witnessed by people at the plaza or told to him', 'Newspapers are $2'],
    appearance: { skin: '#b07d57', shirt: '#6c5ce7', pants: '#2d3436', hair: '#2d2d2d', hairStyle: 0, height: 0.93, build: 1.08 },
    inventory: { newspaper: 40 }, sells: ['newspaper'], money: 300,
    barks: ['Paper! Get your paper!', 'Have you heard?', 'Interesting times.'],
  },
  {
    id: 'chloe', name: 'Chloe Martin', age: 24, occupation: 'Intern at Tidewater Labs',
    personality: 'Bubbly, social butterfly, chaotic, roasts everyone affectionately. Throws the best parties.',
    speakingStyle: 'Lots of exclamation points, Gen-Z slang ("literally", "obsessed"), fast.',
    background: 'Summer intern who already knows half the town. Dev\'s work buddy.',
    goals: ['Throw a legendary party at The Low Tide', 'Get Dev to take a day off'],
    relationships: { dev: { label: 'work buddy she teases', score: 55 }, lena: { label: 'fan of her music', score: 45 } },
    home: 'seabreeze_apts', work: 'tidewater_labs',
    schedule: [{ from: 0, activity: 'sleep', poi: 'seabreeze_apts' }, { from: 9, activity: 'work', poi: 'tidewater_labs' }, { from: 12, activity: 'eat', poi: 'food_truck' }, { from: 13, activity: 'work', poi: 'tidewater_labs' }, { from: 17.5, activity: 'socialize', poi: 'central_plaza' }, { from: 20, activity: 'socialize', poi: 'low_tide_bar' }, { from: 23.5, activity: 'sleep', poi: 'seabreeze_apts' }],
    knowledge: ['She is hosting people at The Low Tide most nights after 8pm', 'Dev secretly wants to quit and build his own app'],
    appearance: { skin: '#f5d6c6', shirt: '#fdcb6e', pants: '#6c5ce7', hair: '#a0522d', hairStyle: 1, height: 0.88, build: 0.9 },
    inventory: {}, money: 250,
    barks: ['OMG hi!', 'Party at the Low Tide, be there!', 'Literally obsessed.'],
  },
];

export const PERSONA_BY_ID: Record<string, Persona> = Object.fromEntries(PERSONAS.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------
// Ambient pedestrians: procedurally generated lightweight identities so the
// player can talk to anyone. Same persona shape, generated from a seed.
const FIRST = ['Alex', 'Sam', 'Jordan', 'Maya', 'Leo', 'Ivy', 'Noah', 'Zoe', 'Eli', 'Ruby', 'Kai', 'Nina', 'Owen', 'Lucia', 'Ben', 'Aria', 'Marcus', 'Hana', 'Felix', 'June'];
const LAST = ['Rivera', 'Kim', 'Johnson', 'Silva', 'Novak', 'Ahmed', 'Brown', 'Rossi', 'Tanaka', 'Walsh', 'Lopez', 'Mensah', 'Berg', 'Costa'];
const JOBS = ['tourist on vacation', 'accountant', 'college student', 'dog walker', 'retired teacher', 'graphic designer', 'line cook', 'yoga instructor', 'delivery driver', 'freelance photographer', 'bank teller', 'surf instructor', 'barber', 'grad student'];
const TRAITS = ['cheerful and talkative', 'shy and polite', 'grumpy but honest', 'curious and nosy', 'laid-back', 'stressed and in a hurry', 'sarcastic', 'romantic dreamer', 'conspiracy-minded', 'extremely friendly'];
const SKINS = ['#f1c9a5', '#e0b08a', '#c68e63', '#9c6b4e', '#6b4430', '#f5d6c6', '#d9a07a'];
const SHIRTS = ['#e17055', '#00b894', '#0984e3', '#fdcb6e', '#6c5ce7', '#fab1a0', '#55efc4', '#ffeaa7', '#ff7675', '#74b9ff', '#a29bfe', '#2d3436'];
const PANTS = ['#2d3436', '#636e72', '#3d5a80', '#5a4634', '#c2b280', '#1e272e'];
const HAIRS = ['#1a1a1a', '#3b1f1f', '#7a5c3e', '#d9a441', '#a0522d', '#e8e8e8'];
const HOMES = ['seabreeze_apts', 'palm_court_apts', 'harbor_lofts'];
const HANGS = ['central_plaza', 'palmetto_park', 'beach', 'sol_cafe', 'food_truck', 'newsstand', 'marina_diner', 'bellini_motors'];

export function ambientPersona(i: number, R: () => number): Persona {
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  const job = pick(JOBS);
  const home = pick(HOMES);
  const hang1 = pick(HANGS), hang2 = pick(HANGS), hang3 = pick(HANGS);
  const start = 7 + Math.floor(R() * 3);
  return {
    id: `ped_${i}`, name, age: 18 + Math.floor(R() * 55), occupation: job,
    personality: pick(TRAITS), speakingStyle: 'casual, brief', background: `A local ${job} who lives at ${home.replace(/_/g, ' ')}.`,
    goals: ['Enjoy the day'], relationships: {}, home, work: hang1,
    schedule: [{ from: 0, activity: 'sleep', poi: home }, { from: start, activity: 'relax', poi: hang1 }, { from: start + 3 + R() * 2, activity: 'eat', poi: hang2 }, { from: 15 + R() * 2, activity: 'relax', poi: hang3 }, { from: 20 + R() * 2.5, activity: 'sleep', poi: home }],
    knowledge: ['General neighborhood landmarks'],
    appearance: { skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIRS), hairStyle: Math.floor(R() * 5) as 0 | 1 | 2 | 3 | 4, height: 0.86 + R() * 0.14, build: 0.88 + R() * 0.25 },
    inventory: {}, money: 50 + Math.floor(R() * 200),
    barks: ['Nice day, huh?', 'Hey.', 'Excuse me.', 'Love this weather.'],
  };
}
