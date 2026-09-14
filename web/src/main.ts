import './styles.css';
import { App } from './core/App';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

try {
  const app = new App(canvas, ui);
  app.start();
  if (import.meta.env.DEV) (window as any).positron = app;
} catch (err) {
  ui.innerHTML = `<div class="corner tl"><div class="title">Positron</div>
    <div class="subtitle">WebGL2 with float textures is required</div></div>`;
  (ui.firstElementChild as HTMLElement).style.opacity = '1';
  console.error(err);
}
