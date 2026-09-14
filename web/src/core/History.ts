import { CONFIG } from '../config';

/** Fixed-size ring buffer of samples, oldest overwritten first. No allocation after construction. */
export class Ring {
  readonly data: Float32Array;
  private head = 0;
  count = 0;

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }

  push(v: number) {
    this.data[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** i = 0 is the oldest sample kept. */
  at(i: number) {
    return this.data[(this.head - this.count + i + this.capacity) % this.capacity];
  }

  get last() {
    return this.count ? this.at(this.count - 1) : NaN;
  }

  /** Mean of the most recent `n` samples. */
  mean(n = this.count) {
    n = Math.min(n, this.count);
    let s = 0;
    for (let i = this.count - n; i < this.count; i++) s += this.at(i);
    return n ? s / n : NaN;
  }

  /** Least-squares slope per sample over the most recent `n` samples. */
  slope(n = this.count) {
    n = Math.min(n, this.count);
    if (n < 3) return 0;
    const start = this.count - n;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let k = 0; k < n; k++) {
      const y = this.at(start + k);
      sx += k; sy += y; sxy += k * y; sxx += k * k;
    }
    return (n * sxy - sx * sy) / (n * sxx - sx * sx);
  }

  range(): [number, number] {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const v = this.at(i);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo, hi];
  }
}

export const HISTORY_CHANNELS = [
  'energy', 'temperature', 'humidity', 'pressure', 'light', 'proximity', 'field', 'tilt', 'impulse',
] as const;
export type HistoryChannel = (typeof HISTORY_CHANNELS)[number];

/**
 * Short memory of the environment (2 Hz × 120 s). It feeds the simulation —
 * sustained energy heats the field, a pressure trend shows up as slow
 * compression — and the micro-history lines in the telemetry.
 */
export class SensorHistory {
  readonly rings: Record<HistoryChannel, Ring>;
  /** Increments whenever a sample is added (lets the UI redraw only on change). */
  version = 0;
  private acc = 0;
  private readonly period = 1 / CONFIG.history.rateHz;

  constructor() {
    const n = CONFIG.history.rateHz * CONFIG.history.seconds;
    this.rings = Object.fromEntries(HISTORY_CHANNELS.map((c) => [c, new Ring(n)])) as Record<HistoryChannel, Ring>;
  }

  update(dt: number, sample: () => Record<HistoryChannel, number | null>) {
    this.acc += dt;
    if (this.acc < this.period) return;
    this.acc -= this.period;
    if (this.acc > this.period) this.acc = 0; // after a stall, don't burst
    const s = sample();
    for (const c of HISTORY_CHANNELS) {
      const v = s[c];
      if (v !== null && Number.isFinite(v)) this.rings[c].push(v);
    }
    this.version++;
  }

  /** Change per minute, from a linear fit over the last `seconds`. */
  trendPerMinute(c: HistoryChannel, seconds = 60) {
    return this.rings[c].slope(seconds * CONFIG.history.rateHz) * CONFIG.history.rateHz * 60;
  }
}
