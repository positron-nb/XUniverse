import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp, damp, Spring } from './math';
import type { CameraBasis } from '../simulation/SimulationState';

const C = CONFIG.camera;

/**
 * Framings for recording. Each one shows a different aspect of the system:
 * wide = the whole field · close = grain and turbulence · edge = the disk as a
 * thin plane, so tilt and waves read clearly · top = spiral structure.
 */
export const SHOTS = {
  wide: { elevation: 0.36, distance: 1.0, drift: 1.0 },
  close: { elevation: 0.24, distance: 0.6, drift: 0.7 },
  edge: { elevation: 0.05, distance: 0.82, drift: 0.5 },
  top: { elevation: 1.2, distance: 0.95, drift: 0.8 },
};
export type ShotName = keyof typeof SHOTS;
const AUTO_ORDER: ShotName[] = ['wide', 'close', 'edge', 'top'];
const AUTO_SHOT_SECONDS = 24;

/**
 * A scientific-visualisation camera: very slow orbital drift, long-period
 * breathing, a few degrees of mouse parallax, drag to orbit, wheel to dolly.
 * Everything is damped; nothing is ever abrupt.
 *
 * Framing adapts to the window: on narrower aspect ratios the camera backs off
 * so the field never slides under the telemetry.
 */
export class CinematicCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly basis: CameraBasis = {
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    forward: new THREE.Vector3(0, 0, -1),
  };
  /** Presentation mode drifts a little slower and ignores parallax. */
  presentation = false;
  /** prefers-reduced-motion: slower drift, no automatic shot changes, no parallax. */
  reducedMotion = false;

  /** Current shot and the eased framing parameters that move toward it. */
  shot: ShotName = 'wide';
  auto = false;

  private time = 0;
  private azimuth = 0.35;
  private mouse = new THREE.Vector2();
  private parallax = new THREE.Vector2();
  private userAz = 0;
  private userEl = 0;
  private zoom = 1;
  private zoomTarget = 1;
  private fit = 1;
  private target = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private dragging: { x: number; y: number } | null = null;
  private autoTimer = 0;
  private el = new Spring(SHOTS.wide.elevation, 2.8);
  private dist = new Spring(SHOTS.wide.distance, 2.8);
  private drift = new Spring(SHOTS.wide.drift, 2.8);
  private push = new Spring(1, 1.6);

  constructor(el: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(C.fov, 1, 0.1, 400);
    el.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
      if (this.dragging) {
        this.userAz -= (e.clientX - this.dragging.x) * 0.004;
        this.userEl = clamp(this.userEl + (e.clientY - this.dragging.y) * 0.003, -0.5, 0.7);
        this.dragging = { x: e.clientX, y: e.clientY };
      }
    });
    el.addEventListener('pointerdown', (e) => (this.dragging = { x: e.clientX, y: e.clientY }));
    addEventListener('pointerup', () => (this.dragging = null));
    el.addEventListener('wheel', (e) => {
      this.zoomTarget = clamp(this.zoomTarget * Math.exp(e.deltaY * 0.0008), 0.55, 1.7);
    }, { passive: true });
  }

  /** Dolly relative to the shot's framing (1 = as framed). */
  setZoom(z: number) {
    this.zoomTarget = z;
  }

  /** Select a framing; the camera glides there over a few seconds. */
  setShot(name: ShotName | 'auto') {
    this.auto = name === 'auto' && !this.reducedMotion;
    this.autoTimer = 0;
    if (name !== 'auto') this.shot = name;
    this.userEl = 0;
    this.zoomTarget = 1;
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // Keep the whole disk (plus a margin) inside the frame horizontally.
    const halfW = Math.atan(Math.tan((C.fov * Math.PI) / 360) * aspect);
    const needed = (CONFIG.field.radius * 1.25 * 1.3) / Math.tan(halfW);
    this.fit = Math.max(1, needed / C.distance);
  }

  /**
   * `focusPoint` is what the camera loosely follows (the attractor);
   * `compression` pushes the camera in slightly as the field contracts.
   */
  update(dt: number, focusPoint: THREE.Vector3, compression = 1) {
    this.time += dt;
    if (this.auto && (this.autoTimer += dt) > AUTO_SHOT_SECONDS) {
      this.autoTimer = 0;
      this.shot = AUTO_ORDER[(AUTO_ORDER.indexOf(this.shot) + 1) % AUTO_ORDER.length];
    }
    const shot = SHOTS[this.shot];
    const shotEl = this.el.update(shot.elevation, dt);
    const shotDist = this.dist.update(shot.distance, dt);
    const driftScale = (this.presentation ? 0.7 : 1) * (this.reducedMotion ? 0.35 : 1);
    this.azimuth += C.driftSpeed * this.drift.update(shot.drift, dt) * driftScale * dt;

    const still = this.presentation || this.reducedMotion;
    this.parallax.x = damp(this.parallax.x, still ? 0 : this.mouse.x * C.parallax, 1 / C.damping, dt);
    this.parallax.y = damp(this.parallax.y, still ? 0 : this.mouse.y * C.parallax, 1 / C.damping, dt);
    this.zoom = damp(this.zoom, this.zoomTarget, 0.6, dt);
    const push = this.push.update(0.955 + 0.045 * Math.min(compression, 1), dt);

    const az = this.azimuth + this.userAz + this.parallax.x;
    const breathe = this.reducedMotion ? 0 : 1;
    const el = clamp(shotEl + 0.07 * breathe * Math.sin(this.time * 0.043) + this.userEl + this.parallax.y, -0.6, 1.35);
    const dist = C.distance * this.fit * shotDist * this.zoom * push * (1 + 0.04 * breathe * Math.sin(this.time * 0.031));

    // Follow the attractor only partially — the frame stays composed.
    this.target.lerp(this.tmp.copy(focusPoint).multiplyScalar(0.35), 1 - Math.exp(-dt / 0.6));

    this.camera.position.set(
      this.target.x + dist * Math.cos(el) * Math.sin(az),
      this.target.y + dist * Math.sin(el),
      this.target.z + dist * Math.cos(el) * Math.cos(az),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();

    const m = this.camera.matrixWorld;
    this.basis.right.setFromMatrixColumn(m, 0).normalize();
    this.basis.up.setFromMatrixColumn(m, 1).normalize();
    this.basis.forward.setFromMatrixColumn(m, 2).negate().normalize();
  }

  /** Distance to a world point along the view axis (for depth of field). */
  depthOf(p: THREE.Vector3) {
    return this.tmp.copy(p).sub(this.camera.position).dot(this.basis.forward);
  }
}
