import { CONFIG } from '../config';
import { settings } from '../core/Settings';
import { clamp, DEG, invLerp } from '../core/math';
import { deadZone, Ema, EventTracker, ImpulseDetector, Median } from './filters';
import type { FramePacket } from './protocol';

/** Sensor readings cleaned, calibrated and expressed in physical / unit ranges. */
export interface NormalizedInputs {
  /** Board tilt, radians, dead-zoned and clamped. +roll = right side down. */
  roll: number;
  pitch: number;
  /** Twist rate around the board's z axis, −1..1 (±180 °/s). */
  twist: number;
  /** 1 = hand touching, 0 = far / nothing in range. */
  proximity: number;
  distanceCm: number | null;
  handPresent: boolean;
  /** Ambient light 0..1 (log-mapped LDR). */
  illumination: number;
  /** Sound envelope 0..1. */
  soundLevel: number;
  /** BME280, absolute. */
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  /** BME280 derived 0..1 / −1..1. */
  thermal: number;
  humidityNorm: number;
  pressureDelta: number;
  /** DHT11 local probe. */
  localTemperature: number | null;
  localHumidity: number | null;
  /** Breath / hand warmth on the DHT11 relative to its own baseline, 0..1. */
  convection: number;
}

export interface ImpulseEvent {
  kind: 'clap' | 'shake';
  strength: number;
  /** For shakes: the tilt direction at the moment of the shake. */
  roll?: number;
  pitch?: number;
}

export function defaultInputs(): NormalizedInputs {
  return {
    roll: 0, pitch: 0, twist: 0, proximity: 0, distanceCm: null, handPresent: false,
    illumination: 0.55, soundLevel: 0, temperature: null, humidity: null, pressure: null,
    thermal: 0.5, humidityNorm: 0.45, pressureDelta: 0, localTemperature: null,
    localHumidity: null, convection: 0,
  };
}

/**
 * Learns the LDR's range *and direction* while the user covers it (first
 * half of the countdown) and then lights it (second half). Depending on how
 * the sensor is wired, more light can mean more counts or fewer; comparing
 * the two halves tells which, so any wiring works.
 */
export class RangeLearner {
  active = false;
  endsAt = 0;
  private startedAt = 0;
  private samples: { t: number; v: number }[] = [];

  start(seconds = 10) {
    this.active = true;
    this.startedAt = performance.now();
    this.endsAt = this.startedAt + seconds * 1000;
    this.samples = [];
  }

  get remaining() {
    return Math.max(0, (this.endsAt - performance.now()) / 1000);
  }

  /** 'cover' during the first half, 'light' during the second. */
  get phase(): 'cover' | 'light' {
    return performance.now() < (this.startedAt + this.endsAt) / 2 ? 'cover' : 'light';
  }

  observe(p: FramePacket) {
    if (!this.active) return;
    if (p.light !== null) this.samples.push({ t: performance.now(), v: p.light });
    if (performance.now() >= this.endsAt) this.finish();
  }

  /** Returns a human summary of what was applied. */
  finish(): string {
    this.active = false;
    const mid = (this.startedAt + this.endsAt) / 2;
    const dark = this.samples.filter((s) => s.t < mid).map((s) => s.v);
    const lit = this.samples.filter((s) => s.t >= mid).map((s) => s.v);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const darkMean = mean(dark);
    const litMean = mean(lit);
    if (!dark.length || !lit.length || Math.abs(litMean - darkMean) < 100) {
      this.lastResult = 'no clear dark → bright change seen — nothing changed';
      return this.lastResult;
    }
    // More light → fewer counts on this wiring: flip so bright is always high.
    const invert = darkMean > litMean;
    const values = this.samples.map((s) => (invert ? 4095 - s.v : s.v));
    settings.set('lightInvert', invert ? 1 : 0);
    settings.set('lightDark', Math.max(1, Math.round(Math.min(...values))));
    settings.set('lightBright', Math.round(Math.max(...values)));
    this.lastResult = `learned light range${invert ? ' (inverted wiring)' : ''}`;
    return this.lastResult;
  }

  lastResult = '';
}

export class Normalizer {
  readonly inputs = defaultInputs();
  readonly learner = new RangeLearner();
  /** Raw distance for "set near/far = current" in the tuning panel. */
  get rawDistance() {
    return this.distEma.value;
  }

