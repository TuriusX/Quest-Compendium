/**
 * Voice from the quick menu ends by itself (owner, Nov 20 2026: "selecting voice starts listening immediately, detects
 * when he stops talking, and submits the question automatically"). Fed the microphone's loudness (RMS, 0..1) every
 * ~50 ms, it says when to stop:
 *   'listen'  keep going
 *   'end'     the player spoke and has been quiet for a moment (or talked for the longest a question may be): send it
 *   'nothing' nothing was said in time: stop without sending
 * The room's own noise is measured for the first moment, so a fan or the game's sound doesn't count as talking.
 */
export const VOICE_END = {
  calibrateMs: 250, // the room's noise, measured first
  minSpeechMs: 250, // this much loud time counts as having spoken (a cough or a click doesn't)
  silenceMs: 1300, // quiet this long after speaking: done
  noSpeechMs: 8000, // nothing said in this long: nothing to send
  maxMs: 45000, // the longest a spoken question may be
  floor: 0.012, // the quietest a voice can be (RMS)
  ceiling: 0.06, // the noise-based threshold never needs more than this
  factor: 2.8, // a voice is this many times louder than the room
};
export type VoiceEndState = 'listen' | 'end' | 'nothing';

export function voiceEnd(opts: Partial<typeof VOICE_END> = {}) {
  const o = { ...VOICE_END, ...opts };
  let start = -1;
  let lastT = -1;
  let noise = 0;
  let samples = 0;
  let speech = 0;
  let lastLoud = -1;
  return (level: number, t: number): VoiceEndState => {
    if (start < 0) start = t;
    const dt = lastT < 0 ? 0 : Math.max(0, t - lastT);
    lastT = t;
    const age = t - start;
    const v = Number.isFinite(level) ? Math.max(0, level) : 0;
    if (age < o.calibrateMs) {
      noise = (noise * samples + v) / (samples + 1);
      samples++;
      return 'listen';
    }
    const threshold = Math.max(o.floor, Math.min(o.ceiling, noise * o.factor));
    if (v >= threshold) {
      speech += dt;
      lastLoud = t;
    }
    const spoke = speech >= o.minSpeechMs;
    if (spoke && t - lastLoud >= o.silenceMs) return 'end';
    if (age >= o.maxMs) return spoke ? 'end' : 'nothing';
    if (!spoke && age >= o.noSpeechMs) return 'nothing';
    return 'listen';
  };
}

/** The loudness (RMS, 0..1) of an analyser's latest samples. */
export function rmsOf(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
