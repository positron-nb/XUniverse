import { settings, SETTING_SPECS, type SettingKey } from '../core/Settings';
import type { SensorHub } from '../sensors/SensorHub';
import type { DeviceTune } from '../sensors/protocol';

const DEVICE_SPECS: { key: keyof DeviceTune; label: string; min: number; max: number; step: number }[] = [
  { key: 'clap_margin', label: 'Clap threshold', min: 0.02, max: 0.5, step: 0.01 },
  { key: 'mic_scale', label: 'Mic full scale', min: 200, max: 4095, step: 25 },
  { key: 'shake_g', label: 'Shake threshold', min: 0.2, max: 2, step: 0.05 },
];

const fmt = (v: number, step: number) => v.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 4);

/**
 * Developer tuning (T key): calibrate ranges against the real hardware,
 * shape the responses, and adjust the board's own thresholds over the link.
 * Hidden in presentation mode.
 */
export class TuningPanel {
  private el: HTMLElement;
  private live: Record<string, HTMLElement> = {};
  private inputs = new Map<string, { input: HTMLInputElement; out: HTMLElement; step: number }>();
  private acc = 0;
  private status = '';

  constructor(parent: HTMLElement, private hub: SensorHub) {
    this.el = document.createElement('div');
    this.el.className = 'tuning';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.build();
  }

  toggle() {
    this.el.hidden = !this.el.hidden;
  }

  private build() {
    const h = (html: string) => {
      const t = document.createElement('template');
      t.innerHTML = html.trim();
      return t.content.firstElementChild as HTMLElement;
    };
    this.el.append(h(`<div class="t-head">Tuning <span>T to close</span></div>`));

    // Live raw readings that the calibration refers to.
    const raw = h(`<div class="t-live">
      <span>light <b data-l="light"></b></span>
      <span>dist <b data-l="dist"></b></span></div>`);
    raw.querySelectorAll<HTMLElement>('[data-l]').forEach((e) => (this.live[e.dataset.l!] = e));
    this.el.append(raw);

    let group = '';
    for (const spec of SETTING_SPECS) {
      if (spec.group !== group) {
        group = spec.group;
        this.el.append(h(`<div class="t-group">${group}</div>`));
        if (group === 'Calibration') {
          const row = h(`<div class="t-buttons">
            <button data-a="learn">Learn light · 10 s</button>
            <button data-a="near">Near = now</button><button data-a="far">Far = now</button></div>`);
          this.el.append(row);
          this.el.append(h(`<div class="t-status" data-l="status"></div>`));
          this.live.status = this.el.querySelector('[data-l=status]')!;
        }
      }
      this.addSlider(spec.key, spec.label, spec.min, spec.max, spec.step, settings.values[spec.key], (v) =>
        settings.set(spec.key as SettingKey, v),
      );
    }

    this.el.append(h(`<div class="t-group">Device <span data-l="devnote"></span></div>`));
    this.live.devnote = this.el.querySelector('[data-l=devnote]')!;
    for (const d of DEVICE_SPECS) {
      this.addSlider(`dev.${d.key}`, d.label, d.min, d.max, d.step, d.min, (v) => this.hub.setDeviceTune(d.key, v), true);
    }

    this.el.append(h(`<div class="t-buttons end">
      <button data-a="copy">Copy JSON</button><button data-a="reset">Reset</button></div>`));

    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset?.a;
      const n = this.hub.normalizer;
      if (a === 'learn') {
        n.learner.start(10);
        this.status = 'cover the LDR with a finger, then shine a light on it…';
      } else if (a === 'near' || a === 'far') {
        const d = n.rawDistance;
        if (d === null) this.status = 'no valid distance reading right now';
        else {
          settings.set(a === 'near' ? 'distNear' : 'distFar', Math.round(d * 2) / 2);
          this.status = `${a} = ${d.toFixed(1)} cm`;
        }
      } else if (a === 'reset') {
        settings.reset();
        this.status = 'defaults restored';
      } else if (a === 'copy') {
        navigator.clipboard?.writeText(settings.toJSON());
        this.status = 'settings copied — paste into config.ts or send them over';
      } else return;
      this.syncFromSettings();
    });
    // Keys typed into the panel shouldn't drive the simulated board.
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  private addSlider(id: string, label: string, min: number, max: number, step: number, value: number,
    onChange: (v: number) => void, onRelease = false) {
    const row = document.createElement('label');
    row.className = 't-row';
    row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
    const input = row.querySelector('input')!;
    const out = row.querySelector('output')!;
    input.value = String(value);
    out.textContent = fmt(value, step);
    input.addEventListener('input', () => {
      out.textContent = fmt(+input.value, step);
      if (!onRelease) onChange(+input.value);
    });
    // Device settings go over the network, so send once on release.
    if (onRelease) input.addEventListener('change', () => onChange(+input.value));
    this.inputs.set(id, { input, out, step });
    this.el.append(row);
  }

  private syncFromSettings() {
    for (const spec of SETTING_SPECS) {
      const s = this.inputs.get(spec.key)!;
      s.input.value = String(settings.values[spec.key]);
      s.out.textContent = fmt(settings.values[spec.key], s.step);
    }
  }

  update(dt: number) {
    this.acc += dt;
    if (this.el.hidden || this.acc < 0.2) return;
    this.acc = 0;
    const p = this.hub.lastPacket;
    this.live.light.textContent = p?.light?.toString() ?? '—';
    this.live.dist.textContent = p?.dist != null ? `${p.dist.toFixed(1)} cm` : '—';

    const learner = this.hub.normalizer.learner;
    if (learner.active) {
      const step = learner.phase === 'cover' ? 'COVER the LDR with a finger' : 'now SHINE a light on it';
      this.live.status.textContent = `${step}  ·  ${learner.remaining.toFixed(0)} s`;
    } else if (learner.lastResult) {
      this.status = learner.lastResult;
      learner.lastResult = '';
      this.syncFromSettings();
      this.live.status.textContent = this.status;
    } else {
      this.live.status.textContent = this.status;
    }

    // Device thresholds: show the board's echoed values; disabled in simulation.
    const tune = this.hub.deviceTune;
    this.live.devnote.textContent = tune ? `· ${this.hub.device.name}` : '· connect the ESP32';
    for (const d of DEVICE_SPECS) {
      const s = this.inputs.get(`dev.${d.key}`)!;
      s.input.disabled = !tune;
      if (tune && document.activeElement !== s.input) {
        s.input.value = String(tune[d.key]);
        s.out.textContent = fmt(tune[d.key], s.step);
      } else if (!tune) s.out.textContent = '—';
    }
  }
}
