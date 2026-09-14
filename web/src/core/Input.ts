import type { SensorHub } from '../sensors/SensorHub';
import type { ShotName } from './CinematicCamera';
import { settings } from './Settings';

export interface AppActions {
  toggleDebug(): void;
  toggleTuning(): void;
  togglePresentation(): void;
  toggleUi(): void;
  setShot(shot: ShotName | 'auto'): void;
  toggleCaptions(): void;
  toggleOutro(): void;
  toggleRecording(): void;
}

const SHOT_KEYS: Record<string, ShotName | 'auto'> = {
  Digit1: 'wide', Digit2: 'close', Digit3: 'edge', Digit4: 'top', Digit5: 'auto',
};

/**
 * Keyboard → simulated hardware. Any physical-style input hands control from
 * the autopilot to you; A gives it back.
 */
export function bindInput(hub: SensorHub, app: AppActions) {
  const sim = hub.sim;
  const c = sim.controls;
  const held = new Set<string>();

  const recompute = () => {
    c.tiltX = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0);
    c.tiltY = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0);
    c.handDir = (held.has('KeyS') ? 1 : 0) - (held.has('KeyW') ? 1 : 0);
    c.twist = held.has('KeyZ') ? 1 : 0;
  };

  const continuous = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'KeyZ']);

  addEventListener('keydown', (e) => {
    // Energy is a setting (no hardware knob): Q / E step it, holding repeats.
    if (e.code === 'KeyQ' || e.code === 'KeyE') {
      const step = e.code === 'KeyE' ? 0.05 : -0.05;
      settings.set('energy', Math.round(Math.min(1, Math.max(0, settings.values.energy + step)) * 100) / 100);
      return;
    }
    if (e.repeat) return;
    if (continuous.has(e.code)) {
      sim.takeOver();
      held.add(e.code);
      recompute();
      e.preventDefault();
      return;
    }
    if (SHOT_KEYS[e.code]) {
      app.setShot(SHOT_KEYS[e.code]);
      return;
    }
    switch (e.code) {
      case 'KeyK': app.toggleCaptions(); break;
      case 'KeyO': app.toggleOutro(); break;
      case 'KeyV': app.toggleRecording(); break;
      case 'Space':
        sim.takeOver();
        sim.clap(e.shiftKey ? 0.95 : 0.65);
        e.preventDefault();
        break;
      case 'KeyX': sim.takeOver(); sim.shake(0.7); break;
      case 'KeyB': sim.takeOver(); sim.breathe(); break;
      case 'KeyN': sim.toggleLight(); break;
      case 'KeyA':
        sim.autopilot = !sim.autopilot;
        break;
      case 'KeyC': hub.calibrate(); break;
      case 'KeyM': hub.toggleMode(); break;
      case 'KeyU': hub.toggleUsb(); break;
      case 'KeyD': app.toggleDebug(); break;
      case 'KeyT': app.toggleTuning(); break;
      case 'KeyP': app.togglePresentation(); break;
      case 'KeyH': app.toggleUi(); break;
      case 'KeyF':
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
        break;
    }
  });

  addEventListener('keyup', (e) => {
    if (held.delete(e.code)) recompute();
  });
  addEventListener('blur', () => {
    held.clear();
    recompute();
  });
}
