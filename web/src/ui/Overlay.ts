import type { HistoryChannel, SensorHistory } from '../core/History';
import { damp } from '../core/math';
import type { SensorHub } from '../sensors/SensorHub';
import { fieldStrength, type SimulationState } from '../simulation/SimulationState';
import type { ModeBlender } from '../simulation/ModeBlender';

interface ChannelSpec {
  key: string;
  label: string;
  unit: string;
  decimals: number;
  /** Display easing (s): slow sensors glide between their real measurements. */
  tau: number;
  history: HistoryChannel;
  /** Fixed trace range, or the minimum span when auto-ranging. */
  range?: [number, number];
  minSpan?: number;
}

const LEFT: ChannelSpec[] = [
  { key: 'temp', label: 'Temp', unit: '°C', decimals: 1, tau: 1.2, history: 'temperature', minSpan: 0.6 },
  { key: 'hum', label: 'Humidity', unit: '%', decimals: 0, tau: 1.5, history: 'humidity', minSpan: 4 },
  { key: 'press', label: 'Pressure', unit: 'hPa', decimals: 1, tau: 1.5, history: 'pressure', minSpan: 0.4 },
  { key: 'light', label: 'Light', unit: '', decimals: 2, tau: 0.4, history: 'light', range: [0, 1] },
];
const RIGHT: ChannelSpec[] = [
  { key: 'energy', label: 'Energy', unit: '', decimals: 2, tau: 0.15, history: 'energy', range: [0, 1] },
  { key: 'field', label: 'Field', unit: '', decimals: 2, tau: 0.2, history: 'field', range: [0, 1] },
  { key: 'tilt', label: 'Tilt', unit: '°', decimals: 0, tau: 0.15, history: 'tilt', range: [0, 35] },
  { key: 'impulse', label: 'Impulse', unit: '', decimals: 2, tau: 0.1, history: 'impulse', range: [0, 1] },
];

/**
 * One telemetry channel: an eased value with last-digit hysteresis (so a
 * reading sitting between 26.4 and 26.5 doesn't flicker), and a hairline trace
 * of its last two minutes.
 */
class Readout {
  private shown: number | null = null;
  private printed: number | null = null;
  private text = '';
  private readonly step: number;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(readonly spec: ChannelSpec, private valueEl: HTMLElement, private canvas: HTMLCanvasElement) {
    this.step = Math.pow(10, -spec.decimals);
    this.ctx = canvas.getContext('2d')!;
  }

  tick(target: number | null, dt: number) {
    if (target === null || !Number.isFinite(target)) {
      this.shown = this.printed = null;
      return this.write('—');
    }
    this.shown = this.shown === null ? target : damp(this.shown, target, this.spec.tau, dt);
    if (this.printed === null || Math.abs(this.shown - this.printed) >= this.step * 0.75) {
      this.printed = Math.round(this.shown / this.step) * this.step;
    }
    this.write(this.printed.toFixed(this.spec.decimals));
  }

  private write(t: string) {
    if (t !== this.text) this.valueEl.textContent = this.text = t;
  }

  draw(history: SensorHistory) {
    const ring = history.rings[this.spec.history];
    const c = this.canvas;
    const dpr = Math.min(devicePixelRatio, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (ring.count < 2) return;
    let [lo, hi] = this.spec.range ?? ring.range();
    if (!this.spec.range) {
      const span = Math.max(hi - lo, this.spec.minSpan ?? 0);
      const mid = (hi + lo) / 2;
      lo = mid - span / 2;
      hi = mid + span / 2;
    }
    const n = ring.count;
    const cap = ring.capacity;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      // Right-aligned: the newest sample always sits at the right edge.
      const x = w - ((n - 1 - i) / (cap - 1)) * w;
      const y = h - 1 - ((ring.at(i) - lo) / (hi - lo || 1)) * (h - 2);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(226, 221, 212, 0.34)';
    g.stroke();
  }
}

/**
 * Four quiet corners of typography — instrumentation, not a dashboard.
 * Built once; afterwards only text nodes whose digits changed are touched.
 */
export class Overlay {
  private root: HTMLElement;
  private readouts = new Map<string, Readout>();
  private refs: Record<string, HTMLElement> = {};
  private historyVersion = -1;
  private domAcc = 0;
  private lastMode = '';
  private lastState = '';

