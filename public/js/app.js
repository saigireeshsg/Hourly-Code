import { Stage } from './stage.js';
import { Listener, Speaker, micLevel } from './voice.js';
import { ProtocolParser, SentenceChunker } from './protocol.js';
import { pickBrain } from './brain.js';
import { startMessage, liveMessage } from './prompt.js';

const $ = id => document.getElementById(id);
const app = $('app');

const TOPICS = ['Magnets', 'Gravity', 'Photosynthesis', 'Electric circuits', 'The water cycle', 'Phases of the Moon', 'Floating and sinking', 'Heat and temperature'];

// Instant stickman reactions to words heard mid-sentence, before the tutor replies.
const INSTANT = [
  { kind: 'repel', re: /\b(repel|repels|repelling|push(es)? (each other )?away|push(es)? apart|fly apart|move away)\b/i, label: 'push apart' },
  { kind: 'attract', re: /\b(attract|attracts|attraction|stick|sticks|pull(s)? (each other )?together|snap together|cling|pull(s)? towards?)\b/i, label: 'pull together' },
  { kind: 'field', re: /\b(field lines?|lines of force|magnetic field|field)\b/i, label: 'field lines' },
  { kind: 'fall', re: /\b(fall|falls|falling|drop|drops|dropped)\b/i, label: 'falls' },
  { kind: 'unsure', re: /\b(i don'?t know|not sure|no idea|confus\w*)\b/i, label: 'unsure' },
  { kind: 'think', re: /\b(hmm+|umm+|uh+|let me think)\b/i, label: 'thinking' },
];

const S = {
  topic: 'Magnets', level: 'Middle school', lang: 'en-US',
  history: [],               // [{role, content}] sent to the tutor
  state: 'setup',            // setup | thinking | speaking | listening | muted
  brain: null,
  abort: null,
  live: { inFlight: null, last: 0, gen: 0 },
  firedInstant: new Set(),
  misconceptions: new Map(),
  bargeIn: false,
};

const stage = new Stage($('stage'));
let speaker, listener;

// ---------------- setup screen ----------------
function renderTopics() {
  const box = $('topics');
  box.innerHTML = '';
  for (const t of TOPICS) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = t; b.setAttribute('aria-pressed', String(t === S.topic && !$('customTopic').value));
    b.onclick = () => { S.topic = t; $('customTopic').value = ''; renderTopics(); previewTopic(); };
    box.appendChild(b);
  }
}
function previewTopic() {
  stage.setScene({ caption: '', actor: { x: 70, pose: 'wave', face: 'happy' }, props: S.topic === 'Magnets' ? [{ id: 'm1', type: 'magnet', x: 190, y: 175 }, { id: 'm2', type: 'magnet', x: 310, y: 175, flip: true }] : [] });
}
$('customTopic').addEventListener('input', renderTopics);

function fillVoices() {
  const sel = $('voiceSel');
  const prev = sel.value;
  sel.innerHTML = '';
  if (S.brain?.tts) sel.add(new Option('Studio voice (server, clearest)', '__server__'));
  for (const v of (speaker?.voices || []).slice(0, 30)) sel.add(new Option(`${v.name} (${v.lang})`, v.name));
  if (!sel.options.length) sel.add(new Option('Default voice', ''));
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}
$('rate').oninput = e => { $('rateVal').textContent = (+e.target.value).toFixed(2).replace(/0$/, '') + '×'; if (speaker) speaker.rate = +e.target.value; };
$('silence').oninput = e => { $('silVal').textContent = (+e.target.value).toFixed(1) + ' s'; if (listener) listener.silenceMs = +e.target.value * 1000; };
$('voiceSel').onchange = e => speaker?.setVoice(e.target.value);
$('voiceSel').addEventListener('focus', fillVoices);
$('lang').onchange = e => { S.lang = e.target.value; makeSpeaker(); fillVoices(); };

function makeSpeaker() {
  speaker = new Speaker({
    lang: S.lang,
    rate: +$('rate').value,
    ttsUrl: S.brain?.tts || null,
    onStart: () => setState('speaking'),
    onEnd: (interrupted) => { if (!interrupted) afterTutorSpoke(); },
    onSentence: (s) => highlightSentence(s),
  });
}

$('startBtn').onclick = async () => {
  S.topic = $('customTopic').value.trim() || S.topic;
  S.level = $('level').value;
  S.bargeIn = $('bargeIn').checked;
  speaker.unlock();
  if (speaker.voiceName == null && $('voiceSel').value) speaker.setVoice($('voiceSel').value);
  $('topicPill').textContent = S.topic;
  makeListener();
  if (!listener.supported) {
    toast('Voice input is not supported in this browser. You can type instead.');
    $('typebar').hidden = false;
  } else {
    micLevel(l => $('ring').style.setProperty('--lvl', (1 + l * 0.35).toFixed(3)));
  }
  S.history = [{ role: 'user', content: startMessage(S.topic, S.level) }];
  setState('thinking');
  runTurn();
};

// ---------------- state ----------------
function setState(st) {
  S.state = st;
  app.dataset.state = st;
  const hint = {
    thinking: 'Fey is thinking… tap to cancel',
    speaking: 'Tap to interrupt',
    listening: 'Listening — just talk. Tap when done',
    muted: 'Mic paused — tap to talk',
  }[st] || '';
  $('micHint').textContent = hint;
  $('micBtn').setAttribute('aria-label', hint || 'Microphone');
}

// ---------------- tutor turn ----------------
async function runTurn() {
  cancelLive();
  S.abort?.abort();
  const ctl = new AbortController();
  S.abort = ctl;
  setState('thinking');
  listener?.stop();
  $('tutorText').textContent = '';
  S.sayText = '';
  speaker.begin();
  const chunker = new SentenceChunker(s => speaker.enqueue(s));
  const parser = new ProtocolParser({
    onScene: sc => applyScene(sc),
    onSayDelta: d => { S.sayText += d; renderTutorText(); chunker.push(d); },
    onAssess: a => applyAssess(a),
  });
  let full = '';
  try {
    full = await S.brain.turn({
      history: S.history, mode: 'turn', signal: ctl.signal,
      onText: d => { full += d; parser.feed(d); },
    });
    parser.end();
    chunker.flush();
  } catch (e) {
    if (ctl.signal.aborted) return;
    console.error(e);
    toast(friendlyError(e), true);
    speaker.cancel();
    S.history.push({ role: 'assistant', content: '@say Sorry, I lost my train of thought. Could you say that again?' });
    $('tutorText').textContent = 'Sorry — I lost connection. Say that again?';
    startListening();
    return;
  }
  if (S.abort !== ctl) return;
  S.history.push({ role: 'assistant', content: full.trim() || '@say Go on.' });
  logMsg('t', parser.say.trim());
  speaker.close();
  if (!parser.say.trim()) afterTutorSpoke();
  // Half-duplex by default (phone speakers echo into the mic). With headphones, listen while speaking.
  if (S.bargeIn) startListening(true);
}

function afterTutorSpoke() {
  if (S.state === 'setup') return;
  $('tutorText').querySelectorAll('.now').forEach(n => n.classList.remove('now'));
  startListening();
}

function startListening(whileSpeaking = false) {
  S.firedInstant.clear();
  $('chips').innerHTML = '';
  if (!listener?.supported) { setState('muted'); $('micHint').textContent = 'Type your answer below'; return; }
  listener.resetTurn();
  renderLive('', '');
  listener.start();
  if (!whileSpeaking) setState('listening');
}

function makeListener() {
  listener = new Listener({
    lang: S.lang,
    silenceMs: +$('silence').value * 1000,
    onInterim: (text, interim) => onStudentSpeech(text, interim),
    onPhrase: (_p, soFar) => maybeLive(soFar),
    onTurnEnd: text => studentTurn(text),
    onError: err => {
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        toast('Microphone blocked. Allow mic access, or type your answers.', true);
        $('typebar').hidden = false; setState('muted');
      }
    },
  });
}

