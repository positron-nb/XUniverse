import { clamp, damp, gaussian, makeDrift } from '../core/math';
import { PROTOCOL_VERSION, type FramePacket } from './protocol';

/**
 * A virtual POSITRON board. It models the *physical* quantities (tilt angles,
 * hand distance, room temperature…) and then produces what the real sensors
 * would report — ADC counts with noise, DHT11 1 °C / 1 % quantisation and its
 * 2 s update interval, ultrasonic timeouts and multipath spikes, gyro bias —
 * in exactly the wire format of the ESP32 firmware.
 *
 * An autopilot performs believable gestures; any manual input takes over.
 */

type Gesture = (dt: number) => boolean; // returns true when finished

export interface SimControls {
  tiltX: number; // −1..1 held arrow keys
  tiltY: number;
  handDir: number; // −1 closer, +1 farther
  twist: number;
}

export class SimulatedSource {
  readonly name = 'SIMULATION';
  autopilot = true;
  readonly controls: SimControls = { tiltX: 0, tiltY: 0, handDir: 0, twist: 0 };

  private timer: number | null = null;
  private listener: ((p: FramePacket) => void) | null = null;
  private seq = 0;
  private time = 0;
  private lastWall = performance.now();

  // Physical truth of the virtual world.
  private roll = 0; // degrees
  private pitch = 0;
  private rollTarget = 0;
  private pitchTarget = 0;
  private yawRate = 0; // °/s
  private yawTarget = 0;
  private handDist = 220;
  private handTarget = 220;
  private handPresent = false;
  private lightLevel = 0.62; // 0..1 physical brightness
  private lightTarget = 0.62;
  private soundEnv = 0;
  private clapSeq = 0;
  private clapStrength = 0;
  private shakeSeq = 0;
  private shakeStrength = 0;
  private shakeTime = 0;
  private breath = 0;
  private breathTarget = 0;
  private dht = { t: 27, rh: 52, next: 0 };
  private bme = { t: 26.4, rh: 49, p: 1008.4, next: 0 };
  private ambient = 0;
  private readonly gyroBias = [0.6, -0.4, 0.3];

  private gestures: Gesture[] = [];
  private nextGestureAt = 2.5;

  private drift = {
    temp: makeDrift(11), hum: makeDrift(23), press: makeDrift(37), light: makeDrift(41),
    wobble: makeDrift(53),
  };

  start(listener: (p: FramePacket) => void, rateHz = 30) {
    this.listener = listener;
    this.lastWall = performance.now();
    this.timer = window.setInterval(() => this.tick(), 1000 / rateHz);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.listener = null;
  }

  get running() {
    return this.timer !== null;
  }

  // ─── Manual interaction (also used by the autopilot) ──────────────────────
  takeOver() {
    this.autopilot = false;
    this.gestures.length = 0;
  }

  clap(strength = 0.7) {
    this.clapSeq++;
    this.clapStrength = clamp(strength + gaussian() * 0.05, 0.05, 1);
    this.soundEnv = Math.max(this.soundEnv, this.clapStrength);
  }

  shake(strength = 0.6) {
    this.shakeSeq++;
    this.shakeStrength = strength;
    this.shakeTime = 0.35;
  }

  breathe() {
    this.breathTarget = 1;
    setTimeout(() => (this.breathTarget = 0), 2200);
  }

  toggleLight() {
    this.lightTarget = this.lightTarget > 0.4 ? 0.12 : 0.75;
  }

  // ─── Simulation step ─────────────────────────────────────────────────────
  private tick() {
    const now = performance.now();
    const dt = clamp((now - this.lastWall) / 1000, 0.001, 0.2);
    this.lastWall = now;
    this.time += dt;

    this.applyControls(dt);
    if (this.autopilot) this.runAutopilot(dt);

    // A hand moves with inertia; physical quantities ease toward targets.
    this.roll = damp(this.roll, this.rollTarget, 0.4, dt);
    this.pitch = damp(this.pitch, this.pitchTarget, 0.4, dt);
    this.yawRate = damp(this.yawRate, this.yawTarget, 0.25, dt);
    this.handDist = damp(this.handDist, this.handTarget, this.handPresent ? 0.45 : 0.2, dt);
    this.lightLevel = damp(this.lightLevel, this.lightTarget, 1.2, dt);
    this.breath = damp(this.breath, this.breathTarget, this.breathTarget > this.breath ? 0.8 : 9, dt);
    this.soundEnv *= Math.exp(-dt / 0.09);
    this.shakeTime = Math.max(0, this.shakeTime - dt);

    this.listener?.(this.packet());
  }

  private applyControls(dt: number) {
    const c = this.controls;
    if (c.tiltX || c.tiltY || this.autopilot === false) {
      this.rollTarget = c.tiltX * 28;
      this.pitchTarget = c.tiltY * 28;
    }
    if (c.handDir) {
      if (!this.handPresent) {
        this.handPresent = true;
        this.handDist = this.handTarget = 110;
      }
      this.handTarget = clamp(this.handTarget + c.handDir * 45 * dt, 4, 160);
      if (this.handTarget >= 160) {
        this.handPresent = false;
        this.handTarget = 220;
      }
    }
    if (!this.autopilot) this.yawTarget = c.twist * 120;
  }

  private runAutopilot(dt: number) {
    this.gestures = this.gestures.filter((g) => !g(dt));
    if (this.gestures.length === 0 && this.time > this.nextGestureAt) {
      this.gestures.push(this.pickGesture());
      this.nextGestureAt = this.time + 3 + Math.random() * 5;
    }
  }

