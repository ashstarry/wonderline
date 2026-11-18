const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 320; // 20 ms; examine audio already buffered by the stream.
const MIN_VOICED_FRAMES = 3;
const PAUSE_FRAMES = 25; // 500 ms, matching the existing Chinese pause duration.
const RMS_THRESHOLD = .0035;

export type ChineseVoiceStats = {
  voiced: boolean;
  silence: number;
  /** Sample offset immediately after the first completed pause, if there is one. */
  firstPauseEnd?: number;
};

/**
 * Conservative acoustic admission for the Chinese experiment, not a general VAD.
 * Remove a frame's DC offset and ignore isolated clicks without raising the
 * existing energy threshold or waiting for a microphone calibration period.
 * Sustained noise can still pass; this does not claim to distinguish music/fans.
 */
export function chineseVoiceStats(pcm: Int16Array): ChineseVoiceStats {
  let voiced = false, activeRun = 0, quietRun = 0, lastActive = -1;
  let firstPauseEnd: number | undefined;
  for (let offset = 0; offset + FRAME_SAMPLES <= pcm.length; offset += FRAME_SAMPLES) {
    let sum = 0, squares = 0;
    for (let i = offset; i < offset + FRAME_SAMPLES; i++) {
      sum += pcm[i]; squares += pcm[i] * pcm[i];
    }
    const mean = sum / FRAME_SAMPLES;
    const rms = Math.sqrt(Math.max(0, squares / FRAME_SAMPLES - mean * mean)) / 32768;
    if (rms > RMS_THRESHOLD) {
      lastActive = offset + FRAME_SAMPLES;
      activeRun++; quietRun = 0;
      if (activeRun >= MIN_VOICED_FRAMES) voiced = true;
    } else {
      activeRun = 0; quietRun++;
      // A new utterance's first two frames reset quietRun even before it is
      // qualified, so a near-boundary onset cannot be cut off prematurely.
      if (voiced && quietRun >= PAUSE_FRAMES && firstPauseEnd === undefined) {
        firstPauseEnd = offset + FRAME_SAMPLES;
      }
    }
  }
  return {
    voiced,
    silence: !voiced || lastActive < 0 ? pcm.length / SAMPLE_RATE : (pcm.length - lastActive) / SAMPLE_RATE,
    ...(firstPauseEnd === undefined ? {} : { firstPauseEnd }),
  };
}
