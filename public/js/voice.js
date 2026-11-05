// Voice I/O: live speech recognition (with interim results + end-of-turn detection)
// and a sentence-queued speaker (browser neural voices, or a server TTS stream).

// ---------------- Listening ----------------
export class Listener {
  constructor({ lang = 'en-US', silenceMs = 1300, onInterim, onPhrase, onTurnEnd, onState, onError } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    this.SR = SR;
    this.lang = lang;
    this.silenceMs = silenceMs;
    this.onInterim = onInterim || (() => {});
    this.onPhrase = onPhrase || (() => {});
    this.onTurnEnd = onTurnEnd || (() => {});
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.active = false;     // we want the mic on
    this.running = false;    // recognizer actually running
    this.finalText = '';     // committed text for the current student turn
    this.interim = '';
    this.timer = null;
  }

  start() {
    if (!this.supported) return false;
    this.active = true;
    this._spawn();
    return true;
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    try { this.rec && this.rec.stop(); } catch {}
  }

  // Abort the current turn's buffered text (e.g. after it has been sent).
  resetTurn() { this.finalText = ''; this.interim = ''; clearTimeout(this.timer); }

  // Ends the turn right now (tap-to-send).
  commit() {
    clearTimeout(this.timer);
    const text = (this.finalText + ' ' + this.interim).replace(/\s+/g, ' ').trim();
    this.resetTurn();
    if (text) this.onTurnEnd(text);
  }

  get text() { return (this.finalText + ' ' + this.interim).replace(/\s+/g, ' ').trim(); }

  _spawn() {
    if (this.running) return;
    const rec = new this.SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.rec = rec;
    rec.onstart = () => { this.running = true; this.onState('listening'); };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript;
        if (r.isFinal) {
          const phrase = t.trim();
          if (phrase) {
            this.finalText = (this.finalText + ' ' + phrase).trim();
            this.onPhrase(phrase, this.finalText);
          }
        } else interim += t;
      }
      this.interim = interim.trim();
      this.onInterim(this.text, this.interim);
      this._armSilence();
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.active = false; this.onError(e.error); }
      else if (e.error !== 'no-speech' && e.error !== 'aborted') this.onError(e.error);
    };
    rec.onend = () => {
      this.running = false;
      // Mobile browsers end sessions frequently; keep the mic alive while active.
      if (this.active) setTimeout(() => this.active && this._spawn(), 120);
      else this.onState('idle');
    };
    try { rec.start(); } catch { this.running = false; }
  }

  _armSilence() {
    clearTimeout(this.timer);
    if (!this.text) return;
    // Interim-only text needs a little longer: the recognizer may still revise it.
    const wait = this.interim ? this.silenceMs + 500 : this.silenceMs;
    this.timer = setTimeout(() => this.commit(), wait);
  }
}

// Optional mic level meter for the UI pulse.
export async function micLevel(onLevel) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const data = new Uint8Array(an.fftSize);
    const loop = () => {
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      requestAnimationFrame(loop);
    };
    loop();
    return { stop: () => { stream.getTracks().forEach(t => t.stop()); ctx.close(); } };
  } catch { return null; }
}

// ---------------- Speaking ----------------
const PREFERRED_VOICES = [
  /natural/i, /neural/i, /premium/i, /enhanced/i,
  /Google US English/i, /Google UK English Female/i, /Samantha/i, /Ava/i, /Allison/i, /Serena/i, /Karen/i, /Daniel/i,
];