  private lastT: number | null = null;
  private lightEma = new Ema(CONFIG.light.emaTau);
  private distMedian = new Median(CONFIG.distance.medianWindow);
  private distEma = new Ema(CONFIG.distance.emaTau);
  private lastValidDist = -1e9;
  private rollEma = new Ema(CONFIG.mpu.emaTau);
  private pitchEma = new Ema(CONFIG.mpu.emaTau);
  private twistEma = new Ema(0.15);
  private compRoll = 0;
  private compPitch = 0;
  private rollZero = 0;
  private pitchZero = 0;
  private lastShake = -1e9;
  private soundEma = new Ema(0.06);
  private pressureBase = new Ema(CONFIG.env.pressureBaselineTau);
  private dhtHumBase = new Ema(CONFIG.env.dhtBaselineTau);
  private dhtTempBase = new Ema(CONFIG.env.dhtBaselineTau);
  private clap = new EventTracker();
  private shake = new EventTracker();
  private impulse = new ImpulseDetector(CONFIG.sound.thresholdOverFloor, CONFIG.sound.cooldownMs);
  private calibrateNext = false;

  /** Treat the current board orientation as level. */
  calibrate() {
    this.calibrateNext = true;
  }

  /**
   * No data (signal lost / not yet connected): ease every *gesture* channel back
   * to rest — board level, no hand, silence. Environmental readings
   * keep their last value; the world doesn't pretend the room changed.
   */
  relax(dt: number) {
    const o = this.inputs;
    const k = (tau: number) => 1 - Math.exp(-dt / tau);
    o.roll -= o.roll * k(0.8);
    o.pitch -= o.pitch * k(0.8);
    o.twist -= o.twist * k(0.4);
    o.proximity -= o.proximity * k(0.8);
    o.soundLevel -= o.soundLevel * k(0.3);
    o.convection -= o.convection * k(3);
    o.handPresent = false;
    o.distanceCm = null;
  }

  /** Called when the source changes, so filters don't blend two devices. */
  reset() {
    this.lastT = null;
    this.clap.reset();
    this.shake.reset();
    this.distMedian.clear();
    this.pressureBase.reset();
    this.dhtHumBase.reset();
    this.dhtTempBase.reset();
  }

