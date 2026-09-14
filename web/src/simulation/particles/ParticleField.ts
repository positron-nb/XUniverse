import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { CONFIG } from '../../config';
import { lerp } from '../../core/math';
import { settings } from '../../core/Settings';
import type { SimulationState } from '../SimulationState';
import type { WaveSystem } from '../WaveSystem';
import { buildSeed } from './seed';
import noiseGlsl from './shaders/noise.glsl?raw';
import wavesGlsl from './shaders/waves.glsl?raw';
import velocityGlsl from './shaders/velocity.glsl?raw';
import positionGlsl from './shaders/position.glsl?raw';
import pointsVert from './shaders/points.vert.glsl?raw';
import pointsFrag from './shaders/points.frag.glsl?raw';

/** Largest simulation step; bigger frames are split into sub-steps. */
const MAX_STEP = 1 / 45;
/**
 * Share of the attractor's motion / compression that matter follows at once.
 * The rest arrives through the physics, which keeps a sense of inertia and the
 * visible bend of the field without making gestures feel delayed.
 */
const CARRY = 0.75;

/**
 * GPGPU particle field. Positions and velocities live in float textures and are
 * integrated entirely on the GPU; the CPU only sets a few dozen uniforms per
 * frame, regardless of particle count.
 *
 * Integration is semi-implicit (symplectic) Euler: the velocity pass runs
 * first and the position pass reads the *new* velocity. That keeps orbits and
 * spring-backs stable without artificial damping, so the motion stays alive.
 */
export class ParticleField {
  readonly count: number;
  readonly points: THREE.Points;
  /** Radius of the dark centre (world units), for the post pass. */
  horizon = 0;
  private gpu: GPUComputationRenderer;
  private velVar: Variable;
  private posVar: Variable;
  private material: THREE.ShaderMaterial;
  private seedTex: THREE.DataTexture;
  private pattern = 0;
  /** Which of the two ping-pong render targets holds the current state. */
  private cur = 0;
  private prevAttractor = new THREE.Vector3();
  private prevCompression = 0;

  constructor(renderer: THREE.WebGLRenderer, waves: WaveSystem, size = CONFIG.quality.textureSize) {
    this.count = size * size;
    this.gpu = new GPUComputationRenderer(size, size, renderer);

    const seed = buildSeed(this.count);
    this.seedTex = new THREE.DataTexture(seed, size, size, THREE.RGBAFormat, THREE.FloatType);
    this.seedTex.needsUpdate = true;

    // Everything starts as a hot, thin ring around the centre; birth releases it.
    const pos0 = this.gpu.createTexture();
    const vel0 = this.gpu.createTexture();
    const pd = pos0.image.data as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + 0.4 * Math.cbrt(Math.random());
      const s = Math.sqrt(1 - u * u);
      pd[i * 4] = r * s * Math.cos(a);
      pd[i * 4 + 1] = r * u * 0.3;
      pd[i * 4 + 2] = r * s * Math.sin(a);
      pd[i * 4 + 3] = 0;
    }

    const waveUniforms = {
      uWaveA: { value: waves.uWaveA },
      uWaveB: { value: waves.uWaveB },
      uClock: { value: 0 },
      uWaveSpeed: { value: CONFIG.waves.speed },
      uWaveWidth: { value: CONFIG.waves.width },
    };

