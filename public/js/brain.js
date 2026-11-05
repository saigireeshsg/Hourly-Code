// "Brains" produce the tutor's tagged-line reply as a text stream.
//  - ArtifactBrain: inside a claude.ai artifact, uses the viewer's Claude via the `sample` capability.
//  - ServerBrain:   talks to server.js (Claude API with your ANTHROPIC_API_KEY), streamed over SSE.
//  - DemoBrain:     offline scripted tutor for the magnets lesson, so the UI works with no AI attached.

import { SYSTEM_PROMPT } from './prompt.js';

export async function pickBrain() {
  // 1) claude.ai artifact runtime
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      const sample = await Promise.race([window.claude.use('sample'), new Promise(r => setTimeout(() => r(null), 4000))]);
      if (sample) return new ArtifactBrain(sample);
    } catch {}
  }
  // 2) our Node server
  try {
    const res = await fetch('api/config', { cache: 'no-store' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.ai) return new ServerBrain(cfg);
    }
  } catch {}
  // 3) offline demo
  return new DemoBrain();
}

export class ServerBrain {
  constructor(cfg) { this.name = 'Claude'; this.kind = 'server'; this.cfg = cfg; this.tts = cfg.tts ? 'api/tts' : null; }
  async turn({ history, mode, signal, onText }) {
    const res = await fetch('api/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history, mode }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error('Tutor request failed (' + res.status + ')');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const evt = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = evt.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        const msg = JSON.parse(line.slice(6));
        if (msg.error) throw new Error(msg.error);
        if (msg.t) { full += msg.t; onText(msg.t); }
      }
    }
    return full;
  }
}

export class ArtifactBrain {
  constructor(sample) { this.name = 'Claude'; this.kind = 'artifact'; this.sample = sample; this.tts = null; }
  async turn({ history, mode, signal, onText }) {
    // `sample` has no system prompt, so the instructions ride in the first user turn.
    const input = history.map((m, i) => ({ role: m.role, content: i === 0 ? SYSTEM_PROMPT + '\n\n---\n\n' + m.content : m.content }));
    const { text } = await this.sample(input, {
      modelTier: 'quick',
      cache: false,
      signal,
      onText: ({ delta }) => { if (delta) onText(delta); },
    });
    return text;
  }
}

// ---------------- offline demo ----------------
const has = (t, ...words) => words.some(w => t.includes(w));

export class DemoBrain {
  constructor() { this.name = 'Demo tutor'; this.kind = 'demo'; this.tts = null; this.seen = {}; }

  async turn({ history, mode, signal, onText }) {
    const last = history[history.length - 1]?.content || '';
    // live (partial) calls must not change the lesson state
    const snap = mode === 'live' ? JSON.stringify({ seen: this.seen, score: this.score, mastered: this.mastered }) : null;
    const reply = this._reply(last.replace(/^\[live partial\][^"]*"/i, '').toLowerCase(), mode);
    if (snap) Object.assign(this, JSON.parse(snap));
    // simulate streaming
    for (const chunk of reply.match(/.{1,12}/gs) || []) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      onText(chunk);
      await new Promise(r => setTimeout(r, 18));
    }
    return reply;
  }

  _assess(extra = {}) {
    const mis = Object.values(this.seen);
    const resolved = mis.filter(m => m.status === 'resolved').length;
    const base = Math.min(95, 25 + (this.score || 0));
    return JSON.stringify({ understanding: base, phase: extra.phase || 'probe', mastered: this.mastered || [], gaps: extra.gaps || [], misconceptions: mis, note: extra.note || '' });
  }

  _mis(id, belief, truth, status = 'open') { this.seen[id] = { id, belief, truth, status }; }

