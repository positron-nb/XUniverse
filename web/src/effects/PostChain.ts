import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { lerp } from '../core/math';
import finalFrag from './shaders/final.glsl?raw';

export interface FrameLook {
  time: number;
  illumination: number;
  haze: number;
  /** Core position in uv (0..1) and whether it is in front of the camera. */
  coreUv: THREE.Vector2;
  coreVisible: boolean;
  /** Apparent radius of the dark centre, fraction of screen height. */
  shadow: number;
  coreMass: number;
  coreActivity: number;
  lensing: number;
  coreLight: number;
  reducedMotion: boolean;
  /** Eye adaptation to darkness 0..1 (eclipse). */
  adaptation: number;
}

/**
 * HDR particle buffer → one final pass (lensing, core, AgX, grade) → screen.
 * Particles accumulate additively in half-float, so dense regions roll off
 * like film instead of clipping to flat white.
 */
export class PostChain {
  private composer: EffectComposer;
  private final: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    // Tone mapping happens in our own final pass, so the renderer must not add another.
    renderer.toneMapping = THREE.NoToneMapping;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.final = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uCore: { value: new THREE.Vector2(0.5, 0.5) },
        uCoreDepthOk: { value: 1 },
        uEinstein: { value: 0.02 },
        uShadow: { value: 0.015 },
        uCoreGlow: { value: 0 },
        uCorePin: { value: 0 },
        uGlowRadius: { value: 0.06 },
        uGround: { value: new THREE.Color(0.03, 0.03, 0.032) },
        uGrain: { value: 0.035 },
        uGrainAnimated: { value: 1 },
        uVignette: { value: 0.55 },
        toneMappingExposure: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      // three.js already injects the colour-space helpers (sRGBTransferOETF);
      // the AgX curve comes from its tone-mapping chunk.
      fragmentShader: THREE.ShaderChunk.tonemapping_pars_fragment + '\n' + finalFrag,
    });
    this.composer.addPass(this.final);
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.final.uniforms.uResolution.value.set(w * pixelRatio, h * pixelRatio);
  }

  render(look: FrameLook) {
    const u = this.final.uniforms;
    u.uTime.value = look.time;
    // A brighter room lifts the ground a touch — the scene sits in the same light.
    const g = lerp(0.016, 0.042, look.illumination);
    (u.uGround.value as THREE.Color).setRGB(g, g, g * 1.04);
    // Dark room: the "eye" slowly opens up (eclipse adaptation).
    u.toneMappingExposure.value = lerp(0.85, 1.1, look.illumination) * (1 + 0.55 * look.adaptation);

    (u.uCore.value as THREE.Vector2).copy(look.coreUv);
    u.uCoreDepthOk.value = look.coreVisible ? 1 : 0;
    u.uShadow.value = look.shadow;
    // Einstein radius grows with the attractor's mass (hand near the sensor).
    u.uEinstein.value = look.shadow * (1.25 + 0.55 * look.coreMass) * Math.sqrt(look.lensing);
    // The core's light becomes visible where the air carries it (humidity haze).
    u.uCoreGlow.value = look.coreLight * look.coreActivity * (0.012 + 0.03 * look.haze) * (1 + 3 * look.adaptation);
    u.uGlowRadius.value = 0.035 + 0.05 * look.haze;
    u.uCorePin.value = look.coreLight * (0.8 + 2.2 * look.coreActivity);
    u.uGrainAnimated.value = look.reducedMotion ? 0 : 1;
    this.composer.render();
  }
}
