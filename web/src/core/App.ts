import * as THREE from 'three';
import { CONFIG } from '../config';
import { PostChain, type FrameLook } from '../effects/PostChain';
import { settings } from './Settings';
import { SensorHub } from '../sensors/SensorHub';
import { fieldStrength, SimulationState } from '../simulation/SimulationState';
import { SensorHistory } from './History';
import { ModeBlender } from '../simulation/ModeBlender';
import { ParticleField } from '../simulation/particles/ParticleField';
import { WaveSystem } from '../simulation/WaveSystem';
import { DebugPanel } from '../ui/DebugPanel';
import { playIntro } from '../ui/Intro';
import { TuningPanel } from '../ui/TuningPanel';
import { Captions } from '../ui/Captions';
import { Outro } from '../ui/Outro';
import { Recorder } from './Recorder';
import { AdaptiveQuality } from './AdaptiveQuality';
import { Overlay } from '../ui/Overlay';
import { CinematicCamera } from './CinematicCamera';
import { bindInput } from './Input';

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Wires the pipeline together:
 *   SensorHub → Normalizer → SimulationState (+ SensorHistory)
 *             → WaveSystem / ModeBlender → ParticleField (GPU physics) → PostChain
 * Sensor packets arrive at their own rate; everything below runs per frame.
 */
export class App {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: CinematicCamera;
  private post: PostChain;
  readonly hub = new SensorHub();
  readonly state = new SimulationState();
  readonly history = new SensorHistory();
  private waves = new WaveSystem();
  private modes = new ModeBlender();
  private field: ParticleField;
  private overlay: Overlay;
  private debug: DebugPanel;
  private tuning: TuningPanel;
  private captions: Captions;
  private outro: Outro;
  private recorder: Recorder;
  private recIndicator: HTMLElement;
  private quality = new AdaptiveQuality(
    Math.min(devicePixelRatio, CONFIG.quality.maxPixelRatio),
    !new URLSearchParams(location.search).has('fixedres'),
  );

  private coreNdc = new THREE.Vector3();
  private tanHalfFov = Math.tan((CONFIG.camera.fov * Math.PI) / 360);
  private look: FrameLook = {
    time: 0, illumination: 0.5, haze: 0.4, coreUv: new THREE.Vector2(0.5, 0.5), coreVisible: true,
    shadow: 0, coreMass: 0, coreActivity: 0, lensing: 1, coreLight: 1, reducedMotion: prefersReducedMotion(),
    adaptation: 0,
  };

  private clock = new THREE.Timer();
  private time = 0;
  private simTime = 0;
  private revealed = false;

