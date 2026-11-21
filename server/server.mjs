// PTO server — zero dependencies. Serves the built game and proxies LLM calls so the
// OpenRouter key never reaches the browser. Usage: OPENROUTER_API_KEY=... node server/server.mjs
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// minimal .env loader
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(process.env.PORT ?? 5173);
const KEY = process.env.OPENROUTER_API_KEY ?? '';
const BASE = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const MAX_TOKENS = Number(process.env.PTO_MAX_TOKENS ?? 900);
const RPM = Number(process.env.PTO_RATE_LIMIT_RPM ?? 40);
const BUDGET = Number(process.env.PTO_SERVER_BUDGET_USD ?? 2);
const ALLOWED = (process.env.PTO_ALLOWED_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

let spent = 0;
const hits = new Map();

function rateOk(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60000);
  if (arr.length >= RPM) return false;
  arr.push(now); hits.set(ip, arr);
  return true;
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, ai: !!KEY, spentUSD: +spent.toFixed(6), budgetUSD: BUDGET });
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    if (!KEY) return send(res, 503, { error: { message: 'OPENROUTER_API_KEY not configured' } });
    if (spent >= BUDGET) return send(res, 429, { error: { message: 'server AI budget exhausted' } });
    if (!rateOk(req.socket.remoteAddress ?? 'x')) return send(res, 429, { error: { message: 'rate limited' } });
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) return send(res, 413, { error: { message: 'too large' } }); }
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: { message: 'bad json' } }); }
    if (ALLOWED.length && !ALLOWED.includes(body.model)) return send(res, 400, { error: { message: `model not allowed: ${body.model}` } });
    body.max_tokens = Math.min(Number(body.max_tokens) || 200, MAX_TOKENS);
    body.usage = { include: true };
    try {
      const r = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'X-Title': 'PTO - Paid Time Off' },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      try { const j = JSON.parse(text); if (j.usage?.cost) spent += j.usage.cost; } catch { /* passthrough */ }
      return send(res, r.status, text);
    } catch (e) {
      return send(res, 502, { error: { message: String(e) } });
    }
  }
  // static: single-file build
  const file = join(root, 'dist', 'index.html');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (!existsSync(file)) return send(res, 500, 'Run "npm run build" first.', 'text/plain');
    return send(res, 200, readFileSync(file), 'text/html; charset=utf-8');
  }
  if (url.pathname.startsWith('/assets/')) {
    const f = join(root, 'dist', normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (f.startsWith(join(root, 'dist', 'assets')) && existsSync(f)) {
      const type = f.endsWith('.glb') ? 'model/gltf-binary' : f.endsWith('.webp') ? 'image/webp' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
      return res.end(readFileSync(f));
    }
  }
  send(res, 404, 'Not found', 'text/plain');
});

server.listen(PORT, () => {
  console.log(`PTO running at http://localhost:${PORT}  (live AI: ${KEY ? 'ON via server key' : 'off — simulated dialogue, or paste a key in Settings'})`);
});