  /** Human-like gestures, each with a start, hold and release. */
  private pickGesture(): Gesture {
    const r = Math.random();
    let t = 0;
    if (r < 0.45) {
      const rollT = (Math.random() * 2 - 1) * 26;
      const pitchT = (Math.random() * 2 - 1) * 18;
      const hold = 3 + Math.random() * 3;
      return (dt) => {
        t += dt;
        this.rollTarget = t < hold ? rollT : 0;
        this.pitchTarget = t < hold ? pitchT : 0;
        return t > hold + 1.5;
      };
    }
    if (r < 0.68) {
      const closest = 6 + Math.random() * 30;
      return (dt) => {
        t += dt;
        if (t < 0.1) {
          this.handPresent = true;
          this.handDist = this.handTarget = 120;
        }
        this.handTarget = t < 1.8 ? 120 - (120 - closest) * (t / 1.8) : t < 4.5 ? closest : 140;
        if (t > 5.5) {
          this.handPresent = false;
          this.handTarget = 220;
          return true;
        }
        return false;
      };
    }
    if (r < 0.84) {
      const strength = Math.random() < 0.25 ? 0.92 : 0.45 + Math.random() * 0.35;
      this.clap(strength);
      return () => true;
    }
    if (r < 0.9) {
      this.breathe();
      return () => true;
    }
    if (r < 0.96) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      return (dt) => {
        t += dt;
        this.yawTarget = t < 1.2 ? dir * 140 : 0;
        return t > 2;
      };
    }
    this.shake(0.5 + Math.random() * 0.3);
    return () => true;
  }

  // ─── Sensor models ───────────────────────────────────────────────────────
  private packet(): FramePacket {
    const time = this.time;
    const rad = Math.PI / 180;

    // A hand-held board is never perfectly still.
    const wob = this.drift.wobble(time * 0.7) * 0.6;
    const roll = this.roll + wob;
    const pitch = this.pitch + this.drift.wobble(time * 0.6 + 50) * 0.5;

    let ax = -Math.sin(pitch * rad);
    let ay = Math.sin(roll * rad) * Math.cos(pitch * rad);
    let az = Math.cos(roll * rad) * Math.cos(pitch * rad);
    if (this.shakeTime > 0) {
      const j = this.shakeStrength * 1.6 * Math.sin(this.shakeTime * 90);
      ax += j;
      ay += j * 0.6;
    }
    const n = (s: number) => gaussian() * s;

    // Ultrasonic: wall at ~2 m when no hand; occasional timeouts and multipath spikes.
    let dist: number | null = this.handDist + n(this.handPresent ? 0.4 : 1.5);
    const glitch = Math.random();
    if (glitch < 0.02) dist = null;
    else if (glitch < 0.035) dist = 20 + Math.random() * 300;

    // DHT11 samples every 2 s with integer resolution.
    // BME280: forced mode once per second (sample-and-hold), like the firmware.
    // At constant absolute humidity, relative humidity falls as the room warms.
    if (time > this.bme.next) {
      this.bme.next = time + 1;
      const dT = this.drift.temp(time * 0.004) * 1.1;
      this.bme.t = 26.4 + dT + n(0.012);
      this.bme.rh = 49 - dT * 2.6 + this.drift.hum(time * 0.003) * 3 + n(0.04);
      this.bme.p = 1008.4 + this.drift.press(time * 0.0015) * 0.6 + n(0.012);
    }
    // DHT11: every 2 s, integer resolution, offset from the BME280, and it sees breath.
    if (time > this.dht.next) {
      this.dht.next = time + 2;
      this.dht.t = Math.round(this.bme.t + 0.8 + this.breath * 3.5 + n(0.3));
      this.dht.rh = Math.round(this.bme.rh + 4 + this.breath * 24 + n(0.6));
    }

    const light = this.lightLevel + this.drift.light(time * 0.05) * 0.03;
    // Room sound: a noise floor plus occasional sustained sounds (a voice, a door)
    // that stay below the clap detector — speech must never read as a clap.
    this.ambient = damp(this.ambient, this.drift.wobble(time * 0.21 + 400) > 0.72 ? 0.07 : 0, 0.35, 1 / 30);
    const soundLevel = clamp(0.035 + Math.abs(n(0.012)) + this.ambient * (0.7 + 0.3 * Math.random()) + this.soundEnv);

    return {
      type: 'frame',
      v: PROTOCOL_VERSION,
      seq: this.seq++,
      t: performance.now(),
      mpu: {
        ax: ax + n(0.008), ay: ay + n(0.008), az: az + n(0.008),
        gx: n(0.25) + this.gyroBias[0], gy: n(0.25) + this.gyroBias[1],
        gz: this.yawRate + n(0.25) + this.gyroBias[2],
        roll: roll + n(0.08), pitch: pitch + n(0.08),
      },
      dist: dist === null ? null : Math.round(dist * 10) / 10,
      light: Math.round(clamp(120 * Math.pow(30, light) + n(8), 0, 4095)),
      sound: { level: soundLevel, peak: clamp(soundLevel + Math.abs(n(0.01))) },
      env: {
        t: Math.round(this.bme.t * 100) / 100,
        rh: Math.round(this.bme.rh * 10) / 10,
        p: Math.round(this.bme.p * 100) / 100,
        t2: this.dht.t,
        rh2: this.dht.rh,
      },
      ev: { clap: [this.clapSeq, this.clapStrength], shake: [this.shakeSeq, this.shakeStrength] },
    };
  }
}
