/**
 * Keeps the frame rate near the display's refresh by scaling render resolution.
 * Particle count stays fixed (it defines the physics); only pixels change.
 * A level that proved too slow is not retried for a minute, so it can't oscillate.
 */
export class AdaptiveQuality {
  pixelRatio: number;
  avgMs = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  private blockedAbove = Infinity;
  private blockedUntil = 0;
  private readonly min = 0.6;

  constructor(private max: number, public enabled = true) {
    this.pixelRatio = max;
  }

  /** Returns true when the pixel ratio changed (caller must resize). */
  update(dt: number, now = performance.now()): boolean {
    if (!this.enabled || dt <= 0 || dt > 0.25) return false; // ignore stalls / hidden tabs
    this.avgMs += (dt * 1000 - this.avgMs) * 0.05;

    if (this.avgMs > 19.5) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.avgMs < 17.4) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = this.fastFor = 0;
    }

    if (this.slowFor > 2 && this.pixelRatio > this.min) {
      this.blockedAbove = this.pixelRatio;
      this.blockedUntil = now + 60000;
      return this.set(this.pixelRatio - 0.15);
    }
    if (this.fastFor > 8 && this.pixelRatio < this.max) {
      const next = Math.min(this.max, this.pixelRatio + 0.1);
      if (next >= this.blockedAbove && now < this.blockedUntil) return false;
      return this.set(next);
    }
    return false;
  }

  private set(v: number) {
    this.pixelRatio = Math.max(this.min, Math.min(this.max, Math.round(v * 100) / 100));
    this.slowFor = this.fastFor = 0;
    return true;
  }
}