  constructor(canvas: HTMLCanvasElement, private ui: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    // Count render statistics per frame (physics passes + particles + post), not per call.
    this.renderer.info.autoReset = false;
    this.cam = new CinematicCamera(canvas);
    this.cam.reducedMotion = this.look.reducedMotion;
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      this.cam.reducedMotion = this.look.reducedMotion = e.matches;
    });
    this.field = new ParticleField(this.renderer, this.waves);
    this.scene.add(this.field.points);
    this.post = new PostChain(this.renderer, this.scene, this.cam.camera);
    this.overlay = new Overlay(ui);
    this.debug = new DebugPanel(ui);
    this.tuning = new TuningPanel(ui, this.hub);
    this.captions = new Captions(ui, this.hub, this.state);
    this.outro = new Outro(ui);
    this.recorder = new Recorder(canvas);
    this.recIndicator = document.createElement('div');
    this.recIndicator.className = 'rec';
    this.recIndicator.hidden = true;
    ui.appendChild(this.recIndicator);

    this.hub.onImpulse((e) => {
      const s = this.state;
      const R = CONFIG.field.radius;
      if (e.kind === 'clap') {
        this.waves.trigger(s.attractor, e.strength);
      } else {
        // A shake starts from the side the board was leaning toward.
        const o = s.attractor.clone()
          .addScaledVector(this.cam.basis.right, Math.sign(e.roll ?? 0.3) * R * 0.55)
          .addScaledVector(this.cam.basis.up, Math.sign(e.pitch ?? 0) * R * 0.2);
        this.waves.trigger(o, 0.35 + 0.45 * e.strength);
      }
    });

    bindInput(this.hub, {
      toggleDebug: () => this.debug.toggle(),
      toggleTuning: () => this.tuning.toggle(),
      togglePresentation: () => {
        const on = document.body.classList.toggle('presentation');
        this.cam.presentation = on;
        this.cam.setShot(on ? 'auto' : 'wide');
      },
      toggleUi: () => document.body.classList.toggle('hide-ui'),
      setShot: (shot) => this.cam.setShot(shot),
      toggleCaptions: () => this.captions.toggle(),
      toggleOutro: () => this.cam.setZoom(this.outro.toggle() ? 1.35 : 1),
      toggleRecording: () => {
        this.recorder.toggle();
        this.recIndicator.hidden = !this.recorder.recording;
      },
    });

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  async start() {
    this.hub.start();
    this.clock.connect(document);
    this.renderer.setAnimationLoop(() => this.frame());
    const params = new URLSearchParams(location.search);
    await playIntro(this.ui, params.has('nointro'));
    this.revealed = true;
    setTimeout(() => this.overlay.setVisible(true), params.has('nointro') ? 0 : 2600);
  }

  private resize() {
    const w = innerWidth;
    const h = innerHeight;
    const pr = this.quality.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, pr);
    this.cam.resize(w / h);
    this.field.setViewport(h * pr, CONFIG.camera.fov);
  }

  /** Dev hook: advance a fixed number of frames without requestAnimationFrame. */
  step(frames = 1, dt = 1 / 60) {
    for (let i = 0; i < frames; i++) this.frame(dt);
  }

  private frame(fixedDt?: number) {
    this.clock.update();
    this.renderer.info.reset();
    // Clamp so a hidden tab or a stall never produces a physics explosion.
    const dt = fixedDt ?? Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    if (fixedDt === undefined && this.revealed && this.quality.update(dt)) this.resize();
    const s = this.state;

    this.hub.update(dt);
    this.cam.update(dt, s.attractor, s.compression);
    s.update(this.hub.inputs, this.cam.basis, dt, this.history);
    this.history.update(dt, () => {
      const i = this.hub.inputs;
      return {
        energy: s.energy, temperature: i.temperature, humidity: i.humidity, pressure: i.pressure,
        light: s.illumination, proximity: i.proximity, field: fieldStrength(s.compression),
        tilt: (Math.hypot(i.roll, i.pitch) * 180) / Math.PI, impulse: s.impulse,
      };
    });
    if (this.revealed) s.advanceBirth(dt);
    // LDR covered / uncovered: a soft ripple from the core marks the moment.
    if (s.lightEvent && s.birth >= 1) this.waves.trigger(s.attractor, s.lightEvent === 'dark' ? 0.32 : 0.22);

    const activity = this.waves.update(
      dt, s.birth >= 1 ? s.eventRate : 0, s.attractor, s.axis, CONFIG.field.radius * s.compression,
    );
    s.relaxImpulse(activity, dt);
    this.modes.update(s, dt);

    this.simTime += Math.min(dt, 1 / 20) * s.timeScale;
    const coreDepth = this.cam.depthOf(s.attractor);
    this.field.update(s, this.waves, dt, this.simTime, coreDepth);

    // Where the core sits on screen, for lensing and its light.
    const ndc = this.coreNdc.copy(s.attractor).project(this.cam.camera);
    this.look.coreUv.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
    this.look.coreVisible = coreDepth > 1;
    this.look.shadow = coreDepth > 1 ? this.field.horizon / (2 * coreDepth * this.tanHalfFov) : 0;
    this.look.time = this.time;
    this.look.illumination = s.illumination;
    this.look.haze = s.haze;
    this.look.coreMass = s.coreMass;
    this.look.coreActivity = s.coreActivity * Math.min(1, s.birth * 1.3);
    this.look.lensing = settings.values.lensing;
    this.look.coreLight = settings.values.core;
    this.look.adaptation = s.adaptation;
    this.post.render(this.look);

    this.overlay.update(dt, this.hub, s, this.modes, this.history);
    this.debug.update(dt, {
      hub: this.hub, state: s, modes: this.modes, waves: this.waves, history: this.history,
      renderer: this.renderer, particles: this.field.count, pixelRatio: this.quality.pixelRatio,
      horizon: this.field.horizon,
    });
    this.tuning.update(dt);
    this.captions.update(dt);
    if (this.recorder.recording) {
      const t = Math.floor(this.recorder.seconds);
      this.recIndicator.textContent = `REC ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    }
  }
}