function onStudentSpeech(text, interim) {
  if (S.state === 'speaking') {
    // barge-in (headphones mode): a few real words interrupt the tutor
    if (S.bargeIn && text.split(/\s+/).length >= 3) { speaker.cancel(); S.abort?.abort(); setState('listening'); }
    else return;
  }
  if (S.state !== 'listening') return;
  renderLive(text, interim);
  for (const r of INSTANT) {
    if (!S.firedInstant.has(r.kind) && r.re.test(text)) {
      S.firedInstant.add(r.kind);
      stage.react(r.kind);
      chip(r.label);
    }
  }
}

function studentTurn(text) {
  text = text.trim();
  if (!text) return;
  if (S.state === 'speaking' || S.state === 'thinking') { speaker.cancel(); S.abort?.abort(); }
  logMsg('s', text);
  renderLive('', '');
  const last = S.history[S.history.length - 1];
  if (last && last.role === 'user') last.content += ' ' + text;
  else S.history.push({ role: 'user', content: text });
  runTurn();
}

// Live analysis while the student is still talking: act out + assess the partial answer.
function maybeLive(soFar) {
  if (S.state !== 'listening' || !S.brain) return;
  const now = Date.now();
  if (S.live.inFlight || now - S.live.last < 2500 || soFar.split(/\s+/).length < 6) return;
  S.live.last = now;
  const ctl = new AbortController();
  const gen = ++S.live.gen;
  S.live.inFlight = ctl;
  const parser = new ProtocolParser({
    onScene: sc => { if (gen === S.live.gen && S.state === 'listening') applyScene(sc, true); },
    onAssess: a => { if (gen === S.live.gen && S.state === 'listening') applyAssess(a); },
  });
  S.brain.turn({ history: [...S.history, { role: 'user', content: liveMessage(soFar) }], mode: 'live', signal: ctl.signal, onText: d => parser.feed(d) })
    .then(() => parser.end())
    .catch(() => {})
    .finally(() => { if (S.live.inFlight === ctl) S.live.inFlight = null; });
}
function cancelLive() { S.live.gen++; S.live.inFlight?.abort(); S.live.inFlight = null; }