    this.velVar = this.gpu.addVariable('textureVelocity', noiseGlsl + wavesGlsl + velocityGlsl, vel0);
    this.posVar = this.gpu.addVariable('texturePosition', noiseGlsl + positionGlsl, pos0);
    this.gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);
    this.gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);

    // Uniform objects shared by both passes (and the render pass where useful).
    const shared = {
      tSeed: { value: this.seedTex },
      uDt: { value: 0 },
      uTime: { value: 0 },
      uAttractor: { value: new THREE.Vector3() },
      uAxis: { value: new THREE.Vector3(0, 1, 0) },
      uRadius: { value: CONFIG.field.radius },
      uCompression: { value: 1 },
      uAttraction: { value: 1 },
      uHorizon: { value: 0.4 },
    };
    Object.assign(this.velVar.material.uniforms, shared, waveUniforms, {
      uOrbit: { value: 1 },
      uSpin: { value: 0 },
      uTurbulence: { value: 0.2 },
      uDrag: { value: 1 },
      uConvection: { value: 0 },
      uThermal: { value: 0.5 },
      uPattern: { value: 0 },
      uBodyForce: { value: new THREE.Vector3() },
    });
    Object.assign(this.posVar.material.uniforms, shared, {
      uCarryFrom: { value: new THREE.Vector3() },
      uCarryScale: { value: 1 },
      uCarry: { value: 0 },
    });

    const err = this.gpu.init();
    if (err) throw new Error(`GPGPU init failed: ${err}`);

    // One vertex per particle; `reference` addresses its texel.
    const geometry = new THREE.BufferGeometry();
    const refs = new Float32Array(this.count * 2);
    for (let i = 0; i < this.count; i++) {
      refs[i * 2] = ((i % size) + 0.5) / size;
      refs[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.count * 3), 3));
    geometry.setAttribute('reference', new THREE.BufferAttribute(refs, 2));

    this.material = new THREE.ShaderMaterial({
      vertexShader: wavesGlsl + pointsVert,
      fragmentShader: pointsFrag,
      uniforms: {
        ...waveUniforms,
        tPos: { value: null },
        tVel: { value: null },
        tSeed: { value: this.seedTex },
        uPixelScale: { value: 1000 },
        uSize: { value: 0.034 },
        uFocus: { value: CONFIG.camera.distance },
        uAperture: { value: 0.0035 },
        uLightDir: { value: new THREE.Vector3(0.45, -0.3, 0.84).normalize() },
        uKeyLight: { value: 1 },
        uAmbient: { value: 0.05 },
        uCoreLight: { value: 1 },
        uDensity: { value: 0.8 },
        uHaze: { value: 0.4 },
        uThermal: { value: 0.5 },
        uEnergy: { value: 0.5 },
        uReveal: { value: 0 },
        uAttractor: shared.uAttractor,
        uRadius: shared.uRadius,
        uCompression: shared.uCompression,
        uGain: { value: 0.38 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  setViewport(heightPx: number, fovDeg: number) {
    this.material.uniforms.uPixelScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  update(s: SimulationState, waves: WaveSystem, realDt: number, simTime: number, focus: number) {
    const simDt = Math.min(realDt, 1 / 20) * s.timeScale;
    const steps = Math.min(3, Math.max(1, Math.ceil(simDt / MAX_STEP)));
    const dt = simDt / steps;
    this.pattern += simDt * 0.045 * s.orbit;
    // The dark centre grows a little with the attractor's "mass".
    this.horizon = CONFIG.field.radius * 0.045 * (0.8 + 0.5 * s.coreMass) * Math.sqrt(Math.max(s.compression, 0.05));

    const vu = this.velVar.material.uniforms;
    const pu = this.posVar.material.uniforms;
    pu.uDt.value = dt;
    pu.uTime.value = simTime;
    pu.uCompression.value = s.compression;
    pu.uAttraction.value = s.attraction;
    pu.uHorizon.value = this.horizon;
    (pu.uAttractor.value as THREE.Vector3).copy(s.attractor);
    (pu.uAxis.value as THREE.Vector3).copy(s.axis);
    vu.uOrbit.value = s.orbit;
    vu.uSpin.value = s.spin;
    vu.uTurbulence.value = s.turbulence;
    vu.uDrag.value = s.drag;
    vu.uConvection.value = s.convection;
    vu.uThermal.value = s.thermal;
    vu.uPattern.value = this.pattern;
    (vu.uBodyForce.value as THREE.Vector3).copy(s.attractor).multiplyScalar(0.12);
    vu.uClock.value = waves.clock;

    // Carry the field with the attractor's motion and compression since last
    // frame (applied in the first sub-step only), so gestures read immediately.
    const ratio = this.prevCompression > 0 ? s.compression / this.prevCompression : 1;
    (pu.uCarryFrom.value as THREE.Vector3).copy(this.prevAttractor);
    pu.uCarryScale.value = Math.min(1.25, Math.max(0.8, ratio));
    pu.uCarry.value = CARRY;
    for (let i = 0; i < steps; i++) {
      this.step();
      if (i === 0) {
        (pu.uCarryFrom.value as THREE.Vector3).copy(s.attractor);
        pu.uCarryScale.value = 1;
      }
    }
    this.prevAttractor.copy(s.attractor);
    this.prevCompression = s.compression;

    const mu = this.material.uniforms;
    mu.tPos.value = this.posVar.renderTargets[this.cur].texture;
    mu.tVel.value = this.velVar.renderTargets[this.cur].texture;
    mu.uClock.value = waves.clock;
    mu.uFocus.value = focus;
    mu.uKeyLight.value = lerp(0.2, 1.05, s.illumination);
    mu.uAmbient.value = lerp(0.012, 0.08, s.illumination);
    // In an eclipse the adapted eye sees the core as the only light source.
    mu.uCoreLight.value = s.coreActivity * lerp(1.1, 1.8, s.illumination) * (1 + 3.2 * s.adaptation) * settings.values.core;
    mu.uDensity.value = s.density;
    mu.uHaze.value = s.haze;
    mu.uThermal.value = s.thermal;
    mu.uEnergy.value = s.energy;
    mu.uReveal.value = Math.min(1, s.birth * 1.6);
    // Normalised to the reference count, so density changes detail, not exposure.
    mu.uGain.value = settings.values.brightness * Math.pow(36864 / this.count, 0.8);
    mu.uAperture.value = settings.values.aperture;
  }

  /** One semi-implicit Euler step: velocity from the old state, position from the new velocity. */
  private step() {
    const g = this.gpu;
    const cur = this.cur;
    const next = cur === 0 ? 1 : 0;
    const vu = this.velVar.material.uniforms;
    const pu = this.posVar.material.uniforms;

    vu.texturePosition.value = this.posVar.renderTargets[cur].texture;
    vu.textureVelocity.value = this.velVar.renderTargets[cur].texture;
    g.doRenderTarget(this.velVar.material, this.velVar.renderTargets[next]);

    pu.texturePosition.value = this.posVar.renderTargets[cur].texture;
    pu.textureVelocity.value = this.velVar.renderTargets[next].texture;
    g.doRenderTarget(this.posVar.material, this.posVar.renderTargets[next]);

    this.cur = next;
  }
}