export function rankVoices(voices, lang = 'en') {
  const base = lang.split('-')[0];
  return voices
    .filter(v => v.lang && v.lang.toLowerCase().startsWith(base))
    .map(v => {
      let score = 0;
      PREFERRED_VOICES.forEach((re, i) => { if (re.test(v.name)) score += 100 - i * 5; });
      if (v.lang.toLowerCase() === lang.toLowerCase()) score += 10;
      if (!v.localService) score += 5; // cloud voices tend to sound better
      if (/compact|novelty|whisper|bells|bad news|zarvox|trinoids|albert|bahh|boing|bubbles|cellos|hysterical|organ|superstar|wobble|jester/i.test(v.name)) score -= 200;
      return { v, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.v);
}

export class Speaker {
  constructor({ lang = 'en-US', rate = 1.02, onStart, onEnd, onSentence, ttsUrl = null } = {}) {
    this.lang = lang;
    this.rate = rate;
    this.onStart = onStart || (() => {});
    this.onEnd = onEnd || (() => {});
    this.onSentence = onSentence || (() => {});
    this.ttsUrl = ttsUrl;       // e.g. "/api/tts" when a server voice is configured
    this.queue = [];
    this.speaking = false;
    this.closed = true;         // true once the current reply has finished streaming
    this.voice = null;
    this.voiceName = null;
    this.synth = window.speechSynthesis;
    this.audio = null;
    if (this.synth) {
      const pick = () => {
        const ranked = rankVoices(this.synth.getVoices(), this.lang);
        this.voices = ranked;
        if (!this.voice || !ranked.includes(this.voice)) this.voice = (this.voiceName && ranked.find(v => v.name === this.voiceName)) || ranked[0] || null;
      };
      pick();
      this.synth.onvoiceschanged = pick;
    }
  }

  setVoice(name) {
    this.voiceName = name;
    if (name === '__server__') { this.voice = null; return; }
    const v = (this.voices || []).find(v => v.name === name);
    if (v) this.voice = v;
  }

  // iOS/Safari only allow speech after a user gesture; call this from a tap.
  unlock() {
    if (this.synth) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; this.synth.speak(u); }
    if (!this._audioUnlocked) {
      // Playing any audio inside the tap lets later server-voice clips autoplay on iOS.
      const a = new Audio(silentWav());
      a.play().catch(() => {});
      this._audioUnlocked = true;
    }
  }

  get usingServer() { return !!this.ttsUrl && this.voiceName !== '__browser__' && (this.voiceName === '__server__' || !this.voiceName); }

  begin() { this.closed = false; }
  enqueue(sentence) {
    const s = clean(sentence);
    if (!s) return;
    const item = { text: sentence, spoken: s };
    if (this.usingServer) item.audio = this._fetchAudio(s); // prefetch while earlier sentences play
    this.queue.push(item);
    if (!this.speaking) this._next();
  }
  close() { this.closed = true; if (!this.speaking && !this.queue.length) this._finish(); }

  cancel() {
    this.queue = [];
    this.closed = true;
    if (this.synth) this.synth.cancel();
    if (this.audio) { this.audio.pause(); this.audio = null; }
    if (this.speaking) { this.speaking = false; this.onEnd(true); }
  }

  get busy() { return this.speaking || this.queue.length > 0 || !this.closed; }

  _finish() { if (this._wasSpeaking) { this._wasSpeaking = false; this.onEnd(false); } }

  async _next() {
    const item = this.queue.shift();
    if (!item) { this.speaking = false; if (this.closed) this._finish(); return; }
    if (!this.speaking) { this.speaking = true; this._wasSpeaking = true; this.onStart(); }
    this.onSentence(item.text);
    const done = () => { this._next(); };
    if (item.audio) {
      const url = await item.audio.catch(() => null);
      if (!this.speaking) return; // cancelled while fetching
      if (url) {
        const a = new Audio(url);
        this.audio = a;
        a.onended = () => { URL.revokeObjectURL(url); if (this.audio === a) { this.audio = null; done(); } };
        a.onerror = () => { if (this.audio === a) { this.audio = null; this._browserSay(item.spoken, done); } };
        a.play().catch(() => { this.audio = null; this._browserSay(item.spoken, done); });
        return;
      }
    }
    this._browserSay(item.spoken, done);
  }

  _browserSay(text, done) {
    if (!this.synth) { setTimeout(done, Math.min(4000, text.length * 55)); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.voice ? this.voice.lang : this.lang;
    if (this.voice) u.voice = this.voice;
    u.rate = this.rate;
    u.pitch = 1.0;
    let finished = false;
    const fin = () => { if (finished) return; finished = true; clearTimeout(guard); if (this.speaking) done(); };
    u.onend = fin;
    u.onerror = fin;
    // Some engines never fire onend; guard with a generous timeout.
    const guard = setTimeout(fin, 2500 + text.length * 90);
    this.synth.speak(u);
  }

  async _fetchAudio(text) {
    const res = await fetch(this.ttsUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error('tts ' + res.status);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }
}

function clean(s) {
  return String(s)
    .replace(/[*_#`~>|]/g, '')
    .replace(/\bN pole\b/g, 'north pole').replace(/\bS pole\b/g, 'south pole')
    .replace(/\s+/g, ' ')
    .trim();
}

function silentWav() {
  const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  let bin = ''; new Uint8Array(buf).forEach(b => bin += String.fromCharCode(b));
  return 'data:audio/wav;base64,' + btoa(bin);
}
