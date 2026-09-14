import * as THREE from 'three';
import { CONFIG } from '../config';
import type { SensorHistory } from '../core/History';
import { clamp, damp, Inertial, invLerp, lerp, smoothstep, Spring } from '../core/math';
import { settings } from '../core/Settings';
import type { NormalizedInputs } from '../sensors/Normalizer';

const R = CONFIG.response;
const F = CONFIG.field;

/**
 * Energy response curves. Deliberately *not* one multiplier: time runs almost
 * linearly, orbits respond early, turbulence only arrives late — so low
 * settings stay orderly and only the top of the knob becomes chaotic.
 */
export const energyCurves = {
  timeScale: (e: number) =>
    e < 0.5 ? lerp(0.12, 1, Math.pow(e / 0.5, 0.8)) : 1 + 0.85 * Math.pow((e - 0.5) / 0.5, 1.4),
  orbit: (e: number) => 0.3 + 0.95 * Math.pow(e, 0.85),
  turbulence: (e: number) => 0.05 + 0.6 * Math.pow(e, 2.6),
  /** Gas drag: a calm field is viscous, an energetic one lets matter coast. */
  drag: (e: number) => lerp(1.25, 0.7, e),
  eventRate: (e: number) => CONFIG.waves.spontaneousRate * clamp((e - 0.7) / 0.3) ** 1.5,
};

/** FIELD reading: how tightly the field is held, 0 = open … 1 = fully compressed. */
export const fieldStrength = (compression: number) =>
  invLerp(F.compressionFar, settings.values.compressionNear, compression);

export interface CameraBasis {
  right: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
}

/**
 * THE SIMULATION STATE — the only thing the physics and renderer read.
 *
 *   RAW PACKETS → Normalizer (filter, calibrate) → NormalizedInputs
 *               → SimulationState.update()  (fusion, response tiers, memory)
 *               → ParticleField / camera / post (physics + rendering)
 *
 * Sensors never touch Three.js objects directly. Each channel eases toward its
 * target at the speed of its tier:
 *   FAST   (≈0.1–0.3 s)  MPU6050 tilt / twist / shake, sound
 *   MEDIUM (≈0.6–1.8 s)  ultrasonic, LDR, DHT11 breath, energy setting
 *   SLOW   (≈9–45 s)     temperature, humidity, pressure, heat build-up
 */
export class SimulationState {
  // ── FAST ────────────────────────────────────────────────────────────────
  /** Where the field's centre of mass sits (tilt), world units. */
  readonly attractor = new THREE.Vector3();
  /** Orbital-plane normal (leans with the board). */
  readonly axis = new THREE.Vector3(0, 1, 0);
  /** Tilt magnitude 0..1. */
  gravity = 0;
  /** Twist → angular momentum added to the orbits (can reverse them briefly). */
  spin = 0;
  /** Current disturbance activity from waves 0..1 (set by the wave system). */
  impulse = 0;
  /** Ambient sound level above the floor → tiny agitation. */
  agitation = 0;

  // ── MEDIUM ──────────────────────────────────────────────────────────────
  energy = 0.45;
  /** Preferred-radius scale: 1 = open, ~0.4 = hand at the sensor. */
  compression = 1;
  /** Radial well stiffness (gravity strength). */
  attraction = 1;
  illumination = 0.55;
  convection = 0;
  /** Eye adaptation to darkness 0..1: rises slowly while the LDR is covered. */
  adaptation = 0;
  /** Set for one frame when the room goes dark / bright (LDR covered / uncovered). */
  lightEvent: 'dark' | 'light' | null = null;
  private lit = true;

  // ── SLOW ────────────────────────────────────────────────────────────────
  thermal = 0.5;
  humidity = 0.45;
  /** Pressure deviation from the session baseline, −1..1. */
  pressure = 0;
  /** Thermal load from sustained energy (history), 0..1. */
  heat = 0;

  // ── Derived physics parameters ──────────────────────────────────────────
  timeScale = 1;
  orbit = 1;
  turbulence = 0.2;
  drag = 1;
  eventRate = 0;
  density = 0.8;
  haze = 0.4;
  /** "Mass" of the central attractor 0..1 → horizon size, lensing, core light. */
  coreMass = 0;
  /** Core activity 0..1 → how much the core glows and pulses. */
  coreActivity = 0.3;
  /** 0 → 1 during the startup reveal; scales compression from a point. */
  birth = 0;

  private s = {
    energy: new Spring(0.45, R.medium.energy),
    compression: new Spring(0.2, R.medium.compression),
    attraction: new Spring(1, R.medium.compression),
    illumination: new Spring(0.55, R.medium.illumination),
    convection: new Spring(0, R.medium.convection),
    spin: new Spring(0, R.fast.twist),
    sound: new Spring(0, R.fast.sound),
    thermal: new Spring(0.5, R.slow.thermal),
    humidity: new Spring(0.45, R.slow.humidity),
    pressure: new Spring(0, R.slow.pressure),
  };
  private ax = new Inertial(0, R.fast.tiltHz, R.fast.tiltDamping);
  private ay = new Inertial(0, R.fast.tiltHz, R.fast.tiltDamping);
  private az = new Inertial(0, R.fast.tiltHz, R.fast.tiltDamping);
  private tmp = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private pulse = 0;

