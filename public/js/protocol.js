// Streaming parser for the tutor's tagged-line protocol:
//   @scene {...}\n@say text\n@assess {...}
// Text arrives in arbitrary chunks. Scene/assess fire as soon as their JSON is complete,
// say text fires incrementally so speech can start mid-stream.

const TAG_RE = /^@(scene|say|assess)\b\s?/;

export class ProtocolParser {
  constructor({ onScene, onSayDelta, onAssess } = {}) {
    this.onScene = onScene || (() => {});
    this.onSayDelta = onSayDelta || (() => {});
    this.onAssess = onAssess || (() => {});
    this.buf = '';        // text of the current, not yet finished line
    this.tag = null;      // block we are in: scene | say | assess
    this.json = '';       // pending JSON for scene/assess
    this.emitted = 0;     // chars of the current line's say-content already emitted
    this.say = '';        // all spoken text this turn
  }

  feed(chunk) {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '');
      this.buf = this.buf.slice(nl + 1);
      this._line(line, true);
      this.emitted = 0;
    }
    if (this.buf) this._line(this.buf, false);
  }

  end() {
    if (this.buf) { this._line(this.buf, true); this.buf = ''; this.emitted = 0; }
    this._flushJson();
    this.tag = null;
  }

  // Handles a line; for an unfinished line only streaming @say text is acted on.
  _line(line, complete) {
    const m = line.match(TAG_RE);
    let content;
    if (m) {
      if (this.emitted === 0 || m[1] !== 'say') { this._flushJson(); }
      this.tag = m[1];
      content = line.slice(m[0].length);
      if (this.tag !== 'say') {
        if (complete) { this.json = content; this._tryJson(); }
        return;
      }
    } else {
      if (!line.trim() || /^```/.test(line.trim())) return;
      if (line.startsWith('@')) return; // unknown or not-yet-complete tag
      if (this.tag === 'scene' || this.tag === 'assess') {
        if (complete) { this.json += line; this._tryJson(); }
        return;
      }
      if (this.tag !== 'say') return;
      content = ' ' + line; // continuation of spoken text on a new line
    }
    if (content.length > this.emitted) {
      const d = content.slice(this.emitted);
      this.emitted = content.length;
      this.say += d;
      this.onSayDelta(d);
    }
  }

  _tryJson() {
    const obj = parseLooseJson(this.json);
    if (!obj) return;
    const tag = this.tag;
    this.json = '';
    this.tag = null;
    if (tag === 'scene') this.onScene(obj);
    else if (tag === 'assess') this.onAssess(obj);
  }

  _flushJson() {
    if ((this.tag === 'scene' || this.tag === 'assess') && this.json) this._tryJson();
    this.json = '';
  }
}

export function parseLooseJson(s) {
  if (!s) return null;
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

// Splits streaming speech text into speakable sentences.
export class SentenceChunker {
  constructor(onSentence) { this.onSentence = onSentence; this.buf = ''; }
  push(text) {
    this.buf += text;
    // sentence end followed by space; avoid splitting decimals like 3.5
    const re = /([^.!?]*?[.!?]+["')\]]?)(\s+)/g;
    let m, last = 0;
    while ((m = re.exec(this.buf))) {
      const s = m[1].trim();
      if (s.length >= 2) this.onSentence(s);
      last = re.lastIndex;
    }
    if (last) this.buf = this.buf.slice(last);
  }
  flush() {
    const s = this.buf.trim();
    this.buf = '';
    if (s) this.onSentence(s);
  }
}