  constructor(parent: HTMLElement) {
    const row = (s: ChannelSpec, mirror: boolean) => {
      const unit = s.unit ? `<span class="u">${s.unit}</span>` : '';
      const spark = `<canvas class="spark" data-s="${s.key}" aria-hidden="true"></canvas>`;
      const label = `<span class="k">${s.label}</span>`;
      const value = `<span class="v"><span data-v="${s.key}">—</span>${unit}</span>`;
      return mirror ? spark + label + value : label + value + spark;
    };
    this.root = document.createElement('div');
    this.root.innerHTML = `
      <div class="corner tl">
        <div class="title">Positron</div>
        <div class="subtitle">Sensor Universe</div>
      </div>
      <div class="corner tr" data-r="tr">
        <div class="status"><span data-r="src">Simulation</span><span class="dot" data-r="dot"></span></div>
        <div class="hint">D debug · P present · U usb · M wi-fi</div>
      </div>
      <div class="corner bl"><div class="readout">${LEFT.map((s) => row(s, false)).join('')}</div></div>
      <div class="corner br">
        <div class="readout mirror">${RIGHT.map((s) => row(s, true)).join('')}</div>
        <div class="mode" data-r="mode">calm</div>
      </div>`;
    parent.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-r]').forEach((el) => (this.refs[el.dataset.r!] = el));
    for (const s of [...LEFT, ...RIGHT]) {
      const v = this.root.querySelector<HTMLElement>(`[data-v="${s.key}"]`)!;
      const c = this.root.querySelector<HTMLCanvasElement>(`[data-s="${s.key}"]`)!;
      this.readouts.set(s.key, new Readout(s, v, c));
    }
    this.setVisible(false, 0);
  }

  setVisible(v: boolean, fadeMs = 1600) {
    this.root.querySelectorAll<HTMLElement>('.corner').forEach((el, i) => {
      el.style.transitionDelay = v ? `${(fadeMs / 1000) * 0.25 * i}s` : '0s';
      el.style.opacity = v ? '1' : '0';
    });
  }

  update(dt: number, hub: SensorHub, s: SimulationState, modes: ModeBlender, history: SensorHistory) {
    this.domAcc += dt;
    if (this.domAcc < 1 / 15) return; // text at 15 Hz is plenty for the eye
    const step = this.domAcc;
    this.domAcc = 0;

    const inp = hub.inputs;
    const r = this.readouts;
    r.get('temp')!.tick(inp.temperature, step);
    r.get('hum')!.tick(inp.humidity, step);
    r.get('press')!.tick(inp.pressure, step);
    r.get('light')!.tick(s.illumination, step);
    r.get('energy')!.tick(s.energy, step);
    r.get('field')!.tick(fieldStrength(s.compression), step);
    r.get('tilt')!.tick((Math.hypot(inp.roll, inp.pitch) * 180) / Math.PI, step);
    r.get('impulse')!.tick(s.impulse, step);

    if (history.version !== this.historyVersion) {
      this.historyVersion = history.version;
      for (const ro of r.values()) ro.draw(history);
    }

    const state = hub.linkState;
    const label = state === 'live' ? `ESP32 · ${hub.device.name}` : state === 'lost' ? 'Signal lost' : state === 'searching' ? 'Searching' : 'Simulation';
    if (label !== this.lastState) {
      this.lastState = label;
      this.refs.src.textContent = label;
      this.refs.dot.classList.toggle('on', state === 'live');
      this.refs.tr.dataset.state = state;
    }

    if (modes.dominant !== this.lastMode) {
      this.lastMode = modes.dominant;
      const el = this.refs.mode;
      el.style.opacity = '0';
      setTimeout(() => {
        el.textContent = modes.dominant;
        el.style.opacity = '';
      }, 450);
    }
  }
}
