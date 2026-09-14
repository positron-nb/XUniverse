import type * as THREE from 'three';
import type { SensorHistory } from '../core/History';
import type { SensorHub } from '../sensors/SensorHub';
import type { SimulationState } from '../simulation/SimulationState';
import type { ModeBlender } from '../simulation/ModeBlender';
import { MODES } from '../simulation/ModeBlender';
import type { WaveSystem } from '../simulation/WaveSystem';

export interface DebugContext {
  hub: SensorHub;
  state: SimulationState;
  modes: ModeBlender;
  waves: WaveSystem;
  history: SensorHistory;
  renderer: THREE.WebGLRenderer;
  particles: number;
  pixelRatio: number;
  horizon: number;
}

/**
 * Developer overlay — hidden by default and never visible in presentation mode.
 * Everything a bench test needs: frame time, link health, raw → normalized →
 * fused values, and the GPU doing the work.
 */
export class DebugPanel {
  private el: HTMLElement;
  private acc = 0;
  private frames = 0;
  private fps = 0;
  private frameMs = 0;
  private worstMs = 0;
  private gpuName: string | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'debug';
    this.el.hidden = !new URLSearchParams(location.search).has('debug');
    parent.appendChild(this.el);
  }

  toggle() {
    this.el.hidden = !this.el.hidden;
  }

  update(dt: number, ctx: DebugContext) {
    this.frames++;
    this.acc += dt;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    this.worstMs = Math.max(this.worstMs, dt * 1000);
    if (this.acc < 0.25) return;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    const worst = this.worstMs;
    this.worstMs = 0;
    if (this.el.hidden || document.body.classList.contains('presentation')) return;

    const { hub, state: s, modes, waves, renderer } = ctx;
    const i = hub.inputs;
    const p = hub.lastPacket;
    const link = hub.device;
    const st = link.stats;
    const info = renderer.info;
    if (this.gpuName === null) this.gpuName = gpuName(renderer);
    const f = (x: number | null | undefined, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '      —' : x.toFixed(d).padStart(7));
    const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1).padStart(6);
    const bar = (x: number) => '▮'.repeat(Math.round(Math.max(0, Math.min(1, x)) * 12)).padEnd(12, '·');
    const missing = link.hello ? Object.entries(link.hello.sensors).filter(([, v]) => !v).map(([k]) => `${k}✗`).join(' ') : '';

    this.el.textContent = [
      `── render ──────────────────────────`,
      `FPS          ${this.fps.toFixed(0).padStart(7)}   ${this.frameMs.toFixed(1)} ms  worst ${worst.toFixed(0)} ms`,
      `particles    ${String(ctx.particles).padStart(7)}   render ×${ctx.pixelRatio.toFixed(2)}`,
      `draw calls   ${String(info.render.calls).padStart(7)}   points ${info.render.points}  programs ${info.programs?.length ?? '—'}`,
      `gpu          ${this.gpuName}`,
      ``,
      `── link ────────────────────────────`,
      `state        ${hub.linkState.padStart(7)}   source ${hub.activeSource}`,
      `${link.name.padEnd(12)} ${link.status.padStart(7)}   ${link.url}`,
      `firmware     ${(link.hello?.fw ?? '—').padStart(7)}   ${missing}`,
      `packets/s    ${hub.packetRate.toFixed(1).padStart(7)}   rtt ${Number.isNaN(st.rttMs) ? '—' : st.rttMs.toFixed(0) + ' ms'}  jitter ${st.jitterMs.toFixed(0)} ms`,
      `rejected     ${String(st.dropped).padStart(7)} lost  ${st.outOfOrder} late  ${st.malformed} bad  ${st.reboots} reboot`,
      `autopilot    ${(hub.sim.autopilot ? 'on' : 'off').padStart(7)}`,
      ``,
      `── raw ─────────────────────────────`,
      `light        ${f(p?.light, 0)}   dist cm ${f(p?.dist, 1)}`,
      `sound        ${f(p?.sound?.level)}`,
      `accel g   ${f(p?.mpu?.ax)}${f(p?.mpu?.ay)}${f(p?.mpu?.az)}`,
      `gyro °/s  ${f(p?.mpu?.gx, 1)}${f(p?.mpu?.gy, 1)}${f(p?.mpu?.gz, 1)}`,
      `bme  ${f(p?.env?.t)} °C ${f(p?.env?.rh, 1)} % ${f(p?.env?.p)} hPa`,
      `dht  ${f(p?.env?.t2, 0)} °C ${f(p?.env?.rh2, 0)} %`,
      ``,
      `── normalized ──────────────────────`,
      `roll/pitch ° ${deg(i.roll)} ${deg(i.pitch)}   twist ${f(i.twist)}`,
      `proximity    ${f(i.proximity)}   ${bar(i.proximity)}`,
      `illumination ${f(i.illumination)}   ${bar(i.illumination)}`,
      `sound        ${f(i.soundLevel)}   ${bar(i.soundLevel)}`,
      `thermal      ${f(i.thermal)}   humidity ${f(i.humidityNorm)}`,
      `pressure Δ   ${f(i.pressureDelta)}   convect ${f(i.convection)}`,
      ``,
      `── simulation state ────────────────`,
      `fast   gravity ${f(s.gravity)}  spin ${f(s.spin)}  impulse ${f(s.impulse)}`,
      `medium energy  ${f(s.energy)}  compr ${f(s.compression)}  light ${f(s.illumination)}`,
      `slow   thermal ${f(s.thermal)}  humid ${f(s.humidity)}  heat ${f(s.heat)}`,
      `physics time ×${s.timeScale.toFixed(2)}  orbit ${s.orbit.toFixed(2)}  turb ${s.turbulence.toFixed(2)}  drag ${s.drag.toFixed(2)}`,
      `core   mass ${f(s.coreMass)}  activity ${f(s.coreActivity)}  horizon ${ctx.horizon.toFixed(2)}`,
      `waves  ${String(waves.totalTriggered).padStart(4)} fired   spontaneous ${s.eventRate.toFixed(2)}/s`,
      `trend  T ${f(ctx.history.trendPerMinute('temperature'), 2)} °C/min  P ${f(ctx.history.trendPerMinute('pressure'), 3)} hPa/min`,
      ``,
      `── modes ───────────────────────────`,
      ...MODES.map((m) => `${m.padEnd(12)} ${bar(modes.weights[m])} ${m === modes.dominant ? '◂' : ''}`),
      ``,
      `── keys ────────────────────────────`,
      `←→↑↓ tilt   W/S hand   Q/E energy setting   Z twist`,
      `SPACE clap (⇧ extreme)   X shake   B breathe   N light`,
      `A autopilot   C level   M wi-fi   U usb`,
      `P present   H hide   D debug   T tune   F fullscreen`,
      `1–4 shot   5 auto   K captions   O outro   V record`,
    ].join('\n');
  }
}

function gpuName(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const raw = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  // "ANGLE (AMD, AMD Radeon 780M Graphics (0x…) Direct3D11 …)" → "AMD Radeon 780M Graphics"
  const m = raw.match(/ANGLE \([^,]+, ([^(]+?)\s*(\(|Direct3D|OpenGL|,)/);
  return (m ? m[1] : raw).slice(0, 40);
}
