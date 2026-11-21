// Converts Microsoft Rocketbox avatars + animations (MIT) from FBX/TGA to compact GLB/WebP.
// Usage: node scripts/assets/convert.mjs <vendor-dir containing three/ and rocketbox/>
import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, extname } from 'node:path';

import sharp from 'sharp';

/** Re-encode every embedded PNG as WebP and rebuild the GLB. */
async function repack(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
  const bin = buf.subarray(20 + jsonLen + 8);
  const imgViews = new Map((json.images ?? []).map((im) => [im.bufferView, im]));
  const parts = []; let off = 0;
  for (let i = 0; i < json.bufferViews.length; i++) {
    const v = json.bufferViews[i];
    let data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    const im = imgViews.get(i);
    if (im) { const meta = await sharp(data).metadata(); data = await sharp(data).webp({ quality: meta.hasAlpha ? 88 : 80, alphaQuality: 90 }).toBuffer(); im.mimeType = 'image/webp'; }
    const pad = (4 - (data.length % 4)) % 4;
    v.byteOffset = off; v.byteLength = data.length;
    parts.push(data, Buffer.alloc(pad)); off += data.length + pad;
  }
  json.buffers[0].byteLength = off;
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const binAll = Buffer.concat(parts);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + binAll.length, 8);
  const h1 = Buffer.alloc(8); h1.writeUInt32LE(js.length, 0); h1.writeUInt32LE(0x4e4f534a, 4);
  const h2 = Buffer.alloc(8); h2.writeUInt32LE(binAll.length, 0); h2.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, h1, js, h2, binAll]);
}

const vendor = process.argv[2] ?? '../vendor';
const out = 'public/assets';
mkdirSync(out, { recursive: true });
copyFileSync('scripts/assets/convert.html', join(vendor, 'convert.html'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.fbx': 'application/octet-stream', '.tga': 'application/octet-stream' };
const srv = http.createServer((req, res) => {
  const p = join(vendor, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(5310);

export const AVATARS = ['Adults/Male_Adult_01', 'Adults/Female_Adult_04', 'Professions/Business_Male_06', 'Adults/Male_Adult_08', 'Adults/Female_Adult_03', 'Professions/Police_Male_03', 'Adults/Female_Adult_17', 'Adults/Male_Adult_03', 'Professions/Medical_Female_01', 'Professions/Wood_Male_01', 'Professions/Business_Female_01', 'Adults/Male_Adult_17', 'Adults/Female_Adult_12', 'Professions/Construction_Male_01', 'Professions/Sports_Female_02', 'Adults/Male_Adult_14', 'Adults/Female_Party_02', 'Adults/Male_Adult_02', 'Adults/Male_Adult_06', 'Adults/Male_Adult_09', 'Adults/Female_Adult_01', 'Adults/Female_Adult_05', 'Adults/Female_Adult_08'];
const only = process.argv[3];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) console.log('  [page]', m.text().slice(0, 200)); });
await page.goto('http://localhost:5310/convert.html');
await page.waitForFunction(() => window.ready);

for (const a of AVATARS) {
  const name = a.split('/')[1];
  if (only && only !== 'anims' && !name.includes(only)) continue;
  if (only === 'anims') break;
  const dir = `/rocketbox/Assets/Avatars/${a}`;
  const tex = readdirSync(join(vendor, dir, 'Textures')).find((f) => f.endsWith('_body_color.tga'));
  const prefix = tex.replace('_body_color.tga', '');
  const r = await page.evaluate(async ([dir, name, prefix]) => { window.__prefix = prefix; return window.convertAvatar(dir, name); }, [dir, name, prefix]);
  const buf = await repack(Buffer.from(r.glb, 'base64'));
  writeFileSync(join(out, `${name}.glb`), buf);
  console.log(name, (buf.length / 1024).toFixed(0) + 'KB', only ? JSON.stringify(r.info) : `bones=${r.info.bones} h=${(r.info.box[1][1] - r.info.box[0][1]).toFixed(0)}`);
}
if (!only || only === 'anims') {
  for (const g of ['m', 'f']) {
    const A = '/rocketbox/Assets/Animations/all_animations_max_motextr_';
    const files = [['idle', `${A}static/${g}_idle_neutral_01.max.fbx`, 8], ['breathe', `${A}static/${g}_idle_breathe_01.max.fbx`, 0], ['walk', `${A}xy/${g}_walk_neutral.max.fbx`, 0], ['run', `${A}xy/${g}_run_neutral.max.fbx`, 0], ['talk', `${A}static/${g}_gestic_talk_neutral_01.max.fbx`, 7], ['talk2', `${A}static/${g}_gestic_talk_relaxed_01.max.fbx`, 7], ['sit', `${A}static/${g}_sit_chair_idle_neutral_01.max.fbx`, 6], ['wave', `${A}static/${g}_wave_01.max.fbx`, 0]];
    const r = await page.evaluate((files) => window.convertAnims(files), files);
    const buf = Buffer.from(r.glb, 'base64');
    writeFileSync(join(out, `anims_${g}.glb`), buf);
    console.log(`anims_${g}`, (buf.length / 1024).toFixed(0) + 'KB', JSON.stringify(r.info.map((i) => [i.name, +i.dur.toFixed(2), i.tracks, i.pos])));
  }
}
await browser.close(); srv.close();
