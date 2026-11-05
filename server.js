// Feynman Voice Tutor - tiny Node server.
//   GET  /             static app (public/)
//   GET  /api/config   what this server can do
//   POST /api/turn     streams the tutor's reply (Claude) as Server-Sent Events
//   POST /api/tts      optional studio-quality voice (ElevenLabs) when ELEVENLABS_API_KEY is set
//
// Env: ANTHROPIC_API_KEY (or any credential the Anthropic SDK resolves), PORT, TUTOR_MODEL,
//      TUTOR_EFFORT, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './public/js/prompt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, 'public');
const PORT = +process.env.PORT || 3000;
const MODEL = process.env.TUTOR_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.TUTOR_EFFORT || 'low';          // voice needs fast first tokens
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';

const hasCreds = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
const client = new Anthropic();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

async function readJson(req, limit = 512 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 }); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw.slice(-60)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.slice(0, 6000);
    if (!content.trim()) continue;
    // keep strict user/assistant alternation
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += '\n' + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

async function handleTurn(req, res) {
  const body = await readJson(req);
  const messages = sanitizeMessages(body.messages);
  if (!messages) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":"messages must end with a user turn"}'); }
  const live = body.mode === 'live';

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: live ? 1500 : 3000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages,
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }, { signal: controller.signal });

    stream.on('text', t => send({ t }));
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') send({ t: '\n@say Let\'s get back to our topic. What do you think happens next?\n' });
    send({ done: true, stop: final.stop_reason, usage: final.usage });
  } catch (err) {
    if (controller.signal.aborted) return;
    console.error('[turn]', err?.status || '', err?.message || err);
    let msg = 'tutor error';
    if (err instanceof Anthropic.AuthenticationError) msg = 'Server has no valid Anthropic credentials';
    else if (err instanceof Anthropic.RateLimitError) msg = 'Rate limited, try again shortly';
    else if (err instanceof Anthropic.APIError) msg = `Claude API error ${err.status ?? ''}`.trim();
    send({ error: msg });
  } finally {
    res.end();
  }
}

async function handleTts(req, res) {
  if (!ELEVEN_KEY) { res.writeHead(404); return res.end(); }
  const { text } = await readJson(req, 16 * 1024);
  if (!text || typeof text !== 'string') { res.writeHead(400); return res.end(); }
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ELEVEN_VOICE)}/stream?optimize_streaming_latency=3`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVEN_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: text.slice(0, 800), model_id: ELEVEN_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
  });
  if (!r.ok || !r.body) { console.error('[tts]', r.status); res.writeHead(502); return res.end(); }
  res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
  for await (const chunk of r.body) res.write(chunk);
  res.end();
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url.startsWith('/api/config')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ai: hasCreds || process.env.TUTOR_ASSUME_CREDS === '1', model: MODEL, tts: !!ELEVEN_KEY }));
    }
    if (req.method === 'POST' && req.url === '/api/turn') return await handleTurn(req, res);
    if (req.method === 'POST' && req.url === '/api/tts') return await handleTts(req, res);
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res);
    res.writeHead(405); res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(err.status || 500);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Feynman Voice Tutor on http://localhost:${PORT}`);
  console.log(hasCreds ? `Tutor model: ${MODEL} (effort ${EFFORT})` : 'No ANTHROPIC_API_KEY set - the app will run in offline demo mode.');
  if (ELEVEN_KEY) console.log('Studio voice: ElevenLabs enabled');
});
