import test from 'node:test';
import assert from 'node:assert/strict';
import { ProtocolParser, SentenceChunker } from '../public/js/protocol.js';

const REPLY = '@scene {"caption":"Two magnets","mood":"misconception","props":[{"id":"m1","type":"magnet","x":200,"y":170}]}\n' +
  '@say Interesting, so the arrows start at south. Which way does the compass point?\n' +
  '@assess {"understanding":40,"phase":"repair","misconceptions":[{"id":"dir","belief":"S to N","truth":"N to S","status":"open"}]}\n';

function run(chunks) {
  const out = { scenes: [], say: '', assess: [] };
  const p = new ProtocolParser({ onScene: s => out.scenes.push(s), onSayDelta: d => (out.say += d), onAssess: a => out.assess.push(a) });
  for (const c of chunks) p.feed(c);
  p.end();
  return out;
}

for (const size of [1, 3, 7, 50, 10000]) {
  test(`parses a reply streamed in ${size}-char chunks`, () => {
    const chunks = REPLY.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'));
    const out = run(chunks);
    assert.equal(out.scenes.length, 1);
    assert.equal(out.scenes[0].caption, 'Two magnets');
    assert.equal(out.say, 'Interesting, so the arrows start at south. Which way does the compass point?');
    assert.equal(out.assess.length, 1);
    assert.equal(out.assess[0].misconceptions[0].id, 'dir');
  });
}

test('handles a final line without newline and say split across lines', () => {
  const out = run(['@scene {"caption":"x"}\n@say Hello there.\nHow are you?\n@assess {"understanding":5}']);
  assert.equal(out.say, 'Hello there. How are you?');
  assert.equal(out.assess[0].understanding, 5);
});

test('live mode: scene and assess only', () => {
  const out = run(['@scene {"caption":"live"}\n', '@assess {"understanding":10}\n']);
  assert.equal(out.say, '');
  assert.equal(out.scenes[0].caption, 'live');
});

test('sentence chunker emits sentences as they complete', () => {
  const got = [];
  const c = new SentenceChunker(s => got.push(s));
  c.push('Nice work! So what ha'); assert.deepEqual(got, ['Nice work!']);
  c.push('ppens next? It costs 3.5 dollars'); assert.deepEqual(got, ['Nice work!', 'So what happens next?']);
  c.flush(); assert.equal(got[2], 'It costs 3.5 dollars');
});
