import { CONFIG } from '../config';
import { invLerp } from '../core/math';
import { settings } from '../core/Settings';
import type { ImpulseEvent } from '../sensors/Normalizer';
import type { SensorHub } from '../sensors/SensorHub';
import type { SimulationState } from '../simulation/SimulationState';

interface Caption {
  priority: number;
  source: string;
  reading: string;
  effect: string;
}

const HOLD_S = 2.2;

/**
 * Presentation captions: when a physical input is being used, one quiet line
 * names the sensor, its reading and what it drives in the simulation — so a
 * video viewer can follow cause and effect without the debug overlay.
 */
export class Captions {
  /** Off by default: presentation shows only branding, telemetry and the field. K enables. */
  enabled = false;
  private el: HTMLElement;
  private acc = 0;
  private shown: Caption | null = null;
  private idle = 0;
  private event: { caption: Caption; age: number } | null = null;
  private ref = { tilt: 0 };
  private lightAvg = -1;

  constructor(parent: HTMLElement, private hub: SensorHub, private state: SimulationState) {
    this.el = document.createElement('div');
    this.el.className = 'caption';
    parent.appendChild(this.el);
    hub.onImpulse((e) => this.onEvent(e));
  }

  toggle() {
    this.enabled = !this.enabled;
  }

  private onEvent(e: ImpulseEvent) {
    const strength = e.strength.toFixed(2);
    this.event = {
      age: 0,
      caption: e.kind === 'clap'
        ? { priority: 10, source: 'Microphone', reading: `impulse ${strength}`, effect: 'pressure wave' }
        : { priority: 10, source: 'MPU6050', reading: `shake ${strength}`, effect: 'pressure wave' },
    };
  }

  update(dt: number) {
    if (this.event) this.event.age += dt;
    this.acc += dt;
    if (this.acc < 0.1) return;
    const tick = this.acc;
    this.acc = 0;

    const active = document.body.classList.contains('presentation') && this.enabled;
    const c = this.detect();
    if (c && active) {
      this.idle = 0;
      this.show(c);
    } else {
      this.idle += tick;
      if (this.idle > HOLD_S || !active) this.hide();
    }
  }

  /** Highest-priority input that is being used right now. */
  private detect(): Caption | null {
    const i = this.hub.inputs;
    const s = this.state;
    const candidates: Caption[] = [];

    if (this.event && this.event.age < HOLD_S) candidates.push(this.event.caption);

    if (i.handPresent && i.proximity > 0.08 && i.distanceCm !== null) {
      const field = invLerp(CONFIG.field.compressionFar, settings.values.compressionNear, s.compression);
      candidates.push({ priority: 8, source: 'HC-SR04', reading: `${i.distanceCm.toFixed(0)} cm`,
        effect: `compression ${field.toFixed(2)}` });
    }

    const tilt = (Math.hypot(i.roll, i.pitch) * 180) / Math.PI;
    if (tilt > 5 || Math.abs(tilt - this.ref.tilt) > 2) {
      candidates.push({ priority: 7, source: 'MPU6050', reading: `tilt ${tilt.toFixed(0)}°`, effect: 'gravity shifts' });
    }
    this.ref.tilt += (tilt - this.ref.tilt) * 0.3;

    if (Math.abs(i.twist) > 0.15) {
      candidates.push({ priority: 7, source: 'MPU6050', reading: `twist ${(i.twist * 180).toFixed(0)}°/s`, effect: 'field spins' });
    }

    if (i.convection > 0.2 && i.localHumidity !== null) {
      candidates.push({ priority: 5, source: 'DHT11', reading: `${i.localHumidity.toFixed(0)} % RH`, effect: 'warm convection' });
    }

    // Light: compare with a slow average so only real changes are captioned.
    if (this.lightAvg < 0) this.lightAvg = i.illumination;
    this.lightAvg += (i.illumination - this.lightAvg) * 0.03;
    if (Math.abs(i.illumination - this.lightAvg) > 0.06) {
      candidates.push({ priority: 4, source: 'LDR', reading: `light ${i.illumination.toFixed(2)}`, effect: 'illumination' });
    }

    return candidates.sort((a, b) => b.priority - a.priority)[0] ?? null;
  }

  private show(c: Caption) {
    const changedSource = !this.shown || this.shown.source !== c.source;
    this.shown = c;
    const html = `<span class="c-src">${c.source}</span><span class="c-read">${c.reading}</span>` +
      `<span class="c-arrow">→</span><span class="c-eff">${c.effect}</span>`;
    if (changedSource && this.el.classList.contains('on')) {
      // Cross-fade when the subject changes.
      this.el.classList.remove('on');
      setTimeout(() => {
        this.el.innerHTML = html;
        this.el.classList.add('on');
      }, 350);
    } else {
      this.el.innerHTML = html;
      this.el.classList.add('on');
    }
  }

  private hide() {
    if (!this.shown) return;
    this.shown = null;
    this.el.classList.remove('on');
  }
}
