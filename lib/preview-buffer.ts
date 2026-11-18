/** First geometry is immediate. Subsequent network bursts keep only their latest
 * snapshot, leaving time for audio callbacks, incoming speech and brush frames.
 * Final validated commits bypass this buffer and dispose it. */
export class PreviewBuffer<T> {
  private first = true;
  private latest: { value: T } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  constructor(private apply: (value: T) => void, private interval = 80) {}
  offer(value: T) {
    if (this.closed) return;
    if (this.first) { this.first = false; this.apply(value); return; }
    this.latest = { value };
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const latest = this.latest; this.latest = null;
      if (!this.closed && latest) this.apply(latest.value);
    }, this.interval);
  }
  dispose() {
    this.closed = true; this.latest = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
