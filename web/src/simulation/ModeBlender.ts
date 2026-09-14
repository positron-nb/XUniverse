import { damp, smoothstep } from '../core/math';
import type { SimulationState } from './SimulationState';

export const MODES = ['calm', 'disturbance', 'gravity', 'overdrive', 'environment', 'eclipse'] as const;
export type Mode = (typeof MODES)[number];

/**
 * Modes are not screens — they are emergent descriptions of the fused state.
 * Weights are continuous; the dominant one is shown as a single word.
 */
export class ModeBlender {
  readonly weights: Record<Mode, number> = {
    calm: 1, disturbance: 0, gravity: 0, overdrive: 0, environment: 0, eclipse: 0,
  };
  dominant: Mode = 'calm';

  update(s: SimulationState, dt: number) {
    const target: Record<Mode, number> = {
      disturbance: smoothstep(0.08, 0.5, s.impulse),
      gravity: Math.max(smoothstep(0.15, 0.6, s.gravity), smoothstep(0.05, 0.35, 1 - s.compression)),
      overdrive: smoothstep(0.68, 0.92, s.energy),
      environment: Math.max(smoothstep(0.1, 0.5, s.convection), smoothstep(0.3, 0.9, Math.abs(s.pressure))),
      eclipse: smoothstep(0.25, 0.7, s.adaptation),
      calm: 0,
    };
    target.calm = 1 - Math.max(target.disturbance, target.gravity, target.overdrive, target.environment, target.eclipse);

    let best: Mode = this.dominant;
    for (const m of MODES) {
      this.weights[m] = damp(this.weights[m], target[m], 0.4, dt);
      // Small hysteresis so the label doesn't flicker between near-equal modes.
      if (this.weights[m] > this.weights[best] + 0.08) best = m;
    }
    this.dominant = best;
  }
}
