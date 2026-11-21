// End-to-end gameplay test in a real (headless) Chrome. Starts the server, plays through
// the core loops and writes screenshots to ./screenshots. Usage: npm run build && npm run test:e2e
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = 5199;
mkdirSync('screenshots', { recursive: true });
const server = spawn('node', ['server/server.mjs'], { env: { ...process.env, PORT: String(PORT), OPENROUTER_API_KEY: '' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 560 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `screenshots/${n}.png` });
const until = async (fn, arg, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(fn, arg)) return true; await wait(250); } return false; };
const send = async (text) => { await page.fill('#dlg-input', text); await page.press('#dlg-input', 'Enter'); await until(() => !document.querySelector('#dlg-input').disabled, null, 15000); await wait(150); };
const lastNpcMsg = () => ev(() => [...document.querySelectorAll('#dlg-log .msg.npc span')].pop()?.textContent ?? '');
const teleportTo = (id) => ev((id) => { const g = window.pto; const n = g.npcById.get(id); const poi = g.city.getPOI(n.atPoi ?? n.p.work); const dx = poi.door[0] - n.x, dz = poi.door[1] - n.z, dl = Math.hypot(dx, dz) || 1; for (const o of g.npcs) if (o !== n && Math.hypot(o.x - n.x, o.z - n.z) < 4) { o.x += 6; } g.player.x = n.x + dx / dl * 1.2; g.player.z = n.z + dz / dl * 1.2; g.player.yaw = Math.atan2(n.x - g.player.x, n.z - g.player.z); g.cam.yaw = g.player.yaw; return [n.x, n.z, n.hidden]; }, id);
const sim = (s) => ev((s) => window.pto.simulate(s), s);
const pressKey = async (k) => { await page.keyboard.down(k); await sim(0.05); await page.keyboard.up(k); await wait(50); };
const pressE = () => pressKey('KeyE');

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => indexedDB.deleteDatabase('pto-save'));
  await page.reload();
  check('game boots (WebGL2 + world build)', await until(() => !!window.pto && document.getElementById('loading').style.display === 'none'));
  await wait(1200);
  await shot('01-title');
  await ev(() => document.getElementById('btn-new').click());
  await wait(1500);
  const stats = await ev(() => ({ npcs: window.pto.npcs.length, named: window.pto.npcs.filter((n) => n.important).length, veh: window.pto.vehicles.length, colliders: window.pto.city.colliders.length }));
  check('15+ unique named NPCs', stats.named >= 15, `${stats.named} named + ${stats.npcs - stats.named} ambient, ${stats.veh} vehicles`);
  await shot('02-start');

  // --- movement
  const p0 = await ev(() => [window.pto.player.x, window.pto.player.z]);
  await page.keyboard.down('KeyW'); await sim(1.2); await page.keyboard.up('KeyW');
  const p1 = await ev(() => [window.pto.player.x, window.pto.player.z]);
  check('WASD moves the player', Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 1.5, `moved ${Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(1)} m`);

  // --- talk to Rosa, introduce, get a job
  await teleportTo('rosa'); await wait(300);
  await pressE();
  check('E opens conversation with Rosa', await ev(() => document.getElementById('dialogue').classList.contains('open')));
  await send("Hi! I'm Colson, just got into town.");
  check('Rosa learns the player name', await ev(() => window.pto.npcById.get('rosa').knowsPlayerAs === 'Colson'), await lastNpcMsg());
  await send('Got any work for me?');
  const offer = await ev(() => document.querySelector('#dlg-offers .offer-title')?.textContent ?? '');
  check('Rosa offers a job via offer_job action', /Job:/.test(offer), offer);
  await shot('03-dialogue-job-offer');
  await ev(() => document.querySelector('#dlg-offers .qa.primary').click());
  const job = await ev(() => ({ jobs: window.pto.jobs.map((j) => j.templateId + ':' + j.status), inv: window.pto.player.inventory }));
  check('Job accepted, pastry box in inventory', job.jobs.includes('rosa_pastries:active') && job.inv.pastry_box === 1, JSON.stringify(job));
  await ev(() => window.pto.dialogue.close());

  // --- Jump to lunch: Dev eats at Central Plaza. Deliver.
  await ev(() => { const g = window.pto; g.minutes = 12 * 60 + 10; for (const n of g.npcs) if (n.mode === 'routine') n.syncToSchedule(g.minutes, g.city); });
  await wait(400);
  const devPos = await teleportTo('dev');
  check('Dev follows his schedule (lunch at the plaza, visible)', !devPos[2], `Dev at ${devPos.map((v) => typeof v === 'number' ? v.toFixed(0) : v)}`);
  await pressE();
  const moneyBefore = await ev(() => window.pto.player.money);
  const qa = await ev(() => [...document.querySelectorAll('#dlg-quick .qa')].map((b) => b.textContent));
  check('Delivery quick action appears for the recipient', qa.some((t) => /Hand over/.test(t)), qa.join(' | ') + ' with ' + (await ev(() => document.getElementById('dlg-name').textContent + ' open=' + document.getElementById('dialogue').classList.contains('open') + ' inv=' + JSON.stringify(window.pto.player.inventory) + ' jobs=' + JSON.stringify(window.pto.jobs))));
  await ev(() => [...document.querySelectorAll('#dlg-quick .qa')].find((b) => /Hand over/.test(b.textContent)).click());
  await wait(1200);
  const after = await ev(() => ({ money: window.pto.player.money, rosaRel: window.pto.npcById.get('rosa').relationship, rosaMem: window.pto.npcById.get('rosa').memories.slice(-1)[0]?.text }));
  check('Job completes: paid + persistent consequence on Rosa', after.money === moneyBefore + 45 && after.rosaRel > 5, JSON.stringify(after));
  await shot('04-delivery');

  // --- Ask Dev for a ride (NPC decision → real in-world action)
  await send("Hey Dev, I'm Colson. Can you give me a ride to the beach?");
  const ride = await ev(() => window.pto.ride && { phase: window.pto.ride.phase, dest: window.pto.ride.dest });
  check('Dev agrees and starts a ride (drive_to action)', ride && ride.dest === 'beach', JSON.stringify(ride));
  await sim(2);
  await sim(40);
  check('Dev walks to his car and gets in', await ev(() => window.pto.ride?.phase === 'wait'), await ev(() => window.pto.ride?.phase));
  await ev(() => { const g = window.pto; const v = g.vehById.get(g.ride.vehId); const [sx, sz] = v.sidePoint(1); g.player.x = sx; g.player.z = sz; });
  await wait(300);
  await pressE();
  check('Player boards as passenger', await ev(() => window.pto.player.passengerIn === 'car_dev'));
  await sim(4);
  await shot('05-ride');
  let arrived = false;
  for (let i = 0; i < 40 && !arrived; i++) { await sim(4); arrived = await ev(() => !window.pto.ride && !window.pto.player.passengerIn); }
  const ppos = await ev(() => [window.pto.player.x, window.pto.player.z, window.pto.locationName(window.pto.player.x, window.pto.player.z)]);
  check('Dev drives the player to the beach and drops them off', arrived && ppos[0] > 280, `player at ${ppos[0].toFixed(0)},${ppos[1].toFixed(0)} (${ppos[2]})`);
  await shot('06-beach');

  // --- Drive the rental car
  await ev(() => { const g = window.pto; const v = g.vehById.get('car_rental'); const [sx, sz] = v.sidePoint(1); g.player.x = sx; g.player.z = sz; g.cam.yaw = v.yaw; });
  await wait(300);
  await pressKey('KeyF');
  check('F enters the rental car', await ev(() => window.pto.player.vehicleId === 'car_rental'));
  const c0 = await ev(() => { const v = window.pto.vehById.get('car_rental'); return [v.x, v.z]; });
  await page.keyboard.down('KeyW'); await sim(2.5);
  const spd = await ev(() => window.pto.vehById.get('car_rental').speed);
  await shot('07-driving');
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyS'); await sim(1.8); await page.keyboard.up('KeyS');
  const c1 = await ev(() => { const v = window.pto.vehById.get('car_rental'); return [v.x, v.z]; });
  check('Car accelerates and moves', spd > 5 && Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) > 8, `top speed ${spd.toFixed(1)} m/s, moved ${Math.hypot(c1[0] - c0[0], c1[1] - c0[1]).toFixed(0)} m`);
  await ev(() => { const v = window.pto.vehById.get('car_rental'); v.speed = 0; window.pto.exitVehicle(); });

  // --- Negotiate a car with Marco
  await ev(() => { const g = window.pto; g.minutes = 10 * 60; for (const n of g.npcs) if (n.mode === 'routine') n.syncToSchedule(g.minutes, g.city); });
  await teleportTo('marco'); await wait(200); await pressE();
  await send("I'm looking to buy a car. I'll give you $900 for the hatchback.");
  const counter = await ev(() => document.querySelector('#dlg-offers .offer-detail')?.textContent ?? '');
  check('Marco negotiates (counter-offer above his floor)', /Price: \$1,?\d{3}/.test(counter), `${await lastNpcMsg()} | ${counter}`);
  await ev(() => window.pto.dialogue.close());

  // --- Leave and return: Rosa remembers
  await ev(() => { const g = window.pto; g.minutes = 15 * 60; for (const n of g.npcs) if (n.mode === 'routine') n.syncToSchedule(g.minutes, g.city); });
  await teleportTo('rosa'); await wait(200); await pressE();
  const greet = await lastNpcMsg();
  check('Rosa remembers Colson when he returns', /Colson/.test(greet), greet);
  await send('What do you think of me?');
  await shot('08-rosa-remembers');
  await ev(() => window.pto.dialogue.close());

  // --- Non-omniscience: an NPC who never met the player does not know the name
  const theo = await ev(() => window.pto.npcById.get('theo').knowsPlayerAs);
  check('NPCs who were never told the name do not know it', theo === null || theo === undefined || (await ev(() => !!window.pto.npcById.get('theo').flags.nameFrom)), String(theo));

  // --- Save, reload, continue
  await ev(() => window.pto.saveGame(true));
  const snapshot = await ev(() => ({ money: window.pto.player.money, rosaRel: window.pto.npcById.get('rosa').relationship, mem: window.pto.npcById.get('rosa').memories.length }));
  await page.reload();
  await until(() => !!window.pto && document.getElementById('btn-continue').style.display !== 'none', null, 20000);
  await ev(() => document.getElementById('btn-continue').click());
  await wait(1500);
  const restored = await ev(() => ({ money: window.pto.player.money, rosaRel: window.pto.npcById.get('rosa').relationship, mem: window.pto.npcById.get('rosa').memories.length, name: window.pto.npcById.get('rosa').knowsPlayerAs, jobs: window.pto.jobs.length }));
  check('Save/load restores money, memories and relationships', restored.money === snapshot.money && restored.rosaRel === snapshot.rosaRel && restored.name === 'Colson' && restored.mem >= snapshot.mem, JSON.stringify(restored));

  // --- Night time render
  await ev(() => { window.pto.minutes = 21.5 * 60; });
  await wait(1500);
  await shot('09-night');
  const fps = await ev(async () => { const g = window.pto; const f0 = g.frame, t0 = performance.now(); await new Promise((r) => setTimeout(r, 3000)); return ((g.frame - f0) * 1000) / (performance.now() - t0); });
  check('No uncaught runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`Headless software-rendered FPS (SwiftShader, no GPU): ${fps.toFixed(1)}`);
  results.push({ name: 'fps_swiftshader', ok: true, detail: fps.toFixed(1) });
} catch (e) {
  check('e2e script crashed', false, String(e));
} finally {
  writeFileSync('screenshots/e2e-results.json', JSON.stringify(results, null, 2));
  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
