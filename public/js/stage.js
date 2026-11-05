// SVG stage: an animated stickman plus a small library of props and effects.
// Scenes are plain JSON (see prompt.js), so the tutor model can compose them.

const NS = 'http://www.w3.org/2000/svg';
const W = 400, H = 250, GROUND = 215;
const DEG = Math.PI / 180;

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = {
  linear: t => t,
  inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  bounce: t => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

// ---------- stickman poses ----------
// Angles in degrees: 0 = hanging straight down, positive = rotated toward the facing direction.
// Elbow/knee are relative to the upper segment.
const POSES = {
  idle:     { lean: 0,   fs: 12,  fe: 8,    bs: -12, be: -8,  fh: 6,   fk: 0,   bh: -6,  bk: 0,  tilt: 0 },
  point:    { lean: 3,   fs: 88,  fe: 0,    bs: -10, be: -6,  fh: 8,   fk: 0,   bh: -8,  bk: 0,  tilt: 4 },
  push:     { lean: 14,  fs: 80,  fe: 12,   bs: 70,  be: 20,  fh: 18,  fk: -10, bh: -28, bk: 10, tilt: 0 },
  pull:     { lean: -16, fs: 75,  fe: -10,  bs: 65,  be: -5,  fh: 25,  fk: 0,   bh: -5,  bk: 20, tilt: -4 },
  hold:     { lean: 2,   fs: 70,  fe: 20,   bs: 55,  be: 35,  fh: 6,   fk: 0,   bh: -6,  bk: 0,  tilt: 0 },
  think:    { lean: 0,   fs: 30,  fe: 145,  bs: 25,  be: 95,  fh: 5,   fk: 0,   bh: -5,  bk: 0,  tilt: 10 },
  shrug:    { lean: 0,   fs: 55,  fe: 105,  bs: -55, be: -105, fh: 6,  fk: 0,   bh: -6,  bk: 0,  tilt: -8 },
  cheer:    { lean: 0,   fs: 160, fe: 10,   bs: -160, be: -10, fh: 14, fk: 0,   bh: -14, bk: 0,  tilt: 0 },
  wave:     { lean: 0,   fs: 140, fe: 30,   bs: -12, be: -8,  fh: 6,   fk: 0,   bh: -6,  bk: 0,  tilt: 5 },
  walk:     { lean: 5,   fs: 25,  fe: 15,   bs: -25, be: 15,  fh: 25,  fk: -5,  bh: -25, bk: 15, tilt: 0 },
  jump:     { lean: 0,   fs: 150, fe: 10,   bs: -150, be: -10, fh: 40, fk: -60, bh: 20,  bk: -50, tilt: 0 },
  confused: { lean: -3,  fs: 150, fe: 115,  bs: -15, be: -10, fh: 6,   fk: 0,   bh: -6,  bk: 0,  tilt: -14 },
  throw:    { lean: 10,  fs: 130, fe: 10,   bs: -40, be: 10,  fh: 20,  fk: 0,   bh: -25, bk: 10, tilt: 0 },
  drop:     { lean: 4,   fs: 85,  fe: -5,   bs: -10, be: -5,  fh: 6,   fk: 0,   bh: -6,  bk: 0,  tilt: 10 },
  sit:      { lean: -5,  fs: 40,  fe: 40,   bs: 30,  be: 40,  fh: 90,  fk: -90, bh: 85,  bk: -90, tilt: 0 },
};
const POSE_KEYS = Object.keys(POSES.idle);

const MOUTHS = {
  happy: 'M-4,3 Q0,7 4,3',
  excited: 'M-4,2 Q0,9 4,2 Z',
  neutral: 'M-3.5,4 L3.5,4',
  thinking: 'M-3,4.5 Q1,3 3.5,5',
  surprised: 'M0,4.5 m-2.2,0 a2.2,2.6 0 1,0 4.4,0 a2.2,2.6 0 1,0 -4.4,0',
  sad: 'M-4,6 Q0,2 4,6',
};

class Stickman {
  constructor(parent) {
    this.g = el('g', { class: 'actor' }, parent);
    this.bubble = el('g', { class: 'bubble', opacity: 0 }, parent);
    this.bubbleRect = el('rect', { rx: 9, ry: 9, class: 'bubble-bg' }, this.bubble);
    this.bubbleTail = el('path', { class: 'bubble-bg' }, this.bubble);
    this.bubbleText = el('text', { class: 'bubble-text', 'text-anchor': 'middle' }, this.bubble);
    const s = { class: 'stick', fill: 'none' };
    this.limbs = {};
    for (const k of ['bThigh', 'bShin', 'bUpper', 'bLower', 'torso', 'fThigh', 'fShin', 'fUpper', 'fLower']) {
      this.limbs[k] = el('line', s, this.g);
    }
    this.head = el('g', {}, this.g);
    el('circle', { r: 10, class: 'stick head' }, this.head);
    this.eyeF = el('circle', { r: 1.5, cx: 3.5, cy: -2, class: 'ink' }, this.head);
    this.eyeB = el('circle', { r: 1.5, cx: -2.5, cy: -2, class: 'ink' }, this.head);
    this.brow = el('path', { class: 'stick thin', d: '' }, this.head);
    this.mouth = el('path', { class: 'stick thin', d: MOUTHS.happy }, this.head);
    this.hand = { x: 0, y: 0 };
    this.x = 70; this.y = 0; this.facing = 1;
    this.pose = { ...POSES.idle };
    this.target = { ...POSES.idle };
    this.poseName = 'idle';
    this.face = 'happy';
    this.walkFrom = null;
  }

  setPose(name) {
    if (!POSES[name]) name = 'idle';
    this.poseName = name;
    this.target = { ...POSES[name] };
    this.poseT0 = performance.now();
    this.poseFrom = { ...this.pose };
  }

  setFace(face) {
    this.face = MOUTHS[face] ? face : 'happy';
    this.mouth.setAttribute('d', MOUTHS[this.face]);
    const brows = {
      thinking: 'M1,-7 L6,-8.5',
      surprised: 'M1,-8 Q3.5,-10 6,-8 M-5,-8 Q-2.5,-10 0,-8',
      sad: 'M1,-8.5 L6,-7 M-5,-7 L0,-8.5',
      excited: 'M1,-8 Q3.5,-10 6,-8',
    };
    this.brow.setAttribute('d', brows[this.face] || '');
  }

  say(text) {
    if (!text) { this.bubble.setAttribute('opacity', 0); this.sayText = ''; return; }
    this.sayText = String(text).slice(0, 48);
    this.bubbleText.textContent = this.sayText;
    this.bubble.setAttribute('opacity', 1);
    this.bubbleW = Math.max(50, this.sayText.length * 6.1 + 18);
  }

  walkTo(x, dur = 1.2) {
    this.walkFrom = { x0: this.x, x1: clamp(x, 25, 375), t0: performance.now(), dur: dur * 1000 };
    this.facing = x >= this.x ? 1 : -1;
  }

  update(now) {
    // walking
    let walking = false;
    if (this.walkFrom) {
      const t = clamp((now - this.walkFrom.t0) / this.walkFrom.dur, 0, 1);
      this.x = lerp(this.walkFrom.x0, this.walkFrom.x1, ease.inOut(t));
      walking = t < 1;
      if (t >= 1) { this.walkFrom = null; this.facing = 1; }
    }
    // pose interpolation
    const pt = this.poseT0 ? clamp((now - this.poseT0) / 350, 0, 1) : 1;
    const e = ease.out(pt);
    for (const k of POSE_KEYS) this.pose[k] = lerp(this.poseFrom ? this.poseFrom[k] : this.pose[k], this.target[k], e);
    const p = { ...this.pose };
    const sec = now / 1000;
    // procedural motion layered on top
    if (walking || this.poseName === 'walk') {
      const c = Math.sin(sec * 9);
      p.fh = 28 * c; p.bh = -28 * c; p.fk = c > 0 ? -5 : -30 * -c; p.bk = c < 0 ? -5 : -30 * c;
      p.fs = -22 * c + 5; p.bs = 22 * c + 5; p.fe = 20; p.be = 20; p.lean = 6;
    }
    if (this.poseName === 'wave') p.fe = 30 + 25 * Math.sin(sec * 8);
    if (this.poseName === 'cheer') { p.fs += 8 * Math.sin(sec * 10); p.bs -= 8 * Math.sin(sec * 10); }
    if (this.poseName === 'confused') p.fe += 12 * Math.sin(sec * 12);
    let bob = Math.sin(sec * 2.2) * 0.8;
    if (this.poseName === 'jump') bob = -Math.abs(Math.sin(sec * 4)) * 22;
    if (walking) bob = -Math.abs(Math.sin(sec * 9)) * 2.5;

    const f = this.facing;
    const legLen = 21, armLen = 16, torsoLen = 34;
    const sit = this.poseName === 'sit' ? 18 : 0;
    const hip = { x: this.x, y: GROUND - legLen * 2 + bob + sit };
    const seg = (o, angDeg, len) => ({ x: o.x + Math.sin(angDeg * DEG) * len * f, y: o.y + Math.cos(angDeg * DEG) * len });
    const neck = { x: hip.x + Math.sin(p.lean * DEG) * torsoLen * f, y: hip.y - Math.cos(p.lean * DEG) * torsoLen };
    const sh = { x: lerp(hip.x, neck.x, 0.88), y: lerp(hip.y, neck.y, 0.88) };
    const fEl = seg(sh, p.fs, armLen), fHa = seg(fEl, p.fs + p.fe, armLen);
    const bEl = seg(sh, p.bs, armLen), bHa = seg(bEl, p.bs + p.be, armLen);
    const fKn = seg(hip, p.fh, legLen), fFt = seg(fKn, p.fh + p.fk, legLen);
    const bKn = seg(hip, p.bh, legLen), bFt = seg(bKn, p.bh + p.bk, legLen);
    const L = this.limbs;
    const set = (ln, a, b) => { ln.setAttribute('x1', a.x.toFixed(1)); ln.setAttribute('y1', a.y.toFixed(1)); ln.setAttribute('x2', b.x.toFixed(1)); ln.setAttribute('y2', b.y.toFixed(1)); };
    set(L.torso, hip, neck);
    set(L.fUpper, sh, fEl); set(L.fLower, fEl, fHa);
    set(L.bUpper, sh, bEl); set(L.bLower, bEl, bHa);
    set(L.fThigh, hip, fKn); set(L.fShin, fKn, fFt);
    set(L.bThigh, hip, bKn); set(L.bShin, bKn, bFt);
    const hx = neck.x + Math.sin(p.lean * DEG) * 11 * f, hy = neck.y - 11;
    this.head.setAttribute('transform', `translate(${hx.toFixed(1)},${hy.toFixed(1)}) rotate(${(p.tilt * f).toFixed(1)}) scale(${f},1)`);
    this.hand = fHa;
    this.headPos = { x: hx, y: hy };
    // speech bubble above head
    if (this.sayText) {
      const bw = this.bubbleW, bx = clamp(hx + 8, bw / 2 + 4, W - bw / 2 - 4), by = clamp(hy - 40, 16, H);
      this.bubbleRect.setAttribute('x', bx - bw / 2); this.bubbleRect.setAttribute('y', by - 13);
      this.bubbleRect.setAttribute('width', bw); this.bubbleRect.setAttribute('height', 24);
      this.bubbleTail.setAttribute('d', `M${hx + 2},${by + 10} L${hx + 4},${hy - 14} L${hx + 12},${by + 10} Z`);
      this.bubbleText.setAttribute('x', bx); this.bubbleText.setAttribute('y', by + 3.5);
    }
  }
}

// ---------- props ----------
const COLORS = {
  ball: '#f97316', box: '#a16207', apple: '#dc2626', rock: '#78716c', feather: '#e5e7eb',
  sun: '#facc15', earth: '#3b82f6', moon: '#d6d3d1', cloud: '#e2e8f0', drop: '#38bdf8',
  flame: '#f97316', ice: '#bae6fd', cup: '#94a3b8', nail: '#9ca3af', coin: '#eab308',
  car: '#ef4444', plant: '#22c55e', blob: '#a78bfa', bulb: '#fde68a',
};

function drawProp(g, p) {
  const c = p.color || COLORS[p.type] || '#a78bfa';
  const s = 1;
  switch (p.type) {
    case 'magnet': {
      const w = p.w || 80, h = 22;
      const nLeft = !p.flip;
      el('rect', { x: -w / 2, y: -h / 2, width: w / 2, height: h, class: nLeft ? 'mag-n' : 'mag-s', rx: 3 }, g);
      el('rect', { x: 0, y: -h / 2, width: w / 2, height: h, class: nLeft ? 'mag-s' : 'mag-n', rx: 3 }, g);
      const tl = el('text', { x: -w / 4, y: 5, class: 'mag-label', 'text-anchor': 'middle' }, g); tl.textContent = nLeft ? 'N' : 'S';
      const tr = el('text', { x: w / 4, y: 5, class: 'mag-label', 'text-anchor': 'middle' }, g); tr.textContent = nLeft ? 'S' : 'N';
      break;
    }
    case 'compass': {
      el('circle', { r: 15, class: 'compass-body' }, g);
      const needle = el('g', { class: 'needle' }, g);
      el('path', { d: 'M0,-12 L3.5,0 L-3.5,0 Z', fill: '#ef4444' }, needle);
      el('path', { d: 'M0,12 L3.5,0 L-3.5,0 Z', fill: '#e5e7eb' }, needle);
      el('circle', { r: 1.8, class: 'ink' }, g);
      g._needle = needle;
      break;
    }
    case 'ball': el('circle', { r: 12 * s, fill: c, class: 'outline' }, g); el('path', { d: 'M-8,-4 Q0,-12 8,-4', class: 'shine' }, g); break;
    case 'rock': el('path', { d: 'M-14,8 L-10,-6 L0,-11 L11,-5 L14,8 Z', fill: c, class: 'outline' }, g); break;
    case 'box': el('rect', { x: -15, y: -15, width: 30, height: 30, fill: c, class: 'outline', rx: 2 }, g); el('path', { d: 'M-15,-15 L15,15 M15,-15 L-15,15', class: 'faint' }, g); break;
    case 'apple':
      el('path', { d: 'M0,-7 C-12,-14 -16,2 -9,10 C-5,14 -2,12 0,11 C2,12 5,14 9,10 C16,2 12,-14 0,-7 Z', fill: c, class: 'outline' }, g);
      el('path', { d: 'M0,-7 Q1,-13 4,-15', class: 'stick thin' }, g);
      el('path', { d: 'M1,-11 Q7,-15 9,-10 Q4,-8 1,-11 Z', fill: '#22c55e' }, g); break;
    case 'feather': el('path', { d: 'M-16,8 Q0,-14 16,-10 Q4,4 -16,8 Z', fill: c, class: 'outline' }, g); el('path', { d: 'M-18,10 L14,-9', class: 'stick thin' }, g); break;
    case 'sun': {
      const rays = el('g', { class: 'spin-slow' }, g);
      for (let i = 0; i < 12; i++) { const a = i * 30 * DEG; el('line', { x1: Math.cos(a) * 20, y1: Math.sin(a) * 20, x2: Math.cos(a) * 28, y2: Math.sin(a) * 28, stroke: c, 'stroke-width': 3, 'stroke-linecap': 'round' }, rays); }
      el('circle', { r: 16, fill: c }, g); break;
    }
    case 'earth':
      el('circle', { r: 18, fill: c, class: 'outline' }, g);
      el('path', { d: 'M-10,-10 Q-2,-6 -6,2 Q-12,4 -14,-2 Z M4,-14 Q12,-8 8,0 Q14,6 6,12 Q2,6 4,0 Q-2,-6 4,-14 Z', fill: '#22c55e' }, g); break;
    case 'moon': el('circle', { r: 11, fill: c, class: 'outline' }, g); el('circle', { r: 2.5, cx: -3, cy: -2, class: 'faint-fill' }, g); el('circle', { r: 1.6, cx: 4, cy: 4, class: 'faint-fill' }, g); break;
    case 'bulb':
      g._glow = el('circle', { r: 26, class: 'bulb-glow', opacity: 0 }, g);
      el('path', { d: 'M-10,2 A12,12 0 1,1 10,2 Q6,6 6,10 L-6,10 Q-6,6 -10,2 Z', fill: c, class: 'outline bulb-glass' }, g);
      el('rect', { x: -6, y: 10, width: 12, height: 8, class: 'metal' }, g);
      el('path', { d: 'M-3,8 L-3,0 L0,-4 L3,0 L3,8', class: 'stick thin' }, g); break;
    case 'battery':
      el('rect', { x: -22, y: -10, width: 44, height: 20, rx: 3, class: 'battery' }, g);
      el('rect', { x: 22, y: -5, width: 4, height: 10, class: 'metal' }, g);
      el('text', { x: 12, y: 4, class: 'mag-label', 'text-anchor': 'middle' }, g).textContent = '+';
      el('text', { x: -12, y: 4, class: 'mag-label', 'text-anchor': 'middle' }, g).textContent = '−'; break;
    case 'plant':
      el('path', { d: 'M-10,14 L10,14 L7,0 L-7,0 Z', fill: '#b45309', class: 'outline' }, g);
      el('path', { d: 'M0,0 L0,-22', class: 'stem' }, g);
      el('path', { d: 'M0,-10 Q-14,-16 -12,-24 Q-2,-20 0,-10 Z M0,-16 Q14,-22 12,-30 Q2,-26 0,-16 Z', fill: c }, g); break;
    case 'cloud': el('path', { d: 'M-22,8 Q-28,-4 -14,-6 Q-10,-18 2,-14 Q10,-22 18,-10 Q30,-8 24,8 Z', fill: c, class: 'outline' }, g); break;
    case 'drop': el('path', { d: 'M0,-12 Q10,2 7,7 A7,7 0 1,1 -7,7 Q-10,2 0,-12 Z', fill: c, class: 'outline' }, g); break;
    case 'flame':
      g._glow = el('circle', { r: 22, class: 'flame-glow', opacity: 0.35 }, g);
      el('path', { d: 'M0,-18 Q12,-4 8,6 A8,8 0 0,1 -8,6 Q-12,-4 0,-18 Z', fill: c, class: 'flicker' }, g);
      el('path', { d: 'M0,-6 Q5,2 3,6 A3,3 0 0,1 -3,6 Q-5,2 0,-6 Z', fill: '#fde047' }, g); break;
    case 'ice': el('rect', { x: -12, y: -12, width: 24, height: 24, rx: 4, fill: c, class: 'outline' }, g); el('path', { d: 'M-6,-6 L0,-6', class: 'shine' }, g); break;
    case 'cup': el('path', { d: 'M-12,-12 L12,-12 L9,12 L-9,12 Z', fill: c, class: 'outline' }, g); el('path', { d: 'M-10,-4 L10,-4 L8,10 L-8,10 Z', fill: '#38bdf8', opacity: 0.7 }, g); break;
    case 'nail': el('path', { d: 'M-16,-2 L12,-2 L18,0 L12,2 L-16,2 Z', fill: c, class: 'outline' }, g); el('rect', { x: -18, y: -5, width: 3, height: 10, fill: c }, g); break;
    case 'coin': el('ellipse', { rx: 10, ry: 10, fill: c, class: 'outline' }, g); el('text', { y: 4, class: 'mag-label dark', 'text-anchor': 'middle' }, g).textContent = '¢'; break;
    case 'car':
      el('path', { d: 'M-24,4 L-24,-6 L-12,-8 L-6,-16 L10,-16 L16,-8 L24,-6 L24,4 Z', fill: c, class: 'outline' }, g);
      el('circle', { cx: -13, cy: 5, r: 6, class: 'tire' }, g); el('circle', { cx: 13, cy: 5, r: 6, class: 'tire' }, g); break;
    case 'spring': el('path', { d: 'M-20,0 l4,-8 l6,16 l6,-16 l6,16 l6,-16 l6,16 l4,-8', class: 'stick thin', fill: 'none' }, g); break;
    case 'text': {
      const t = el('text', { class: 'stage-text', 'text-anchor': 'middle' }, g); t.textContent = p.text || p.label || '';
      return;
    }
    default: {
      el('circle', { r: 16, fill: c, class: 'outline', opacity: 0.9 }, g);
    }
  }
  if (p.label && p.type !== 'text') {
    const t = el('text', { y: p.type === 'magnet' ? 26 : 30, class: 'prop-label', 'text-anchor': 'middle' }, g);
    t.textContent = p.label;
  }
}

// ---------- magnetism ----------
function magnetPoles(m) {
  const w = (m.def.w || 80);
  const a = m.rot * DEG;
  const ux = Math.cos(a) * m.scale, uy = Math.sin(a) * m.scale;
  const off = w / 2 - 7;
  const nSign = m.def.flip ? 1 : -1;
  return [
    { x: m.x + ux * off * nSign, y: m.y + uy * off * nSign, q: 1 },
    { x: m.x - ux * off * nSign, y: m.y - uy * off * nSign, q: -1 },
  ];
}

function fieldAt(x, y, poles) {
  let bx = 0, by = 0;
  for (const p of poles) {
    const dx = x - p.x, dy = y - p.y;
    const r2 = dx * dx + dy * dy + 4;
    const r3 = r2 * Math.sqrt(r2);
    bx += p.q * dx / r3; by += p.q * dy / r3;
  }
  return [bx, by];
}

function insideMagnet(x, y, mags) {
  for (const m of mags) {
    const a = -m.rot * DEG, dx = x - m.x, dy = y - m.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) < (m.def.w || 80) / 2 * m.scale - 1 && Math.abs(ly) < 11 * m.scale) return true;
  }
  return false;
}