  _reply(t, mode) {
    const two = (aFlip, bFlip, ax = 175, bx = 300) => [
      { id: 'm1', type: 'magnet', x: ax, y: 175, rot: 0, w: 80, flip: aFlip },
      { id: 'm2', type: 'magnet', x: bx, y: 175, rot: 0, w: 80, flip: bFlip },
    ];
    this.mastered = this.mastered || [];
    let scene, say, phase = 'probe';
    if (t.startsWith('[start]')) {
      scene = { caption: 'Two bar magnets', mood: 'neutral', actor: { x: 70, pose: 'wave', face: 'happy', say: 'Hi!' }, props: two(false, false) };
      say = "Hi, I'm Fey! Pretend I'm ten years old. In your own words, what is a magnet and what can it do?";
      phase = 'explain';
    } else if (has(t, 'line', 'field')) {
      const wrong = has(t, 'south to north', 's to n', 'from south');
      scene = { caption: wrong ? 'Field lines from south to north?' : 'Field lines from north to south', mood: wrong ? 'misconception' : 'correct', actor: { x: 70, pose: 'point', face: wrong ? 'thinking' : 'excited', say: wrong ? 'Lines go S to N' : 'Lines go N to S' }, props: [{ id: 'm1', type: 'magnet', x: 230, y: 130, rot: 0, w: 100 }, { id: 'c1', type: 'compass', x: 230, y: 200 }], fx: [{ type: 'field_lines', target: 'm1', direction: wrong ? 's_to_n' : 'n_to_s' }, { type: wrong ? 'cross' : 'check', target: 'm1' }] };
      if (wrong) {
        this._mis('field_direction', 'Field lines go from south to north', 'Outside a magnet, field lines run from north to south', 'repairing');
        say = "Interesting, so the arrows start at south. Look at the compass under the magnet: which way is its red north tip pointing?";
        phase = 'repair';
      } else {
        if (this.seen.field_direction) this.seen.field_direction.status = 'resolved';
        this.mastered.push('Field lines run north to south outside the magnet'); this.score = (this.score || 0) + 20;
        say = "Yes, and the compass agrees with you. Why do you think the lines bunch up near the ends of the magnet?";
      }
    } else if (has(t, 'all metal', 'any metal', 'every metal', 'coin', 'aluminium', 'aluminum', 'metal')) {
      const claimsAll = has(t, 'all', 'any', 'every', 'metal');
      scene = { caption: 'Magnet near a nail and a coin', mood: claimsAll ? 'misconception' : 'testing', actor: { x: 70, pose: 'hold', face: 'thinking', say: 'Sticks to all metals', holds: 'm1' }, props: [{ id: 'm1', type: 'magnet', x: 160, y: 150, w: 70 }, { id: 'n1', type: 'nail', x: 270, y: 150, label: 'iron nail' }, { id: 'k1', type: 'coin', x: 330, y: 200, label: 'copper coin' }], fx: [{ type: 'attract', a: 'm1', b: 'n1' }, { type: 'cross', target: 'k1', delay: 1.2 }] };
      this._mis('all_metals', 'Magnets attract all metals', 'Only some metals, like iron, nickel and cobalt, are attracted', 'open');
      say = "Let's test it. The nail jumped to the magnet, but the copper coin just sat there. What might be different about the coin?";
      phase = 'repair';
    } else if (has(t, 'north') && has(t, 'stick', 'attract', 'pull', 'together', 'join')) {
      const sameSide = has(t, 'north and north', 'north to north', 'two north', 'north near north', 'north pole near', 'same');
      if (sameSide || !has(t, 'south')) {
        scene = { caption: 'Two north poles... pulling together?', mood: 'misconception', actor: { x: 60, pose: 'pull', face: 'thinking', say: 'N + N stick!' }, props: two(true, false, 170, 290), fx: [{ type: 'attract', a: 'm1', b: 'm2' }, { type: 'cross', target: 'm2', delay: 1 }] };
        this._mis('like_poles_attract', 'Two north poles pull together', 'Like poles repel; opposite poles attract', 'repairing');
        say = "Okay, the stickman is pushing two north poles together like you said. If north and north stick, what would north and south do?";
        phase = 'repair';
      } else {
        scene = { caption: 'North pulls toward south', mood: 'correct', actor: { x: 60, pose: 'cheer', face: 'excited', say: 'N and S stick' }, props: two(false, false), fx: [{ type: 'attract', a: 'm1', b: 'm2' }, { type: 'check', target: 'm2', delay: 1 }] };
        this.mastered.push('Opposite poles attract'); this.score = (this.score || 0) + 15;
        say = "Nice, opposite poles pull together. So what happens if you flip one magnet so two norths face each other?";
        phase = 'predict';
      }
    } else if (has(t, 'repel', 'push', 'away', 'apart')) {
      scene = { caption: 'Like poles push apart', mood: 'correct', actor: { x: 60, pose: 'push', face: 'surprised', say: 'Same poles push!' }, props: two(true, false, 170, 290), fx: [{ type: 'repel', a: 'm1', b: 'm2' }, { type: 'check', target: 'm2', delay: 1.4 }] };
      if (this.seen.like_poles_attract) this.seen.like_poles_attract.status = 'resolved';
      this.mastered.push('Like poles repel'); this.score = (this.score || 0) + 20;
      say = "Exactly, you can feel that push even before they touch. How would you draw the invisible field around one magnet?";
      phase = 'predict';
    } else if (has(t, "don't know", 'dont know', 'not sure', 'no idea')) {
      scene = { caption: 'A fridge magnet', mood: 'neutral', actor: { x: 70, pose: 'shrug', face: 'thinking', say: 'Hmm...' }, props: [{ id: 'm1', type: 'magnet', x: 230, y: 160, w: 70 }, { id: 'n1', type: 'nail', x: 330, y: 160 }] };
      say = "That's okay! Think of a fridge magnet. What happens when you bring it close to the fridge door?";
      phase = 'explain';
    } else {
      scene = { caption: 'Thinking about your idea', mood: 'testing', actor: { x: 70, pose: 'think', face: 'thinking', say: (t.slice(0, 28) || '...') }, props: two(false, false) };
      this.score = (this.score || 0) + 5;
      say = "I like that you're thinking it through. What do you think happens when the north pole of one magnet comes near the north pole of another?";
      phase = 'predict';
    }
    if (mode === 'live') return `@scene ${JSON.stringify(scene)}\n@assess ${this._assess({ phase })}\n`;
    return `@scene ${JSON.stringify(scene)}\n@say ${say}\n@assess ${this._assess({ phase })}\n`;
  }
}
