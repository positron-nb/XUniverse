export const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, x: number) => clamp((x - a) / (b - a));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = invLerp(a, b, x);
  return t * t * (3 - 2 * t);
};
export const DEG = Math.PI / 180;

/** Frame-rate independent exponential approach: fraction to move this frame. */
export const dampFactor = (tau: number, dt: number) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));
export const damp = (current: number, target: number, tau: number, dt: number) =>
  current + (target - current) * dampFactor(tau, dt);

/**
 * Critically damped spring (no overshoot, smooth velocity) — used for every
 * fused channel so a sudden sensor jump never produces a visual snap.
 */
export class Spring {
  value: number;
  velocity = 0;
  constructor(value = 0, public tau = 0.5) {
    this.value = value;
  }
  update(target: number, dt: number): number {
    const omega = 2 / Math.max(this.tau, 1e-3);
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.value - target;
    const temp = (this.velocity + omega * change) * dt;
    this.velocity = (this.velocity - omega * temp) * exp;
    this.value = target + (change + temp) * exp;
    return this.value;
  }
}

/**
 * Mass on a spring (second order, slightly underdamped). Used where a response
 * should feel like moving a physical object: it lags, carries momentum and
 * settles with a hint of overshoot instead of stopping dead.
 */
export class Inertial {
  value: number;
  velocity = 0;
  constructor(value = 0, public hz = 0.55, public damping = 0.78) {
    this.value = value;
  }
  update(target: number, dt: number): number {
    const w = 2 * Math.PI * this.hz;
    // Sub-step for stability at low frame rates.
    const steps = Math.max(1, Math.ceil(dt / 0.01));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = w * w * (target - this.value) - 2 * this.damping * w * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}

/** Deterministic pseudo random for reproducible seeds. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian via Box–Muller. */
export function gaussian(rand: () => number = Math.random) {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Smooth 1D value noise for slow natural drift in the simulated device. */
export function makeDrift(seed: number) {
  const r = mulberry32(seed);
  const knots = Array.from({ length: 256 }, () => r() * 2 - 1);
  return (t: number) => {
    const i = Math.floor(t);
    const f = t - i;
    const a = knots[i & 255];
    const b = knots[(i + 1) & 255];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}