// ---------------- rendering ----------------
const MOOD_LABEL = { neutral: 'Watching', testing: 'Testing your idea', misconception: 'Hmm… does that work?', correct: 'That works!' };
function applyScene(sc, live = false) {
  stage.setScene(sc);
  const mood = MOOD_LABEL[sc.mood] ? sc.mood : 'neutral';
  $('mood').dataset.mood = mood;
  $('mood').textContent = (live ? 'Live · ' : '') + MOOD_LABEL[mood];
  $('caption').textContent = sc.caption || ' ';
}

function applyAssess(a) {
  if (!a || typeof a !== 'object') return;
  const u = Math.max(0, Math.min(100, Math.round(+a.understanding || 0)));
  $('meterVal').textContent = u;
  $('meterArc').setAttribute('stroke-dasharray', `${(u / 100) * 97.4} 100`);
  $('barFill').style.width = u + '%';
  $('barFill').style.backgroundPosition = `${-u * 2}px 0`;
  const order = ['explain', 'probe', 'predict', 'repair', 'simplify', 'wrap'];
  const pi = order.indexOf(a.phase);
  document.querySelectorAll('#steps li').forEach((li, i) => { li.classList.toggle('on', i === pi); li.classList.toggle('done', pi >= 0 && i < pi); });
  if (Array.isArray(a.misconceptions)) {
    for (const m of a.misconceptions) {
      if (!m || !m.belief) continue;
      const id = m.id || m.belief;
      const prev = S.misconceptions.get(id);
      if (!prev) { toast('Spotted: “' + m.belief + '”', true, 'mis'); chip('? ' + shorten(m.belief), true); }
      else if (prev.status !== 'resolved' && m.status === 'resolved') toast('Fixed: ' + shorten(m.truth || m.belief));
      S.misconceptions.set(id, { ...prev, ...m });
    }
  }
  list($('miscon'), [...S.misconceptions.values()], m => {
    const li = document.createElement('li');
    li.dataset.status = m.status || 'open';
    li.innerHTML = `<span class="status"></span><div class="belief"></div><div class="truth"></div>`;
    li.querySelector('.status').textContent = m.status || 'open';
    li.querySelector('.belief').textContent = m.belief;
    li.querySelector('.truth').textContent = m.status === 'open' ? 'Fey is testing this idea…' : '→ ' + (m.truth || '');
    return li;
  }, 'None spotted yet.');
  if (Array.isArray(a.mastered)) list($('mastered'), [...new Set(a.mastered)], t => textLi(t), 'Nothing yet. Keep explaining!');
  if (Array.isArray(a.gaps)) list($('gaps'), a.gaps, t => textLi(t), '—');
  if (a.note) $('note').textContent = 'Tutor plan: ' + a.note;
}