function traceFieldLines(mags) {
  const poles = mags.flatMap(magnetPoles);
  const lines = [];
  const norths = poles.filter(p => p.q > 0), souths = poles.filter(p => p.q < 0);
  const N = 14;
  for (const np of norths) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.11;
      let x = np.x + Math.cos(a) * 6, y = np.y + Math.sin(a) * 6;
      const pts = [[x, y]];
      let ok = true;
      for (let step = 0; step < 420; step++) {
        const [bx, by] = fieldAt(x, y, poles);
        const m = Math.hypot(bx, by) || 1;
        x += (bx / m) * 3; y += (by / m) * 3;
        pts.push([x, y]);
        if (x < -40 || x > W + 40 || y < -40 || y > H + 40) break;
        if (souths.some(s => Math.hypot(x - s.x, y - s.y) < 5)) break;
      }
      // drop the portions that run inside magnet bodies
      const segs = [];
      let cur = [];
      for (const pt of pts) {
        if (insideMagnet(pt[0], pt[1], mags)) { if (cur.length > 3) segs.push(cur); cur = []; }
        else cur.push(pt);
      }
      if (cur.length > 3) segs.push(cur);
      if (ok) lines.push(...segs);
    }
  }
  return lines;
}

// ---------- the stage ----------
export class Stage {
  constructor(svg) {
    this.svg = svg;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    const defs = el('defs', {}, svg);
    const mk = (id, cls) => {
      const m = el('marker', { id, viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,1 L9,5 L0,9 Z', class: cls }, m);
    };
    mk('arrowhead', 'arrow-head'); mk('fieldhead', 'field-head'); mk('fieldhead-wrong', 'field-head-wrong');
    this.bg = el('g', { class: 'bg' }, svg);
    el('line', { x1: 0, y1: GROUND, x2: W, y2: GROUND, class: 'ground' }, this.bg);
    for (let i = 0; i < 16; i++) el('line', { x1: i * 26 + 6, y1: GROUND + 6, x2: i * 26 + 16, y2: GROUND + 6, class: 'ground-dash' }, this.bg);
    this.fieldLayer = el('g', { class: 'field' }, svg);
    this.propLayer = el('g', {}, svg);
    this.actorLayer = el('g', {}, svg);
    this.markLayer = el('g', {}, svg);
    this.actor = new Stickman(this.actorLayer);
    this.props = new Map();
    this.tweens = [];
    this.loops = [];
    this.field = null;
    this.lastScene = null;
    this._raf = requestAnimationFrame(t => this._tick(t));
  }

  // Apply a scene from the tutor. Props sharing an id with the current scene glide to their new spot.
  setScene(scene, { replay = false } = {}) {
    if (!scene || typeof scene !== 'object') return;
    this.lastScene = scene;
    const now = performance.now();
    this.tweens = this.tweens.filter(t => t.keep);
    this.loops = [];
    this.markLayer.innerHTML = '';
    this.field = null;
    this.fieldLayer.innerHTML = '';
    const seen = new Set();
    for (const raw of (Array.isArray(scene.props) ? scene.props : []).slice(0, 12)) {
      if (!raw || !raw.type) continue;
      const p = { ...raw, id: String(raw.id || raw.type + Math.random().toString(36).slice(2, 6)) };
      seen.add(p.id);
      let prop = this.props.get(p.id);
      const isLine = p.type === 'wire' || p.type === 'arrow';
      const tx = isLine ? 0 : clamp(+p.x || 220, 10, W - 10);
      const ty = isLine ? 0 : clamp(+p.y || 160, 10, GROUND + 10);
      const changed = prop && (prop.def.type !== p.type || !!prop.def.flip !== !!p.flip || prop.def.w !== p.w || prop.def.label !== p.label || prop.def.text !== p.text || prop.def.color !== p.color || isLine);
      if (prop && changed) { prop.g.remove(); this.props.delete(p.id); prop = null; }
      if (!prop || replay) {
        if (prop) prop.g.remove();
        prop = this._makeProp(p, tx, ty);
        prop.opacity = 0; prop.scale = (+p.size || 1) * 0.6;
        this._tween(prop, { opacity: 1, scale: +p.size || 1 }, 0.35, 'out');
      } else {
        prop.def = p;
        this._tween(prop, { x: tx, y: ty, rot: +p.rot || 0, scale: +p.size || 1, opacity: 1 }, 0.6, 'inOut');
      }
      prop.tx = isLine ? 0 : tx; prop.ty = isLine ? 0 : ty;
    }
    for (const [id, prop] of this.props) {
      if (!seen.has(id)) {
        this.props.delete(id);
        this._tween(prop, { opacity: 0, scale: prop.scale * 0.6 }, 0.3, 'out', () => prop.g.remove(), true);
      }
    }
    // actor
    const a = scene.actor || {};
    if (a.x != null || a.walk_to != null) {
      const target = a.walk_to != null ? +a.walk_to : +a.x;
      if (Math.abs(target - this.actor.x) > 4) this.actor.walkTo(target, Math.min(2, Math.abs(target - this.actor.x) / 90 + 0.4));
    }
    this.actor.setPose(a.pose || 'idle');
    this.actor.setFace(a.face || (scene.mood === 'misconception' ? 'thinking' : 'happy'));
    this.actor.say(a.say || '');
    this.holds = a.holds && this.props.get(String(a.holds)) ? String(a.holds) : null;
    // effects
    for (const fx of (Array.isArray(scene.fx) ? scene.fx : []).slice(0, 8)) this._fx(fx, now);
  }

  replay() { if (this.lastScene) this.setScene(this.lastScene, { replay: true }); }

  // Instant local reaction while the student is still talking (before the model replies).
  react(kind) {
    const mags = [...this.props.values()].filter(p => p.def.type === 'magnet');
    switch (kind) {
      case 'repel': if (mags.length >= 2) this._fx({ type: 'repel', a: mags[0].id, b: mags[1].id, _instant: true }); this.actor.setPose('push'); break;
      case 'attract': if (mags.length >= 2) this._fx({ type: 'attract', a: mags[0].id, b: mags[1].id, _instant: true }); this.actor.setPose('pull'); break;
      case 'field': if (mags.length) this._fx({ type: 'field_lines', target: 'all', direction: 'n_to_s', _instant: true }); this.actor.setPose('point'); break;
      case 'fall': { const p = [...this.props.values()].find(p => p.def.type !== 'magnet' && p.def.type !== 'text'); if (p) this._fx({ type: 'fall', target: p.id, _instant: true }); this.actor.setPose('drop'); break; }
      case 'unsure': this.actor.setPose('shrug'); this.actor.setFace('thinking'); break;
      case 'think': this.actor.setPose('think'); this.actor.setFace('thinking'); break;
      case 'yes': this.actor.setPose('cheer'); this.actor.setFace('excited'); break;
      case 'listen': this.actor.setPose('idle'); this.actor.setFace('neutral'); break;
    }
  }

  _makeProp(def, x, y) {
    const g = el('g', { class: 'prop' }, this.propLayer);
    const prop = { id: def.id, def, g, x, y, rot: +def.rot || 0, scale: +def.size || 1, opacity: 1, ox: 0, oy: 0, orot: 0 };
    if (def.type === 'wire' || def.type === 'arrow') {
      const x1 = +def.x1 || 150, y1 = +def.y1 || 150, x2 = +def.x2 || 250, y2 = +def.y2 || 150;
      const path = el('path', { d: `M${x1},${y1} L${x2},${y2}`, class: def.type === 'wire' ? 'wire' : 'arrow', 'marker-end': def.type === 'arrow' ? 'url(#arrowhead)' : '' }, g);
      if (def.color) path.style.stroke = def.color;
      prop.path = path; prop.len = Math.hypot(x2 - x1, y2 - y1);
      if (def.label) { const t = el('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 7, class: 'prop-label', 'text-anchor': 'middle' }, g); t.textContent = def.label; }
      prop.x = 0; prop.y = 0;
    } else {
      drawProp(g, def);
    }
    this.props.set(def.id, prop);
    return prop;
  }

  _tween(obj, to, dur, easing = 'inOut', done, keep = false, delay = 0) {
    const from = {};
    for (const k in to) from[k] = obj[k];
    const tw = { obj, from, to, t0: performance.now() + delay * 1000, dur: dur * 1000, ease: ease[easing] || ease.inOut, done, keep };
    this.tweens.push(tw);
    return tw;
  }

  _mark(target, kind) {
    const g = el('g', { class: kind === 'cross' ? 'mark-cross' : 'mark-check' }, this.markLayer);
    el('circle', { r: 11 }, g);
    const t = el('text', { y: 5, 'text-anchor': 'middle' }, g);
    t.textContent = kind === 'cross' ? '?' : '✓';
    this.loops.push({ type: 'mark', g, target });
  }

  _fx(fx, now = performance.now()) {
    if (!fx || !fx.type) return;
    const delay = clamp(+fx.delay || 0, 0, 6) + (fx._instant ? 0 : 0.65);
    const P = id => this.props.get(String(id));
    switch (fx.type) {
      case 'attract':
      case 'repel': {
        const a = P(fx.a), b = P(fx.b);
        if (!a || !b) return;
        const dx = (b.tx ?? b.x) - (a.tx ?? a.x), dy = (b.ty ?? b.y) - (a.ty ?? a.y), d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        const ax0 = a.tx ?? a.x, ay0 = a.ty ?? a.y, bx0 = b.tx ?? b.x, by0 = b.ty ?? b.y;
        const halfA = (a.def.w || 30) / 2 * a.scale, halfB = (b.def.w || 30) / 2 * b.scale;
        if (fx.type === 'attract') {
          const gap = d - halfA - halfB - 1;
          const mv = Math.max(0, gap) / 2;
          a.tx = ax0 + ux * mv; a.ty = ay0 + uy * mv; b.tx = bx0 - ux * mv; b.ty = by0 - uy * mv;
          this._tween(a, { x: ax0 + ux * mv, y: ay0 + uy * mv }, 0.9, 'in', () => this._shake(b), false, delay);
          this._tween(b, { x: bx0 - ux * mv, y: by0 - uy * mv }, 0.9, 'in', null, false, delay);
        } else {
          // nudge together, then fly apart
          const near = Math.max(0, d - halfA - halfB - 14) / 2;
          this._tween(a, { x: ax0 + ux * near, y: ay0 + uy * near }, 0.7, 'inOut', () => {
            const ax1 = clamp(ax0 - ux * 40, 20, W - 20), bx1 = clamp(bx0 + ux * 40, 20, W - 20);
            this._shake(a); this._shake(b);
            this._tween(a, { x: ax1, y: ay0 - uy * 20 }, 0.6, 'out');
            this._tween(b, { x: bx1, y: by0 + uy * 20 }, 0.6, 'out');
            a.tx = ax1; b.tx = bx1;
          }, false, delay);
          this._tween(b, { x: bx0 - ux * near * 0.2, y: by0 - uy * near * 0.2 }, 0.7, 'inOut', null, false, delay);
        }
        break;
      }
      case 'field_lines': {
        this.field = { target: fx.target || 'all', reverse: fx.direction === 's_to_n', t0: now + delay * 1000 };
        this._fieldDirty = true;
        break;
      }
      case 'move': {
        const p = P(fx.target); if (!p) return;
        const to = Array.isArray(fx.to) ? fx.to : [fx.x, fx.y];
        this._tween(p, { x: clamp(+to[0] || p.x, 10, W - 10), y: clamp(+to[1] || p.y, 10, GROUND + 10) }, clamp(+fx.dur || 1.2, 0.2, 5), 'inOut', null, false, delay);
        break;
      }
      case 'fall': {
        const p = P(fx.target); if (!p) return;
        this._tween(p, { y: GROUND - 12 * p.scale }, p.def.type === 'feather' ? 3 : 0.9, p.def.type === 'feather' ? 'inOut' : 'bounce', null, false, delay);
        if (p.def.type === 'feather') this.loops.push({ type: 'sway', p, t0: now });
        break;
      }
      case 'rise': {
        const p = P(fx.target); if (!p) return;
        this._tween(p, { y: 45, opacity: 0.4 }, 2.2, 'inOut', null, false, delay);
        break;
      }
      case 'spin': { const p = P(fx.target); if (p) this.loops.push({ type: 'spin', p, t0: now }); break; }
      case 'shake': { const p = P(fx.target); if (p) setTimeout(() => this._shake(p), delay * 1000); break; }
      case 'grow': { const p = P(fx.target); if (p) this._tween(p, { scale: p.scale * 1.6 }, 1.5, 'out', null, false, delay); break; }
      case 'fade': { const p = P(fx.target); if (p) this._tween(p, { opacity: 0.15 }, 1.2, 'inOut', null, false, delay); break; }
      case 'orbit': {
        const p = P(fx.target), c = P(fx.around);
        if (p && c) this.loops.push({ type: 'orbit', p, c, r: clamp(+fx.r || Math.hypot(p.x - c.x, p.y - c.y) || 60, 25, 120), t0: now });
        break;
      }
      case 'glow': {
        const p = P(fx.target);
        if (p && p.g._glow) setTimeout(() => { p.g._glow.setAttribute('opacity', 0.9); p.g.classList.add('lit'); }, delay * 1000);
        break;
      }
      case 'flow': { const p = P(fx.target); if (p && p.path) { p.path.classList.add('flowing'); } break; }
      case 'cross':
      case 'check': this._mark(fx.target, fx.type); break;
    }
  }

  _shake(p) {
    const t0 = performance.now();
    this.loops.push({ type: 'shake', p, t0, until: t0 + 400 });
  }

  _tick(now) {
    // tweens
    for (const tw of this.tweens) {
      if (now < tw.t0) continue;
      const t = clamp((now - tw.t0) / tw.dur, 0, 1), e = tw.ease(t);
      for (const k in tw.to) tw.obj[k] = lerp(tw.from[k] ?? tw.obj[k], tw.to[k], e);
      if (t >= 1) { tw.finished = true; }
    }
    const finished = this.tweens.filter(t => t.finished);
    this.tweens = this.tweens.filter(t => !t.finished);
    for (const t of finished) if (t.done) t.done();
    // reset procedural offsets
    for (const p of this.props.values()) { p.ox = 0; p.oy = 0; p.orot = 0; }
    const sec = now / 1000;
    this.loops = this.loops.filter(l => {
      if (l.type === 'spin') l.p.orot = ((now - l.t0) / 1000) * 220;
      else if (l.type === 'orbit') { const a = (now - l.t0) / 1000 * 1.4; l.p.x = l.c.x + Math.cos(a) * l.r; l.p.y = l.c.y + Math.sin(a) * l.r * 0.55; }
      else if (l.type === 'sway') l.p.ox = Math.sin(sec * 3) * 12;
      else if (l.type === 'shake') { if (now > l.until) return false; l.p.ox = Math.sin(now / 20) * 3; }
      else if (l.type === 'mark') {
        const p = this.props.get(String(l.target));
        const pos = p ? { x: p.x, y: p.y - 28 * p.scale } : l.target === 'actor' ? { x: this.actor.headPos?.x ?? 70, y: (this.actor.headPos?.y ?? 130) - 22 } : null;
        if (pos) l.g.setAttribute('transform', `translate(${(pos.x + 18).toFixed(1)},${clamp(pos.y, 14, H).toFixed(1)}) scale(${1 + 0.06 * Math.sin(sec * 5)})`);
        else l.g.setAttribute('opacity', 0);
      }
      return true;
    });
    // actor; if holding a prop, stand next to it
    if (this.holds) {
      const hp = this.props.get(this.holds);
      if (hp && !this.actor.walkFrom) this.actor.x = lerp(this.actor.x, hp.x - (hp.def.w || 30) / 2 * hp.scale - 30, 0.2);
    }
    this.actor.update(now);
    // props
    const mags = [];
    for (const p of this.props.values()) {
      p.g.setAttribute('transform', `translate(${(p.x + p.ox).toFixed(1)},${(p.y + p.oy).toFixed(1)}) rotate(${(p.rot + p.orot).toFixed(1)}) scale(${p.scale.toFixed(3)})`);
      p.g.setAttribute('opacity', p.opacity.toFixed(2));
      if (p.def.type === 'magnet') mags.push(p);
    }
    // compass needles follow the real field
    const poles = mags.flatMap(magnetPoles);
    for (const p of this.props.values()) {
      if (p.def.type !== 'compass' || !p.g._needle) continue;
      let ang = p.def.needle != null ? +p.def.needle : 0;
      if (poles.length && p.def.needle == null) {
        const [bx, by] = fieldAt(p.x, p.y, poles);
        ang = Math.atan2(bx, -by) / DEG;
      }
      p.needle = p.needle == null ? ang : p.needle + (((ang - p.needle + 540) % 360) - 180) * 0.12;
      p.g._needle.setAttribute('transform', `rotate(${(p.needle - p.rot).toFixed(1)})`);
    }
    // field lines (recomputed while magnets move)
    if (this.field && now >= this.field.t0) {
      const sig = mags.map(m => `${m.x.toFixed(0)},${m.y.toFixed(0)},${m.rot.toFixed(0)}`).join('|');
      if (sig !== this._fieldSig || this._fieldDirty) {
        this._fieldSig = sig; this._fieldDirty = false;
        const set = this.field.target === 'all' ? mags : mags.filter(m => m.id === String(this.field.target));
        this._drawField(set.length ? (this.field.target === 'all' ? set : mags) : [], this.field.reverse);
      }
    }
    this._raf = requestAnimationFrame(t => this._tick(t));
  }

  _drawField(mags, reverse) {
    this.fieldLayer.innerHTML = '';
    if (!mags.length) return;
    const lines = traceFieldLines(mags);
    for (const pts of lines) {
      const seq = reverse ? [...pts].reverse() : pts;
      const d = 'M' + seq.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
      el('path', { d, class: reverse ? 'field-line wrong' : 'field-line' }, this.fieldLayer);
      // arrow at the middle of each line
      const mid = Math.floor(seq.length / 2);
      if (seq.length > 8) {
        const a = seq[mid - 1], b = seq[mid + 1];
        el('path', { d: `M${a[0].toFixed(1)},${a[1].toFixed(1)} L${b[0].toFixed(1)},${b[1].toFixed(1)}`, class: 'field-arrow', 'marker-end': reverse ? 'url(#fieldhead-wrong)' : 'url(#fieldhead)' }, this.fieldLayer);
      }
    }
  }
}

export const STAGE_SIZE = { W, H, GROUND };
