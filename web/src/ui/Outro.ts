/**
 * Closing title for the video: the corners fade, the camera pulls back and the
 * name settles over the living field. The field keeps responding underneath.
 */
export class Outro {
  private el: HTMLElement;
  active = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'outro';
    this.el.innerHTML = `
      <div class="o1">Positron</div>
      <div class="o2">Sensor Universe</div>
      <div class="o3">Physical measurements → real-time simulation</div>
      <div class="o4">ESP32 · MPU6050 · HC-SR04 · BMP280 · DHT11 · LDR · Three.js</div>`;
    parent.appendChild(this.el);
  }

  toggle(): boolean {
    this.active = !this.active;
    this.el.classList.toggle('on', this.active);
    document.body.classList.toggle('outro-on', this.active);
    return this.active;
  }
}
