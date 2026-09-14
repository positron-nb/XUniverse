import { CONFIG } from '../config';
import { parsePacket, type DeviceTune, type FramePacket, type HelloPacket } from '../sensors/protocol';
import { LinkStats, pingMessage } from './LinkStats';

export type LinkStatus = 'idle' | 'connecting' | 'open' | 'closed';

const STORAGE_KEY = 'positron.ws';
const CONNECT_TIMEOUT_MS = 3000;

function load(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function save(host: string) {
  try {
    localStorage.setItem(STORAGE_KEY, host);
  } catch {
    /* storage blocked — not important */
  }
}

/**
 * Connection to the ESP32 WebSocket server.
 *  - Tries ?ws=host:port, the last address that worked, positron.local (mDNS)
 *    and 192.168.4.1 (the board's own access point), rotating with back-off.
 *  - Heartbeat every 2 s ({"cmd":"ping"} → {"type":"pong"}) measures round-trip
 *    time and detects a dead link that the socket still reports as open.
 *  - Malformed, duplicate and out-of-order packets are discarded and counted.
 * Never throws into the render loop.
 */
export class WebSocketSource {
  readonly name = 'Wi-Fi';
  status: LinkStatus = 'idle';
  hello: HelloPacket | null = null;
  tune: DeviceTune | null = null;
  readonly stats = new LinkStats();

  private ws: WebSocket | null = null;
  private listener: ((p: FramePacket) => void) | null = null;
  private retryMs: number = CONFIG.device.reconnectMinMs;
  private retryTimer: number | null = null;
  private connectTimer: number | null = null;
  private heartbeat: number | null = null;
  private wanted = false;
  private candidates: string[];
  private index = 0;

  constructor() {
    const fromUrl = new URLSearchParams(location.search).get('ws');
    const list = [fromUrl, load(), ...CONFIG.device.hosts].filter((h): h is string => !!h);
    this.candidates = [...new Set(list)];
  }

  get url() {
    return `ws://${this.candidates[this.index]}`;
  }

  start(listener: (p: FramePacket) => void) {
    this.listener = listener;
    if (this.wanted) return;
    this.wanted = true;
    this.retryMs = CONFIG.device.reconnectMinMs;
    this.connect();
  }

  stop() {
    this.wanted = false;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.status = 'idle';
  }

  /** Receiving frames recently — a connected but silent socket doesn't count. */
  get alive() {
    return this.status === 'open' && this.stats.fresh();
  }

  send(obj: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private clearTimers() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.retryTimer = this.connectTimer = this.heartbeat = null;
  }

  private connect() {
    if (!this.wanted) return;
    this.status = 'connecting';
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.fail();
      return;
    }
    this.ws = ws;
    // An unreachable address can take ~20 s to fail on its own.
    this.connectTimer = window.setTimeout(() => ws.readyState !== WebSocket.OPEN && ws.close(), CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.connectTimer !== null) clearTimeout(this.connectTimer);
      this.status = 'open';
      this.retryMs = CONFIG.device.reconnectMinMs;
      this.stats.reset();
      this.stats.lastPongAt = performance.now();
      save(this.candidates[this.index]);
      this.heartbeat = window.setInterval(() => {
        if (this.stats.dead()) ws.close(); // half-open socket: force a reconnect
        else this.send(pingMessage());
      }, CONFIG.device.heartbeatMs);
    };
    ws.onmessage = (msg) => {
      if (typeof msg.data !== 'string') return;
      const packet = parsePacket(msg.data);
      if (!packet) return this.stats.onMalformed();
      switch (packet.type) {
        case 'hello':
          this.hello = packet;
          this.tune = packet.tune ?? null;
          break;
        case 'tune':
          this.tune = packet.tune;
          break;
        case 'pong':
          this.stats.onPong(packet.t);
          break;
        case 'frame':
          if (this.stats.acceptFrame(packet, this.hello?.rate ?? 30)) this.listener?.(packet);
          break;
      }
    };
    ws.onclose = () => {
      const wasOpen = this.status === 'open';
      if (this.heartbeat !== null) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.ws = null;
      if (!this.wanted) return;
      this.status = 'closed';
      if (wasOpen) this.scheduleRetry(); // same address first: the board probably rebooted
      else this.fail();
    };
    ws.onerror = () => ws.close();
  }

  /** This address didn't answer — move to the next candidate. */
  private fail() {
    this.index = (this.index + 1) % this.candidates.length;
    // Back off only after a full pass over every candidate.
    if (this.index === 0) this.retryMs = Math.min(this.retryMs * 1.6, CONFIG.device.reconnectMaxMs);
    this.scheduleRetry(this.index === 0 ? this.retryMs : 150);
  }

  private scheduleRetry(ms = this.retryMs) {
    if (!this.wanted) return;
    this.retryTimer = window.setTimeout(() => this.connect(), ms);
  }
}