  ingest(p: FramePacket): ImpulseEvent[] {
    const dt = this.lastT === null ? 1 / 30 : clamp((p.t - this.lastT) / 1000, 0.001, 0.5);
    this.lastT = p.t;
    const now = performance.now();
    const out = this.inputs;
    const events: ImpulseEvent[] = [];

    const cal = settings.values;
    this.learner.observe(p);

    // ── LDR: a divider with an LDR is roughly logarithmic in lux ─────────
    if (p.light !== null) {
      const raw = cal.lightInvert >= 0.5 ? 4095 - p.light : p.light;
      const dark = Math.max(1, cal.lightDark);
      const bright = Math.max(dark + 1, cal.lightBright);
      const c = clamp(raw, dark, bright);
      const lin = Math.log(c / dark) / Math.log(bright / dark);
      out.illumination = clamp(this.lightEma.push(lin, dt));
    }

    // ── Ultrasonic: reject → median → EMA → hold → relax ─────────────────
    const D = CONFIG.distance;
    if (p.dist !== null && p.dist >= D.minCm && p.dist <= D.maxCm) {
      const d = this.distEma.push(this.distMedian.push(p.dist), dt);
      this.lastValidDist = now;
      out.distanceCm = d;
      out.handPresent = d < cal.distFar * 1.6;
      out.proximity = 1 - invLerp(cal.distNear, cal.distFar, d);
    } else if (now - this.lastValidDist > D.holdMs) {
      out.distanceCm = null;
      out.handPresent = false;
      out.proximity = Math.max(0, out.proximity - dt * 0.8);
      this.distEma.reset();
      this.distMedian.clear();
    }

    // ── MPU6050: orientation, twist, shake ────────────────────────────────
    if (p.mpu) {
      const m = p.mpu;
      let roll: number;
      let pitch: number;
      if (m.roll !== undefined && m.pitch !== undefined) {
        roll = m.roll * DEG;
        pitch = m.pitch * DEG;
      } else {
        // Fallback complementary filter at packet rate.
        const accRoll = Math.atan2(m.ay, m.az);
        const accPitch = Math.atan2(-m.ax, Math.hypot(m.ay, m.az));
        const k = CONFIG.mpu.gyroWeight;
        this.compRoll = k * (this.compRoll + m.gx * DEG * dt) + (1 - k) * accRoll;
        this.compPitch = k * (this.compPitch + m.gy * DEG * dt) + (1 - k) * accPitch;
        roll = this.compRoll;
        pitch = this.compPitch;
      }
      if (this.calibrateNext) {
        this.rollZero = roll;
        this.pitchZero = pitch;
        this.calibrateNext = false;
      }
      const dz = CONFIG.mpu.deadZoneDeg * DEG;
      const max = CONFIG.mpu.maxTiltDeg * DEG;
      out.roll = clamp(this.rollEma.push(deadZone(roll - this.rollZero, dz), dt), -max, max);
      out.pitch = clamp(this.pitchEma.push(deadZone(pitch - this.pitchZero, dz), dt), -max, max);
      out.twist = clamp(this.twistEma.push(deadZone(m.gz, 8) / 180, dt), -1, 1);

      const shakeEv = this.shake.check(p.ev?.shake);
      if (shakeEv !== null) {
        events.push({ kind: 'shake', strength: shakeEv, roll: out.roll, pitch: out.pitch });
      } else if (!p.ev?.shake) {
        const jolt = Math.abs(Math.hypot(m.ax, m.ay, m.az) - 1);
        if (jolt > CONFIG.mpu.shakeThresholdG && now - this.lastShake > CONFIG.mpu.shakeCooldownMs) {
          this.lastShake = now;
          events.push({ kind: 'shake', strength: clamp(jolt / 2), roll: out.roll, pitch: out.pitch });
        }
      }
    }

    // ── Sound: envelope + clap events (device-side preferred) ────────────
    if (p.sound) {
      out.soundLevel = clamp(this.soundEma.push(p.sound.level, dt));
      const clap = this.clap.check(p.ev?.clap);
      if (clap !== null) events.push({ kind: 'clap', strength: clap });
      else if (!p.ev?.clap) {
        const s = this.impulse.push(p.sound.peak, dt, now);
        if (s !== null) events.push({ kind: 'clap', strength: s });
      }
    }

    // ── Environment ───────────────────────────────────────────────────────
    const e = p.env;
    const E = CONFIG.env;
    if (e) {
      if (e.t !== null) {
        out.temperature = e.t;
        out.thermal = invLerp(E.tempMin, E.tempMax, e.t);
      }
      if (e.rh !== null) {
        out.humidity = e.rh;
        out.humidityNorm = invLerp(E.humMin, E.humMax, e.rh);
      }
      if (e.p !== null) {
        out.pressure = e.p;
        const base = this.pressureBase.value ?? e.p;
        this.pressureBase.push(e.p, dt);
        out.pressureDelta = clamp((e.p - base) / E.pressureSpan, -1, 1);
      }
      // The DHT11 is a second, local probe: breath or a warm hand raises it above
      // its own slow baseline. Only quiet samples teach the baseline.
      if (e.rh2 !== null && e.t2 !== null) {
        out.localHumidity = e.rh2;
        out.localTemperature = e.t2;
        const hb = this.dhtHumBase.value ?? e.rh2;
        const tb = this.dhtTempBase.value ?? e.t2;
        const c = Math.max(
          invLerp(1, E.breathHumSpan, e.rh2 - hb),
          invLerp(0.5, E.breathTempSpan, e.t2 - tb),
        );
        if (c < 0.15 || this.dhtHumBase.value === null) {
          this.dhtHumBase.push(e.rh2, dt);
          this.dhtTempBase.push(e.t2, dt);
        }
        out.convection = c;
        // A BMP280 (sold as "BME280") has no humidity, and a missing barometric
        // sensor has no temperature either: fall back to the DHT11. Its slow
        // baseline is used for humidity, so a breath doesn't read as a humid room.
        if (e.rh === null) {
          out.humidity = this.dhtHumBase.value ?? e.rh2;
          out.humidityNorm = invLerp(E.humMin, E.humMax, out.humidity);
        }
        if (e.t === null) {
          out.temperature = e.t2;
          out.thermal = invLerp(E.tempMin, E.tempMax, e.t2);
        }
      }
    }

    return events;
  }
}
