/**
 * The audio a Gemini voice returns, as plain 16-bit PCM samples. Older TTS models sent raw PCM ("audio/L16;
 * codec=pcm;rate=24000"); the current ones send a whole WAV file ("audio/wav"), and that file carries more than the
 * sound: its header, and after the audio a C2PA block (the content credentials Google attaches to generated audio,
 * about 6 KB). Wrapped as if it were raw sound, those bytes played as a burst of static at every chunk's start and end,
 * in the pauses between phrases. Only the WAV's own "data" chunk is sound; everything else is left out.
 */
export type Pcm = { pcm: Buffer; sampleRate: number; channels: number };

/** The samples in a TTS reply's audio (a WAV file or raw PCM), whole 16-bit samples only. */
export function ttsPcm(bytes: Buffer, mimeType = ''): Pcm | null {
  if (!bytes || bytes.length < 2) return null;
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
    let rate = 24000, channels = 1, bits = 16, o = 12;
    while (o + 8 <= bytes.length) {
      const id = bytes.toString('ascii', o, o + 4);
      const size = bytes.readUInt32LE(o + 4);
      const body = o + 8;
      if (id === 'fmt ' && body + 16 <= bytes.length) {
        channels = bytes.readUInt16LE(body + 2) || 1;
        rate = bytes.readUInt32LE(body + 4) || 24000;
        bits = bytes.readUInt16LE(body + 14) || 16;
      } else if (id === 'data') {
        if (bits !== 16) return null;
        const end = Math.min(bytes.length, body + size);
        return { pcm: evenSamples(bytes.subarray(body, end), channels), sampleRate: rate, channels };
      }
      o = body + size + (size % 2);
    }
    return null;
  }
  // Raw PCM: the rate from the type when given ("rate=24000").
  const rate = Number((mimeType.match(/rate=(\d+)/) || [])[1]) || 24000;
  return { pcm: evenSamples(bytes, 1), sampleRate: rate, channels: 1 };
}

/** Cut to whole samples (2 bytes each, every channel): a half sample would shift every later one into noise. */
function evenSamples(b: Buffer, channels: number): Buffer {
  const frame = 2 * Math.max(1, channels);
  return b.length % frame ? b.subarray(0, b.length - (b.length % frame)) : b;
}

/** A WAV file around PCM samples. */
export function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
