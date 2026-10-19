/**
 * Seamless playback of a spoken answer that arrives in pieces (/api/tts streams one WAV per few sentences). Each piece
 * is decoded as it arrives, in order, and scheduled on the audio clock to start exactly when the previous one ends: no
 * gap while the next file loads, no click where one stops and the next starts (5 ms fades at each join, over what is
 * near-silence anyway). Stopping cuts everything at once.
 */
const FADE = 0.005;
// One audio context for every answer (browsers allow only a few at a time).
let shared: AudioContext | null = null;
function sharedCtx(): AudioContext {
  if (!shared || shared.state === 'closed') {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    shared = new Ctx();
  }
  return shared;
}

export class TtsPlayer {
  private ctx: AudioContext;
  private out: GainNode;
  private sources: AudioBufferSourceNode[] = [];
  private nextAt = 0;
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;
  private finished = false;
  private stopped = false;
  private ended = false;

  constructor(private onEnd: () => void, ctx?: AudioContext) {
    this.ctx = ctx || sharedCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
  }

  /** A piece of the answer (a data: URL or the file's bytes), played after the ones before it. */
  enqueue(audio: string | ArrayBuffer): void {
    if (this.stopped) return;
    this.pending++;
    const bytes = typeof audio === 'string' ? dataUrlBytes(audio) : Promise.resolve(audio);
    // Decoding runs alongside, but pieces are scheduled strictly in the order they came.
    const decoded = bytes.then((b) => this.ctx.decodeAudioData(b.slice(0))).catch(() => null);
    this.chain = this.chain.then(async () => {
      const buf = await decoded;
      this.pending--;
      if (buf && !this.stopped) this.schedule(buf);
      this.maybeEnd();
    });
  }

  /** No more pieces are coming: the player ends when the last one has played. */
  finish(): void {
    this.finished = true;
    this.chain = this.chain.then(() => this.maybeEnd());
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const s of this.sources) { try { s.onended = null; s.stop(); } catch { /* already stopped */ } }
    this.sources = [];
    try { this.out.disconnect(); } catch { /* */ }
  }

  private schedule(buf: AudioBuffer): void {
    const now = this.ctx.currentTime;
    // The first piece (or one that arrived after the last finished): a moment from now; otherwise right on the end of
    // the previous one.
    const at = Math.max(this.nextAt, now + 0.03);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    const end = at + buf.duration;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1, at + FADE);
    g.gain.setValueAtTime(1, Math.max(at + FADE, end - FADE));
    g.gain.linearRampToValueAtTime(0, end);
    src.connect(g);
    g.connect(this.out);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
      this.maybeEnd();
    };
    src.start(at);
    this.sources.push(src);
    this.nextAt = end;
  }

  private maybeEnd(): void {
    if (this.ended || this.stopped || !this.finished || this.pending > 0 || this.sources.length) return;
    this.ended = true;
    this.onEnd();
  }
}

async function dataUrlBytes(url: string): Promise<ArrayBuffer> {
  const comma = url.indexOf(',');
  const bin = atob(url.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
