import re

with open('src/utils/audio.ts', 'r') as f:
    code = f.read()

target = """/**
 * Page Turn / Tome Opening Sound (Synthesized Paper Flutter)
 */
export function playPageTurnSound(enabled = true) {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const bufferSize = ctx.sampleRate * 0.22;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(250, ctx.currentTime + 0.22);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  } catch {
    // Audio error
  }
}"""

replacement = """/**
 * Page Turn / Tome Opening Sound
 */
export function playPageTurnSound(enabled = true) {
  if (!enabled) return;
  try {
    const audio = new Audio('/page-turn.mp3');
    audio.volume = 0.6;
    audio.play().catch(() => {
      const ctx = getAudioContext();
      if (!ctx) return;
      const bufferSize = ctx.sampleRate * 0.22;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(250, ctx.currentTime + 0.22);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start();
    });
  } catch {
    // Audio error
  }
}"""

# Use regex to replace carefully in case of slight whitespace diff
code = re.sub(r'/\*\*[\s\*]*Page Turn / Tome Opening Sound \(Synthesized Paper Flutter\)[\s\*]*\*/\s*export function playPageTurnSound\(enabled = true\) \{.*?\n\}\n', replacement + "\n", code, flags=re.DOTALL)

with open('src/utils/audio.ts', 'w') as f:
    f.write(code)