  update(inp: NormalizedInputs, cam: CameraBasis, dt: number, history: SensorHistory) {
    const s = this.s;

    // ── MEDIUM: energy — a set baseline (tuning panel / Q·E keys), eased ───
    const e = (this.energy = s.energy.update(settings.values.energy, dt));

    // ── SLOW: environment ──────────────────────────────────────────────────
    this.thermal = s.thermal.update(inp.thermal, dt);
    this.humidity = s.humidity.update(inp.humidityNorm, dt);
    this.pressure = s.pressure.update(inp.pressureDelta, dt);
    // Heat build-up: sustained energy over the last ~30 s warms the field; it
    // cools more slowly than it heats, like a real thermal mass.
    const recent = history.rings.energy;
    const load = recent.count > 4 ? recent.mean(60) ** 2 : e * e;
    this.heat = damp(this.heat, load, load > this.heat ? R.slow.heatUp : R.slow.heatDown, dt);

    // ── MEDIUM: light, breath ──────────────────────────────────────────────
    this.illumination = s.illumination.update(inp.illumination, dt);
    this.convection = s.convection.update(inp.convection, dt);

    // ── Eclipse (LDR covered) ──────────────────────────────────────────────
    // The light switch has hysteresis, so a flickering sensor can't chatter.
    this.lightEvent = null;
    if (this.lit && inp.illumination < 0.3) {
      this.lit = false;
      this.lightEvent = 'dark';
    } else if (!this.lit && inp.illumination > 0.6) {
      this.lit = true;
      this.lightEvent = 'light';
    }
    // Eye adaptation: in the dark the view slowly opens up (~4 s) until the core
    // is the only light left; in light it closes again quickly (~1 s).
    const darkTarget = 1 - smoothstep(0.1, 0.45, this.illumination);
    this.adaptation = damp(this.adaptation, darkTarget, darkTarget > this.adaptation ? 4 : 1, dt);

    // ── FAST: sound agitation ──────────────────────────────────────────────
    this.agitation = Math.max(0, s.sound.update(inp.soundLevel, dt) - 0.05);

    // ── Derived: energy & heat → motion ────────────────────────────────────
    const hot = this.thermal * 0.6 + this.heat * 0.4;
    this.timeScale = energyCurves.timeScale(e) * (0.94 + 0.12 * this.heat);
    this.orbit = energyCurves.orbit(e);
    this.drag = energyCurves.drag(e);
    this.eventRate = energyCurves.eventRate(e);
    this.turbulence =
      energyCurves.turbulence(e) * (0.8 + 0.5 * hot) * (0.88 + 0.12 * this.illumination) +
      0.3 * this.agitation +
      0.2 * this.impulse;
    this.density = 0.55 + 0.45 * this.humidity;
    this.haze = 0.15 + 0.7 * this.humidity;

    // ── MEDIUM: compression (ultrasonic + slow pressure) — nonlinear like 1/r
    const p = Math.pow(clamp(inp.proximity), 1.8);
    const birthScale = 0.04 + 0.96 * this.birth * this.birth * (3 - 2 * this.birth);
    const target = lerp(F.compressionFar, settings.values.compressionNear, p) * (1 - 0.05 * this.pressure);
    this.compression = s.compression.update(target, dt) * birthScale;
    this.attraction = s.attraction.update(lerp(F.attractionFar, F.attractionNear, Math.pow(p, 1.3)), dt);
    this.coreMass = invLerp(F.attractionFar, F.attractionNear, this.attraction);

    // ── FAST: gravity (MPU6050) — a mass on a spring, so it lags and settles ──
    const maxTilt = (CONFIG.mpu.maxTiltDeg * Math.PI) / 180;
    const tx = Math.sin(inp.roll) / Math.sin(maxTilt);
    const ty = Math.sin(inp.pitch) / Math.sin(maxTilt);
    const travel = settings.values.tiltTravel;
    // Left/right slides the field; forward/back sends it deeper or closer.
    const goal = this.tmp
      .copy(cam.right).multiplyScalar(tx * travel)
      .addScaledVector(cam.up, ty * travel * 0.3)
      .addScaledVector(cam.forward, ty * travel * F.tiltDepth);
    this.attractor.set(this.ax.update(goal.x, dt), this.ay.update(goal.y, dt), this.az.update(goal.z, dt));
    this.gravity = clamp(Math.hypot(tx, ty));

    // Orbital plane leans with the board, like a gyroscope.
    const n = this.tmp.set(0, 1, 0);
    this.q.setFromAxisAngle(cam.forward, -inp.roll * F.axisLean);
    n.applyQuaternion(this.q);
    this.q.setFromAxisAngle(cam.right, inp.pitch * F.axisLean);
    n.applyQuaternion(this.q);
    this.axis.lerp(n, 1 - Math.exp(-dt / R.fast.axis)).normalize();

    this.spin = s.spin.update(inp.twist * 1.1, dt);

    // ── Core: brighter with energy and mass, a quick flare on each impulse ──
    this.pulse = damp(this.pulse, this.impulse, 0.4, dt);
    this.coreActivity = clamp(0.2 + 0.45 * Math.pow(e, 1.5) + 0.15 * this.heat + 0.15 * this.coreMass + 0.35 * this.pulse);
  }

  /** Slowly relax toward the target after the intro. */
  advanceBirth(dt: number, duration = 4.5) {
    this.birth = Math.min(1, this.birth + dt / duration);
  }

  relaxImpulse(level: number, dt: number) {
    this.impulse = damp(this.impulse, level, 0.25, dt);
  }
}
