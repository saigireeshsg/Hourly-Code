# Fey — a Feynman‑technique voice tutor

A mobile-first, voice-first tutor. The student explains a concept out loud. The tutor ("Fey") asks short Feynman-style questions. On screen, a stickman acts out exactly what the student said, including ideas that are wrong, so the student can see their own idea play out and catch the gap themselves.

**What it does**

- **Real-time conversation.** The browser's speech recognition streams a live transcript, with words shown as they are recognised. A pause in speech ends the student's turn. Claude's reply streams back and is spoken sentence by sentence, so the voice starts before the full reply has arrived. Tap the mic to interrupt. With headphones, students can interrupt just by talking.
- **The stickman stage.** An SVG stickman with 15 poses and facial expressions, plus about 25 props: magnets, compass, bulb, battery, wire, sun, earth, apple, feather and more. Effects include attract, repel, falling, orbit, glowing and current flow. Magnetic field lines and compass needles are **computed from the actual magnet positions**. When a student claims field lines run south to north, the stage draws them that way in orange and marks the claim.
- **Reactions while the student is still talking.**
  1. *Instantly:* key words such as "repel", "stick" or "field lines" trigger stickman reactions right away, before any AI call.
  2. *Mid-sentence:* every few seconds of speech, a "live partial" request asks Claude to act out and assess what the student has said so far.
  3. *End of turn:* the full tutor reply (scene, spoken question, assessment).
- **Misconception tracking.** Each turn returns an assessment: an understanding score (0–100), the current Feynman phase (explain → probe → predict → repair → simplify → wrap), what the student has mastered, gaps, and misconceptions marked open, repairing or resolved. New misconceptions also appear as a pop-up message.

## Run it

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start      # http://localhost:3000
```

Open the page in **Chrome (Android/desktop) or Safari (iOS)**. Those browsers support the Web Speech API. To use it on a phone, serve it over HTTPS, because microphone access needs a secure origin. For example, run `npx localtunnel --port 3000` or deploy it to any Node host.

If no API key is set, the app runs an **offline demo tutor**: a scripted lesson on magnets. You can use it to try the whole UI without an API key.

| Env var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Claude API credentials (server side only) |
| `TUTOR_MODEL` | `claude-opus-5-5` | Tutor model |
| `TUTOR_EFFORT` | `low` | Lower effort gives faster first words, which matters for voice |
| `ELEVENLABS_API_KEY` | – | Optional. Adds a studio-quality voice instead of the browser's built-in one |
| `ELEVENLABS_VOICE_ID` | `21m00Tcm4TlvDq8ikWAM` | ElevenLabs voice |
| `PORT` | `3000` | |

Voice quality: without ElevenLabs, the app picks the best voice the device has. It prefers voices marked "Natural", "Neural", "Premium" or "Enhanced", and Google/Apple voices such as Samantha or Ava. Students can change the voice and speaking speed under *Voice settings*.

`npm run build:standalone` writes `dist/feynman-tutor.html`, a single self-contained file. When that file is opened inside a claude.ai artifact, it uses the viewer's own Claude through the artifact runtime. Anywhere else it falls back to the demo tutor.

## How it fits together

```
public/js/voice.js     Listener (live speech-to-text, end-of-turn detection), Speaker (speaks each sentence as it arrives; browser or ElevenLabs voice)
public/js/brain.js     Where replies come from: Server (Claude via server.js) | Artifact (claude.ai) | Demo (offline)
public/js/prompt.js    Tutor instructions + output format (shared by server and browser)
public/js/protocol.js  Streaming parser for "@scene / @say / @assess" lines + sentence chunker
public/js/stage.js     Stickman, props, effects, magnetic field tracing
public/js/app.js       Conversation flow, live reactions, understanding panel
server.js              Static files + /api/turn (streams Claude's reply as SSE) + /api/tts
```

The model replies with three tagged lines in a fixed order:

```
@scene {"caption":"Two north poles pulling together?","mood":"misconception","actor":{"pose":"pull","say":"N + N stick!"},"props":[...],"fx":[{"type":"attract","a":"m1","b":"m2"},{"type":"cross","target":"m2"}]}
@say Okay, I'm pushing two north poles together like you said. If north and north stick, what would north and south do?
@assess {"understanding":30,"phase":"repair","misconceptions":[{"id":"like_poles_attract","belief":"Two north poles pull together","truth":"Like poles repel","status":"repairing"}]}
```

The scene line comes first, so the stickman starts moving before the tutor begins to speak.

## Tests

```bash
npm test
```
