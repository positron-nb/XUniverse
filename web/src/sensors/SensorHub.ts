import { SerialSource } from '../communication/SerialSource';
import { WebSocketSource } from '../communication/WebSocketSource';
import { Normalizer, type ImpulseEvent } from './Normalizer';
import type { DeviceTune, FramePacket } from './protocol';
import { SimulatedSource } from './SimulatedSource';

export type SourceMode = 'live' | 'simulation';
/** What the user should be told about the data source. */
export type LinkState = 'simulation' | 'searching' | 'live' | 'lost';

/**
 * Owns every source and decides which one feeds the normalizer.
 *
 * SIMULATION — the virtual board drives the world.
 * LIVE       — only the ESP32 (Wi-Fi, or USB with the U key). Until frames
 *              arrive, or when they stop, the inputs relax toward a neutral,
 *              calm state: the world never freezes and never fakes data.
 */
export class SensorHub {
  readonly sim = new SimulatedSource();
  readonly wifi = new WebSocketSource();
  readonly usb = new SerialSource();
  readonly normalizer = new Normalizer();
  mode: SourceMode = 'simulation';
  lastPacket: FramePacket | null = null;
  packetRate = 0;

  private active: 'sim' | 'device' | 'none' = 'sim';
  private everLive = false;
  private listeners: ((e: ImpulseEvent) => void)[] = [];
  private packetCount = 0;
  private rateWindowStart = performance.now();

  constructor() {
    if (new URLSearchParams(location.search).has('live')) this.mode = 'live';
  }

  get inputs() {
    return this.normalizer.inputs;
  }

  /** What is driving the world right now. */
  get activeSource(): 'sim' | 'device' | 'none' {
    return this.active;
  }

  get linkState(): LinkState {
    if (this.mode === 'simulation') return 'simulation';
    if (this.active === 'device') return 'live';
    return this.everLive ? 'lost' : 'searching';
  }

  /** The device link currently in use (for status display). */
  get device(): WebSocketSource | SerialSource {
    return this.usb.status !== 'idle' ? this.usb : this.wifi;
  }

  onImpulse(fn: (e: ImpulseEvent) => void) {
    this.listeners.push(fn);
  }

  start() {
    if (this.mode === 'live') {
      this.active = 'none';
      this.wifi.start((p) => this.onWifiFrame(p));
    } else {
      this.startSim();
    }
  }

  setMode(mode: SourceMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'live') {
      this.sim.stop();
      this.switchTo('none');
      this.wifi.start((p) => this.onWifiFrame(p));
    } else {
      this.wifi.stop();
      if (this.usb.status !== 'idle') this.usb.stop();
      this.everLive = false;
      this.startSim();
    }
  }

  toggleMode() {
    this.setMode(this.mode === 'live' ? 'simulation' : 'live');
  }

  /** Opens / closes the USB link. Must run inside a user gesture (key press). */
  async toggleUsb() {
    if (this.usb.status !== 'idle' && this.usb.status !== 'closed') {
      await this.usb.stop();
      return;
    }
    try {
      await this.usb.start((p) => this.onDeviceFrame(p));
      if (this.mode !== 'live') {
        this.mode = 'live';
        this.sim.stop();
        this.switchTo('none');
      }
    } catch (e) {
      console.warn('[usb]', e);
      this.usb.status = 'idle';
    }
  }

  /** Called once per render frame: link supervision, neutral decay, packet-rate stats. */
  update(dt: number) {
    if (this.mode === 'live') {
      if (this.active === 'device' && !this.wifi.alive && !this.usb.alive) this.switchTo('none');
      if (this.active === 'none') this.normalizer.relax(dt);
    }
    const now = performance.now();
    if (now - this.rateWindowStart > 1000) {
      this.packetRate = (this.packetCount * 1000) / (now - this.rateWindowStart);
      this.packetCount = 0;
      this.rateWindowStart = now;
    }
  }

  calibrate() {
    this.normalizer.calibrate();
    this.command({ cmd: 'calibrate' });
  }

  /** Change a device-side threshold; the board echoes the accepted values. */
  setDeviceTune(key: keyof DeviceTune, value: number) {
    this.command({ cmd: 'set', key, value });
  }

  get deviceTune(): DeviceTune | null {
    return this.active === 'device' ? this.device.tune : null;
  }

  private startSim() {
    this.switchTo('sim');
    if (!this.sim.running) this.sim.start((p) => this.active === 'sim' && this.ingest(p));
  }

  private command(body: object) {
    const msg = { type: 'cmd', ...body };
    this.wifi.send(msg);
    this.usb.send(msg);
  }

  /** The same board can be on USB and Wi-Fi at once; USB wins while it is streaming. */
  private onWifiFrame(p: FramePacket) {
    if (!this.usb.alive) this.onDeviceFrame(p);
  }

  private onDeviceFrame(p: FramePacket) {
    if (this.mode !== 'live') return;
    if (this.active !== 'device') {
      this.switchTo('device');
      this.everLive = true;
    }
    this.ingest(p);
  }

  private switchTo(src: 'sim' | 'device' | 'none') {
    if (src === this.active) return;
    // Filters restart for a new source; going silent keeps them (the same board may return).
    if (src !== 'none') this.normalizer.reset();
    this.active = src;
  }

  private ingest(p: FramePacket) {
    this.lastPacket = p;
    this.packetCount++;
    for (const e of this.normalizer.ingest(p)) for (const fn of this.listeners) fn(e);
  }
}
