/** A small, locally synthesized toy workshop. Voices follow actual drawing
 * gestures, share a sparse rhythm, and never loop or fetch audio files. */
export type WorkshopTimbre = 'wood' | 'pluck' | 'drop' | 'bubble' | 'bell';
export type WorkshopCue = { timbre: WorkshopTimbre; frequency: number; volume: number; duration: number; delay?: number; pan?: number };

/** Also used by the offline listening check, so it renders the exact same sound. */
export function soundWorkshopCue(ctx: BaseAudioContext, output: AudioNode, cue: WorkshopCue, ended = () => {}) {
  const at = ctx.currentTime + (cue.delay ?? 0), duration = cue.duration;
  const envelope = ctx.createGain(), pan = ctx.createStereoPanner();
  pan.pan.value = Math.max(-.3, Math.min(.3, cue.pan ?? 0));
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(cue.volume, at + .024);
  envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
  envelope.connect(pan); pan.connect(output);
  // Inharmonic wooden overtones, soft string harmonics and quick water glides
  // make the actions recognizable without a repeated white-noise scratch.
  const harmonics = cue.timbre === 'wood' ? [[1, 1], [2.76, .06]]
    : cue.timbre === 'bell' ? [[1, 1], [2, .12], [3, .025]]
    : cue.timbre === 'pluck' ? [[1, 1], [2, .2]] : [[1, 1], [2, .1]];
  let left = harmonics.length, stopped = false;
  const voices = harmonics.map(([ratio, weight]) => {
    const voice = ctx.createOscillator(), gain = ctx.createGain();
    voice.type = 'sine'; gain.gain.value = weight;
    const start = cue.frequency * ratio;
    // Stable pitches: fast repeated glissandi sounded like a squeaky hinge.
    voice.frequency.setValueAtTime(start, at);
    voice.connect(gain); gain.connect(envelope); voice.start(at); voice.stop(at + duration + .015);
    voice.onended = () => { voice.disconnect(); gain.disconnect(); if (--left === 0) { envelope.disconnect(); pan.disconnect(); ended(); } };
    return voice;
  });
  return () => { if (stopped) return; stopped = true; for (const voice of voices) { try { voice.stop(); } catch { /* already ended */ } } };
}

const SCALE = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25];
const STEP_ORDER = [0, 2, 1, 4, 2, 5, 3, 1, 4, 6, 2, 3];
export function workshopTouchCue(tool: string, style: string, step: number, painter = 0): WorkshopCue {
  const frequency = SCALE[(STEP_ORDER[step % STEP_ORDER.length] + painter) % SCALE.length];
  const pan = (painter - 1) * .15;
  if (tool === 'eraser') return { timbre: 'wood', frequency, volume: .035, duration: .22, pan };
  if (tool === 'wash' || style === 'watercolor') return { timbre: step % 3 === 0 ? 'pluck' : 'bell', frequency, volume: .04, duration: .26, pan };
  if (style === 'pencil') return { timbre: 'pluck', frequency, volume: .04, duration: .24, pan };
  return { timbre: step % 3 === 0 ? 'pluck' : 'wood', frequency, volume: .045, duration: .24, pan };
}