function renderTutorText() {
  $('tutorText').textContent = S.sayText;
}
function highlightSentence(s) {
  const full = S.sayText;
  const i = full.indexOf(s);
  const box = $('tutorText');
  if (i < 0) { box.textContent = full; return; }
  box.textContent = '';
  box.append(full.slice(0, i));
  const mark = document.createElement('span'); mark.className = 'now'; mark.textContent = s;
  box.append(mark, full.slice(i + s.length));
}

function renderLive(text, interim) {
  const el = $('liveText');
  el.textContent = '';
  if (!text) return;
  const committed = interim && text.endsWith(interim) ? text.slice(0, text.length - interim.length) : text;
  el.append(committed);
  if (interim && text.endsWith(interim)) { const sp = document.createElement('span'); sp.className = 'interim'; sp.textContent = interim; el.append(sp); }
}

function logMsg(who, text) {
  if (!text) return;
  const d = document.createElement('div');
  d.className = 'msg ' + who; d.textContent = text;
  $('log').appendChild(d);
  $('log').scrollTop = $('log').scrollHeight;
}

function chip(label, mis = false) {
  const c = document.createElement('span');
  c.className = 'chip' + (mis ? ' new-mis' : ''); c.textContent = label;
  $('chips').appendChild(c);
  while ($('chips').children.length > 5) $('chips').firstChild.remove();
}

let toastTimer;
function toast(msg, important = false, kind = '') {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), important ? 3800 : 2400);
}

function list(ul, items, make, empty) {
  ul.innerHTML = '';
  if (!items.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = empty; ul.appendChild(li); return; }
  for (const it of items) ul.appendChild(make(it));
}
const textLi = t => { const li = document.createElement('li'); li.textContent = String(t); return li; };
const shorten = s => (String(s).length > 42 ? String(s).slice(0, 40) + '…' : String(s));

function friendlyError(e) {
  const code = e && e.code;
  if (code === 'not_granted') return 'Claude access was declined for this page.';
  if (code === 'rate_limited') return 'Too many requests — give it a moment.';
  return 'Could not reach the tutor. ' + (e?.message ? '(' + e.message + ')' : '');
}

// ---------------- controls ----------------
$('micBtn').onclick = () => {
  switch (S.state) {
    case 'speaking': speaker.cancel(); S.abort?.abort(); startListening(); break;          // interrupt
    case 'thinking': S.abort?.abort(); speaker.cancel(); startListening(); break;          // cancel
    case 'listening':
      if (listener.text) listener.commit();                                               // send now
      else { listener.stop(); setState('muted'); }                                       // pause mic
      break;
    case 'muted': speaker.unlock(); startListening(); break;
  }
};
$('replayBtn').onclick = () => stage.replay();
$('keyboardBtn').onclick = () => { const tb = $('typebar'); tb.hidden = !tb.hidden; if (!tb.hidden) $('typeInput').focus(); };
$('typebar').onsubmit = e => {
  e.preventDefault();
  const v = $('typeInput').value.trim();
  if (!v || S.state === 'setup') return;
  $('typeInput').value = '';
  listener?.resetTurn();
  studentTurn(v);
};
const sheet = $('insights');
$('insightsBtn').onclick = $('meterBtn').onclick = () => sheet.classList.toggle('open');
$('sheetHandle').onclick = () => sheet.classList.remove('open');
document.addEventListener('pointerdown', e => { if (sheet.classList.contains('open') && !sheet.contains(e.target) && !e.target.closest('#insightsBtn,#meterBtn')) sheet.classList.remove('open'); });

// ---------------- boot ----------------
(async function boot() {
  renderTopics();
  previewTopic();
  S.brain = await pickBrain();
  makeSpeaker();
  setTimeout(fillVoices, 400);
  const status = { server: 'Connected to Claude.', artifact: 'Using Claude through this page — you\'ll be asked to allow it.', demo: 'Demo mode: offline scripted tutor (best with the Magnets topic). Run the server with an API key for the real tutor.' };
  $('brainStatus').textContent = status[S.brain.kind];
  if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) $('brainStatus').textContent += ' Voice input isn\'t available in this browser — use Chrome or Safari, or type.';
  if (new URLSearchParams(location.search).has('autostart')) $('startBtn').click();
})();
