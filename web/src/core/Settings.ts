import { CONFIG } from '../config';

/**
 * Values tuned against the real hardware (tuning panel, T key). Defaults come
 * from config.ts; changes persist in localStorage and can be exported as JSON
 * to be baked back into config.ts.
 */
export interface SettingSpec {
  key: SettingKey;
  label: string;
  group: 'Calibration' | 'Response';
  min: number;
  max: number;
  step: number;
  unit?: string;
}

const DEFAULTS = {
  /** Baseline energy of the field (0 still · 0.45 natural · 1 turbulent). */
  energy: 0.45,
  /** 1 when more light gives fewer counts on this wiring (set by Learn light). */
  lightInvert: 0,
  lightDark: CONFIG.light.darkCounts as number,
  lightBright: CONFIG.light.brightCounts as number,
  distNear: CONFIG.distance.nearCm as number,
  distFar: CONFIG.distance.farCm as number,
  tiltTravel: CONFIG.field.tiltTravel as number,
  compressionNear: CONFIG.field.compressionNear as number,
  waveGain: 1,
  brightness: 0.38,
  aperture: 0.0035,
  core: 1,
  lensing: 1,
};

export type SettingKey = keyof typeof DEFAULTS;
export type SettingValues = { -readonly [K in SettingKey]: number };

export const SETTING_SPECS: SettingSpec[] = [
  { key: 'lightInvert', label: 'Light inverted', group: 'Calibration', min: 0, max: 1, step: 1 },
  { key: 'lightDark', label: 'Light dark', group: 'Calibration', min: 1, max: 2000, step: 5, unit: 'cts' },
  { key: 'lightBright', label: 'Light bright', group: 'Calibration', min: 500, max: 4095, step: 5, unit: 'cts' },
  { key: 'distNear', label: 'Hand near', group: 'Calibration', min: 2, max: 40, step: 0.5, unit: 'cm' },
  { key: 'distFar', label: 'Hand far', group: 'Calibration', min: 30, max: 200, step: 1, unit: 'cm' },
  { key: 'energy', label: 'Energy', group: 'Response', min: 0, max: 1, step: 0.01 },
  { key: 'tiltTravel', label: 'Tilt travel', group: 'Response', min: 0, max: 8, step: 0.1 },
  { key: 'compressionNear', label: 'Max compression', group: 'Response', min: 0.2, max: 0.9, step: 0.01 },
  { key: 'waveGain', label: 'Wave strength', group: 'Response', min: 0, max: 2, step: 0.05 },
  { key: 'brightness', label: 'Brightness', group: 'Response', min: 0.1, max: 1, step: 0.01 },
  { key: 'aperture', label: 'Depth of field', group: 'Response', min: 0, max: 0.012, step: 0.0005 },
  { key: 'core', label: 'Core light', group: 'Response', min: 0, max: 2, step: 0.05 },
  { key: 'lensing', label: 'Lensing', group: 'Response', min: 0, max: 2, step: 0.05 },
];

const STORAGE_KEY = 'positron.settings';

class SettingsStore {
  readonly values: SettingValues = { ...DEFAULTS };

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      for (const k of Object.keys(DEFAULTS) as SettingKey[]) {
        if (typeof saved[k] === 'number' && Number.isFinite(saved[k])) this.values[k] = saved[k];
      }
    } catch {
      /* no storage — defaults */
    }
  }

  set(key: SettingKey, value: number) {
    this.values[key] = value;
    this.persist();
  }

  reset() {
    Object.assign(this.values, DEFAULTS);
    this.persist();
  }

  isDefault(key: SettingKey) {
    return this.values[key] === DEFAULTS[key];
  }

  toJSON() {
    return JSON.stringify(this.values, null, 2);
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      /* ignore */
    }
  }
}

export const settings = new SettingsStore();
