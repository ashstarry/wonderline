const NORMAL_PACE = .88;
/** Playback never controls model scheduling. Give long strokes breathing room;
 * slow a scarce buffer a little more, with a bounded extra delay. */
export class DrawingPace {
  private waiting = false;
  private turn = -1;
  private lastSupply = 0;
  private previous = 0;
  private speed = NORMAL_PACE;
  private extra = 0;
  setWaiting(waiting: boolean, turn: number, now: number) {
    if (turn !== this.turn) { this.turn = turn; this.extra = 0; this.lastSupply = now; }
    this.waiting = waiting;
  }
  supplied(now: number) { this.lastSupply = now; }
  rate(now: number, buffered: number, shortGesture: boolean) {
    const dt = Math.max(0, Math.min(40, now - this.previous));
    this.previous = now;
    const scarce = this.waiting && buffered < 8 && now - this.lastSupply > 700 && this.extra < 1600;
    const target = scarce ? .74 : NORMAL_PACE;
    this.speed += (target - this.speed) * Math.min(1, dt / 220);
    const rate = shortGesture ? 1 : this.speed;
    if (this.waiting) this.extra += dt * Math.max(0, NORMAL_PACE - rate);
    return rate;
  }
  reset() { this.waiting = false; this.turn = -1; this.speed = NORMAL_PACE; this.extra = 0; this.previous = 0; }
}