export class DrawingSounds {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private enabled = false;
  private quiet = false;
  private style = 'crayon';
  private lastAccent = -Infinity;
  private nextCue = -Infinity;
  private lastFinish = -Infinity;
  private nextTouch = -Infinity;
  private previewUntil = -Infinity;
  private step = 0;
  private contacts = 0;
  private active = new Set<() => void>();
  private begun = new Set<string>();
  private completed = new Map<string, number>();
  private unlock = () => {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.output = this.context.createGain(); this.output.gain.value = this.level(); this.output.connect(this.context.destination);
      }
      void this.context.resume().catch(() => {});
    } catch { /* Audio never blocks painting. */ }
  };
  private level() { return !this.enabled ? 0 : this.quiet ? .1 : .3; }
  setEnabled(value: boolean) {
    this.enabled = value;
    if (!value) this.stopVoices();
    if (this.output && this.context) this.output.gain.setTargetAtTime(this.level(), this.context.currentTime, .015);
    window.removeEventListener('pointerdown', this.unlock, true); window.removeEventListener('keydown', this.unlock, true);
    if (value) { window.addEventListener('pointerdown', this.unlock, true); window.addEventListener('keydown', this.unlock, true); }
    if (value && navigator.userActivation?.isActive) this.unlock();
  }
  setQuiet(value: boolean) {
    this.quiet = value;
    if (this.output && this.context) this.output.gain.setTargetAtTime(this.level(), this.context.currentTime, .06);
  }
  setStyle(style: string) { this.style = style; }
  private ready() { return this.enabled && this.context?.state === 'running' && this.output; }
  private play(cue: WorkshopCue, preview = false) {
    if (!this.ready() || this.active.size >= (preview ? 5 : 3)) return;
    let stop: () => void;
    stop = soundWorkshopCue(this.context!, this.output!, cue, () => this.active.delete(stop));
    this.active.add(stop);
  }
  begin(role: string, owner: string, painter = '0') {
    if (!this.ready()) return;
    if (this.begun.has(owner)) return;
    this.begun.add(owner);
    if (this.begun.size > 256) this.begun.delete(this.begun.values().next().value!);
    const now = this.context!.currentTime;
    if (now < this.nextCue || now < this.previewUntil) return;
    this.lastAccent = now; this.nextCue = now + 1.8; this.nextTouch = now + 2.8;
    const id = Number(painter) || 0;
    const cue = workshopTouchCue(role === 'erase' ? 'eraser' : role === 'color' ? 'wash' : 'pen', this.style, this.step++, id);
    this.play({ ...cue, volume: .055, duration: .26 });
  }
  touch(tool: string, painter = 0) {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    if (tool === 'eraser' || now < this.nextTouch || now < this.nextCue || now < this.previewUntil) return;
    this.contacts++;
    // One shared sound budget for the whole workshop, independent of stroke
    // count. Long busy passages get occasional soft notes and long rests.
    this.nextTouch = now + [2.8, 3.6, 3.2, 4.2][this.contacts % 4];
    if (this.contacts % 3 === 0) return;
    this.nextCue = now + 1.8;
    this.play(workshopTouchCue(tool, this.style, this.step++, painter));
  }
  finish(owner: string) {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    if (this.completed.has(owner) || now - this.lastFinish < 4 || now < this.nextCue || now < this.previewUntil) return;
    this.lastFinish = now; this.lastAccent = now; this.nextCue = now + 2.2; this.nextTouch = now + 3.2;
    this.completed.set(owner, now);
    if (this.completed.size > 128) this.completed.delete(this.completed.keys().next().value!);
    const root = SCALE[this.step++ % 3];
    this.play({ timbre: 'pluck', frequency: root * 1.5, volume: .05, duration: .25 });
    this.play({ timbre: 'bell', frequency: root * 2, volume: .035, duration: .32, delay: .18 });
  }
  preview() {
    if (!this.enabled) return;
    this.unlock();
    // Resume may be asynchronous; only this explicit gesture previews audio.
    void this.context?.resume().then(() => {
      if (!this.ready()) return;
      const now = this.context!.currentTime;
      if (now < this.previewUntil) return;
      this.previewUntil = now + 1.7;
      const cues: WorkshopCue[] = [
        { ...workshopTouchCue('pen', this.style, 1), delay: 0 },
        { ...workshopTouchCue('wash', this.style, 2, 1), delay: .32 },
        { ...workshopTouchCue('eraser', this.style, 3, 2), delay: .69 },
        { timbre: 'pluck', frequency: 392, volume: .05, duration: .25, delay: 1.05 },
        { timbre: 'bell', frequency: 523.25, volume: .035, duration: .32, delay: 1.18 },
      ];
      this.stopVoices();
      for (const cue of cues) this.play(cue, true);
    }).catch(() => {});
  }
  private stopVoices() { for (const stop of this.active) stop(); this.active.clear(); }
  reset() {
    this.stopVoices(); this.begun.clear(); this.completed.clear(); this.step = 0; this.contacts = 0;
    this.lastAccent = this.lastFinish = this.nextTouch = this.nextCue = this.previewUntil = -Infinity;
  }
  dispose() { this.setEnabled(false); void this.context?.close().catch(() => {}); this.context = null; this.output = null; }
}
