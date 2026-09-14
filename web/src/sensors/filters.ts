import { dampFactor } from '../core/math';

/** Exponential moving average with a time constant (independent of packet rate). */
export class Ema {
  value: number | null = null;
  constructor(public tau: number) {}
  push(x: number, dt: number): number {
    this.value = this.value === null ? x : this.value + (x - this.value) * dampFactor(this.tau, dt);
    return this.value;
  }
  reset() {
    this.value = null;
  }
}

/** Sliding median — kills single-sample spikes (ultrasonic multipath, DHT glitches). */
export class Median {
  private buf: number[] = [];
  constructor(private size: number) {}
  push(x: number): number {
    this.buf.push(x);
    if (this.buf.length > this.size) this.buf.shift();
    const s = [...this.buf].sort((a, b) => a - b);
    return s[s.length >> 1];
  }
  clear() {
    this.buf.length = 0;
  }
}

/** Output only moves once the input leaves a band — stops ADC jitter creeping through. */
export class Hysteresis {
  value: number | null = null;
  constructor(private band: number) {}
  push(x: number): number {
    if (this.value === null || Math.abs(x - this.value) > this.band) {
      this.value = this.value === null ? x : x - Math.sign(x - this.value) * this.band;
    }
    return this.value;
  }
}

/** Symmetric dead zone that stays continuous at the edge. */
export function deadZone(x: number, zone: number): number {
  const a = Math.abs(x);
  return a <= zone ? 0 : Math.sign(x) * (a - zone);
}

/**
 * Detects a new event from a device-side counter; the first counter seen is only
 * recorded, so connecting mid-session doesn't replay an old clap.
 */
export class EventTracker {
  private last: number | null = null;
  check(counter: [number, number] | undefined): number | null {
    if (!counter) return null;
    const [seq, strength] = counter;
    if (this.last === null) {
      this.last = seq;
      return null;
    }
    if (seq === this.last) return null;
    this.last = seq;
    return strength;
  }
  reset() {
    this.last = null;
  }
}

/**
 * Fallback impulse detector used only when a source provides a sound level but
 * no clap events: adaptive noise floor + threshold + peak hold + cooldown.
 */
export class ImpulseDetector {
  private floor = new Ema(3);
  private lastFire = -1e9;
  private armed = true;
  constructor(private overFloor: number, private cooldownMs: number) {}
  push(level: number, dt: number, nowMs: number): number | null {
    const floor = this.floor.value ?? level;
    // Only let quiet samples teach the floor so a clap doesn't raise it.
    if (level < floor + this.overFloor * 0.5) this.floor.push(level, dt);
    const excess = level - floor;
    if (!this.armed && excess < this.overFloor * 0.4) this.armed = true;
    if (this.armed && excess > this.overFloor && nowMs - this.lastFire > this.cooldownMs) {
      this.armed = false;
      this.lastFire = nowMs;
      return Math.min(1, excess / (1 - floor + 1e-3));
    }
    return null;
  }
}
