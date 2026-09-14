import { CONFIG } from '../config';
import { parsePacket, type DeviceTune, type FramePacket, type HelloPacket } from '../sensors/protocol';
import { LinkStats, pingMessage } from './LinkStats';
import type { LinkStatus } from './WebSocketSource';

/**
 * USB link to the ESP32 using the Web Serial API (Chrome / Edge).
 * Sends `json` to switch the firmware console into protocol mode, then reads
 * newline-delimited frames — the same schema and validation as the Wi-Fi link.
 */
export class SerialSource {
  readonly name = 'USB';
  readonly url = 'usb serial 460800';
  status: LinkStatus = 'idle';
  hello: HelloPacket | null = null;
  tune: DeviceTune | null = null;
  readonly stats = new LinkStats();

  private port: any = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private writer: WritableStreamDefaultWriter<string> | null = null;
  private listener: ((p: FramePacket) => void) | null = null;
  private closing: Promise<void> | null = null;
  private heartbeat: number | null = null;

  static get supported() {
    return 'serial' in navigator;
  }

  get alive() {
    return this.status === 'open' && this.stats.fresh();
  }

  /** Must be called from a user gesture (the browser shows a port picker). */
  async start(listener: (p: FramePacket) => void) {
    if (!SerialSource.supported) throw new Error('Web Serial not supported — use Chrome or Edge');
    this.listener = listener;
    this.status = 'connecting';
    try {
      this.port = await (navigator as any).serial.requestPort();
      // Must match SERIAL_BAUD in the firmware's config.h.
      await this.port.open({ baudRate: 460800 });
    } catch (e) {
      this.status = 'closed';
      throw e;
    }
    this.status = 'open';
    this.stats.reset();

    const enc = new TextEncoderStream();
    enc.readable.pipeTo(this.port.writable).catch(() => {});
    this.writer = enc.writable.getWriter();
    const dec = new TextDecoderStream();
    this.closing = this.port.readable.pipeTo(dec.writable).catch(() => {});
    this.reader = dec.readable.getReader();

    await this.writer.write('\njson\n');
    this.heartbeat = window.setInterval(() => this.send(pingMessage()), CONFIG.device.heartbeatMs);
    this.readLoop();
  }

  async stop() {
    this.status = 'idle';
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    try {
      await this.reader?.cancel();
      await this.closing;
      await this.writer?.write('status\n');
      this.writer?.releaseLock();
      await this.port?.close();
    } catch {
      /* port already gone */
    }
    this.port = this.reader = this.writer = null;
  }

  send(obj: object) {
    this.writer?.write(JSON.stringify(obj) + '\n').catch(() => {});
  }

  private async readLoop() {
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await this.reader!.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line.startsWith('{')) this.onLine(line);
          else if (line) console.info('[esp32]', line); // console/diagnostic text
        }
        if (buf.length > 4096) buf = ''; // a line that long is corrupted
      }
    } catch {
      /* unplugged */
    }
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.status === 'open') this.status = 'closed';
  }

  private onLine(line: string) {
    const p = parsePacket(line);
    if (!p) return this.stats.onMalformed();
    switch (p.type) {
      case 'hello':
        this.hello = p;
        this.tune = p.tune ?? null;
        break;
      case 'tune':
        this.tune = p.tune;
        break;
      case 'pong':
        this.stats.onPong(p.t);
        break;
      case 'frame':
        if (this.stats.acceptFrame(p, this.hello?.rate ?? 30)) this.listener?.(p);
        break;
    }
  }
}
