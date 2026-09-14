/**
 * Wire protocol v1 — identical for the real ESP32 and the simulated device.
 * See docs/DESIGN.md §4.
 */

export const PROTOCOL_VERSION = 1;

export interface MpuReading {
  ax: number; ay: number; az: number; // g
  gx: number; gy: number; gz: number; // °/s
  roll?: number; pitch?: number; // ° (device-side fused, optional)
}

export interface EnvReading {
  t: number | null; // BME280 °C
  rh: number | null; // BME280 %
  p: number | null; // BME280 hPa
  t2: number | null; // DHT11 °C
  rh2: number | null; // DHT11 %
}

/** [sequence, strength 0..1] — a new sequence number means a new event. */
export type EventCounter = [number, number];

export interface FramePacket {
  type: 'frame';
  v: number;
  seq: number;
  t: number; // ms since device boot
  mpu: MpuReading | null;
  dist: number | null; // cm
  light: number | null; // ADC counts
  sound: { level: number; peak: number } | null;
  env: EnvReading | null;
  ev?: { clap?: EventCounter; shake?: EventCounter };
}

/** Device-side thresholds, adjustable with {"type":"cmd","cmd":"set","key","value"}. */
export interface DeviceTune {
  clap_margin: number;
  mic_scale: number;
  shake_g: number;
}

export interface HelloPacket {
  type: 'hello';
  v: number;
  device: string;
  fw: string;
  sensors: Record<string, boolean>;
  rate: number;
  tune?: DeviceTune;
}

export interface TunePacket {
  type: 'tune';
  tune: DeviceTune;
}

/** Heartbeat reply: echoes the browser's timestamp for a round-trip measurement. */
export interface PongPacket {
  type: 'pong';
  t: number;
}

export type DevicePacket = FramePacket | HelloPacket | TunePacket | PongPacket;

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
/** A number within physically possible limits, else null (sensor glitch / corrupted packet). */
const within = (x: unknown, lo: number, hi: number) => {
  const n = num(x);
  return n !== null && n >= lo && n <= hi ? n : null;
};
const counter = (x: unknown): EventCounter | undefined =>
  Array.isArray(x) && num(x[0]) !== null && num(x[1]) !== null ? [x[0], Math.min(1, Math.max(0, x[1]))] : undefined;

/**
 * Parses and sanity-checks an incoming message. Returns null for garbage.
 * Individual out-of-range readings become null (treated as "missing") rather
 * than rejecting the whole frame, so one bad sensor never freezes the others.
 */
export function parsePacket(raw: string): DevicePacket | null {
  let o: any;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;

  if (o.type === 'pong') return num(o.t) !== null ? (o as PongPacket) : null;
  if (o.type === 'hello') {
    return typeof o.fw === 'string' && o.sensors && typeof o.sensors === 'object' ? (o as HelloPacket) : null;
  }
  if (o.type === 'tune') {
    const t = o.tune;
    return t && num(t.clap_margin) !== null && num(t.mic_scale) !== null && num(t.shake_g) !== null
      ? (o as TunePacket)
      : null;
  }
  if (o.type !== 'frame' || num(o.seq) === null) return null;

  const m = o.mpu;
  const ax = within(m?.ax, -16, 16), ay = within(m?.ay, -16, 16), az = within(m?.az, -16, 16);
  const mpu: MpuReading | null =
    ax !== null && ay !== null && az !== null
      ? {
          ax, ay, az,
          gx: within(m.gx, -2000, 2000) ?? 0, gy: within(m.gy, -2000, 2000) ?? 0, gz: within(m.gz, -2000, 2000) ?? 0,
          roll: within(m.roll, -180, 180) ?? undefined, pitch: within(m.pitch, -90, 90) ?? undefined,
        }
      : null;

  const e = o.env ?? {};
  const level = within(o.sound?.level, 0, 1.5);
  return {
    type: 'frame',
    v: num(o.v) ?? PROTOCOL_VERSION,
    seq: o.seq,
    t: num(o.t) ?? performance.now(),
    mpu,
    dist: within(o.dist, 0, 1000),
    light: within(o.light, 0, 4095),
    sound: level !== null ? { level: Math.min(level, 1), peak: Math.min(within(o.sound.peak, 0, 1.5) ?? level, 1) } : null,
    env: {
      t: within(e.t, -40, 85), rh: within(e.rh, 0, 100), p: within(e.p, 300, 1100),
      t2: within(e.t2, -20, 60), rh2: within(e.rh2, 0, 100),
    },
    ev: { clap: counter(o.ev?.clap), shake: counter(o.ev?.shake) },
  };
}
