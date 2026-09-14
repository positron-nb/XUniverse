/**
 * Records the WebGL canvas straight from the GPU — clean, full-resolution
 * footage without the typography (the text is HTML). Use it for B-roll; use
 * OBS or Win+Alt+R when the UI text should be in the shot.
 * MP4 (H.264) when the browser supports it — what LinkedIn expects — else WebM.
 */
export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  get recording() {
    return this.rec !== null;
  }

  get seconds() {
    return this.rec ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  constructor(private canvas: HTMLCanvasElement) {}

  toggle() {
    if (this.rec) this.stop();
    else this.start();
  }

  private pickType() {
    const types = ['video/mp4;codecs=avc1.640033', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  }

  private start() {
    if (typeof MediaRecorder === 'undefined') {
      console.warn('[recorder] MediaRecorder not available in this browser');
      return;
    }
    const stream = this.canvas.captureStream(60);
    const mimeType = this.pickType();
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 40_000_000 });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.onstop = () => this.save(mimeType);
    this.rec.start(1000);
    this.startedAt = performance.now();
  }

  private stop() {
    this.rec?.stop();
    this.rec = null;
  }

  private save(mimeType: string) {
    const blob = new Blob(this.chunks, { type: mimeType || 'video/webm' });
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `positron-${stamp}.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
}
