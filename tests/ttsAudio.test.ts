// Run: npm run test:sync   (or: npx tsx tests/ttsAudio.test.ts)
import assert from "node:assert/strict";
import { ttsPcm, pcmToWav } from "../ttsAudio";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const tone = (n: number) => { const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 5)), i * 2); return b; };
// What the current Gemini voices send: a WAV with the content-credentials (C2PA) block after the sound.
const geminiWav = (pcm: Buffer, rate = 24000) => {
  const wav = pcmToWav(pcm, rate, 1);
  const c2pa = Buffer.concat([Buffer.from("C2PA"), Buffer.alloc(4), Buffer.alloc(6066, 0xb1)]);
  c2pa.writeUInt32LE(6066, 4);
  const all = Buffer.concat([wav, c2pa]);
  all.writeUInt32LE(all.length - 8, 4);
  return all;
};

test("a Gemini WAV: only its sound, never the header or the C2PA block after it (the static between phrases)", () => {
  const pcm = tone(24000);
  const r = ttsPcm(geminiWav(pcm), "audio/wav")!;
  assert.equal(r.sampleRate, 24000);
  assert.equal(r.pcm.length, pcm.length);
  assert.ok(r.pcm.equals(pcm));
  assert.ok(!r.pcm.includes(Buffer.from("C2PA")) && !r.pcm.includes(Buffer.from("RIFF")));
});

test("its own sample rate is kept", () => {
  assert.equal(ttsPcm(geminiWav(tone(100), 44100), "audio/wav")!.sampleRate, 44100);
});

test("raw PCM (older voices) passes through, cut to whole samples, rate from the type", () => {
  const odd = Buffer.concat([tone(50), Buffer.from([7])]);
  const r = ttsPcm(odd, "audio/L16;codec=pcm;rate=24000")!;
  assert.equal(r.pcm.length, 100);
  assert.equal(r.sampleRate, 24000);
  assert.equal(ttsPcm(tone(10), "audio/L16;rate=16000")!.sampleRate, 16000);
});

test("a WAV whose data chunk claims more than it holds is cut at its end; nothing else is sound", () => {
  const w = pcmToWav(tone(100), 24000, 1);
  w.writeUInt32LE(999999, 40);
  assert.equal(ttsPcm(w, "audio/wav")!.pcm.length, 200);
  assert.equal(ttsPcm(Buffer.from("RIFF\0\0\0\0WAVEjunk"), "audio/wav"), null);
});

console.log(`\n${passed} passed`);
