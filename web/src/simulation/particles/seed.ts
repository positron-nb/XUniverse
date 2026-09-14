import { gaussian, mulberry32 } from '../../core/math';

/**
 * Per-particle constants: where each grain "wants" to live. Classes occupy
 * contiguous texture ranges so GPU branches stay coherent.
 *
 *   x: home radius (fraction of field radius)   y: home height
 *   z: class 0 disk · 1 halo · 2 accretion       w: uniform random 0..1
 *
 * Accretion grains start in the inner disk and spiral into the core over their
 * lifetime, then re-enter at their starting radius — a continuous inflow that
 * keeps matter dense and fast around the centre.
 */
export const CLASS_SHARE = { disk: 0.7, halo: 0.18, accretion: 0.12 };

/** Thin rings at fixed radii give the disk structure and negative space. */
const RINGS = [0.36, 0.58, 0.83, 1.07];

export function buildSeed(count: number, seed = 1729): Float32Array {
  const rand = mulberry32(seed);
  const data = new Float32Array(count * 4);
  const diskEnd = Math.floor(count * CLASS_SHARE.disk);
  const haloEnd = diskEnd + Math.floor(count * CLASS_SHARE.halo);

  for (let i = 0; i < count; i++) {
    let r: number;
    let h = 0;
    let cls: number;
    if (i < diskEnd) {
      cls = 0;
      if (rand() < 0.24) {
        r = RINGS[Math.floor(rand() * RINGS.length)] + gaussian(rand) * 0.012;
      } else {
        // Exponential disk with a hollow centre.
        r = 0.14 + -Math.log(1 - rand() * 0.96) * 0.3;
      }
      r = Math.min(r, 1.5);
      h = gaussian(rand) * 0.016 * (0.4 + r); // flaring
    } else if (i < haloEnd) {
      cls = 1;
      r = 0.95 + Math.pow(rand(), 0.7) * 0.95;
    } else {
      cls = 2;
      r = 0.2 + Math.pow(rand(), 1.4) * 0.6;
    }
    data[i * 4] = r;
    data[i * 4 + 1] = h;
    data[i * 4 + 2] = cls;
    data[i * 4 + 3] = rand();
  }
  return data;
}
