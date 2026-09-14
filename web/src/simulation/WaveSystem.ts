import * as THREE from 'three';
import { CONFIG } from '../config';
import { settings } from '../core/Settings';

const W = CONFIG.waves;
const LIFETIME = 3.2; // s — long enough to cross the whole field

interface Wave {
  origin: THREE.Vector3;
  t0: number;
  strength: number;
}

/**
 * Pressure waves travelling through the field. Waves live in a fixed number of
 * slots that are uploaded as shader uniforms; the oldest slot is reused.
 */
export class WaveSystem {
  /** xyz = origin, w = start time. */
  readonly uWaveA = Array.from({ length: W.slots }, () => new THREE.Vector4(0, 0, 0, -100));
  /** x = strength, y = extreme (0/1). */
  readonly uWaveB = Array.from({ length: W.slots }, () => new THREE.Vector4());
  clock = 0;
  totalTriggered = 0;

  private waves: (Wave | null)[] = Array(W.slots).fill(null);

  trigger(origin: THREE.Vector3, rawStrength: number) {
    const strength = rawStrength * settings.values.waveGain;
    if (strength <= 0.01) return;
    let slot = this.waves.findIndex((w) => !w || this.clock - w.t0 > LIFETIME);
    if (slot < 0) {
      slot = 0;
      for (let i = 1; i < W.slots; i++) if (this.waves[i]!.t0 < this.waves[slot]!.t0) slot = i;
    }
    this.waves[slot] = { origin: origin.clone(), t0: this.clock, strength };
    this.uWaveA[slot].set(origin.x, origin.y, origin.z, this.clock);
    this.uWaveB[slot].set(strength, strength >= W.extreme ? 1 : 0, 0, 0);
    this.totalTriggered++;
  }

  /**
   * Advances the wave clock and spawns spontaneous micro-events when the field
   * is energetic. Returns current disturbance activity (0..~1).
   */
  update(dt: number, eventRate: number, attractor: THREE.Vector3, axis: THREE.Vector3, radius: number) {
    this.clock += dt;
    if (eventRate > 0 && Math.random() < eventRate * dt) {
      // Small local event somewhere on the disk plane.
      const t = new THREE.Vector3(1, 0, 0);
      if (Math.abs(axis.x) > 0.9) t.set(0, 0, 1);
      const u = t.cross(axis).normalize();
      const v = axis.clone().cross(u);
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.3 + Math.random() * 0.6);
      const o = attractor.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r);
      this.trigger(o, 0.12 + Math.random() * 0.14);
    }
    let activity = 0;
    for (const w of this.waves) {
      if (!w) continue;
      const age = this.clock - w.t0;
      if (age < LIFETIME) activity += w.strength * Math.exp(-age / 0.9);
    }
    return Math.min(1, activity);
  }
}
