import { CONFIG } from '../config';
import type { DevicePacket, FramePacket } from '../sensors/protocol';

/**
 * Packet bookkeeping shared by the Wi-Fi and USB links:
 *  - rejects duplicate / out-of-order frames, but recognises a device reboot
 *    (sequence restarts far below the last value)
 *  - counts dropped and malformed packets
 *  - measures arrival jitter and heartbeat round-trip time
 */
export class LinkStats {
  lastFrameAt = 0;
  lastPongAt = 0;
  dropped = 0;
  malformed = 0;
  outOfOrder = 0;
  reboots = 0;
  rttMs = NaN;
  jitterMs = 0;

  private lastSeq: number | null = null;
  private seqStep: number | null = null;
  private lastArrival = 0;

  reset() {
    this.lastSeq = null;
    this.seqStep = null;
    this.lastArrival = 0;
  }

  /** Frames arriving recently — an open but silent link doesn't count. */
  fresh(now = performance.now()) {
    return now - this.lastFrameAt < CONFIG.device.staleMs;
  }

  /** Heartbeat expired AND no frames: the link is dead even if the socket says open. */
  dead(now = performance.now()) {
    const since = Math.max(this.lastPongAt, this.lastFrameAt);
    return since > 0 && now - since > CONFIG.device.heartbeatTimeoutMs;
  }

  onMalformed() {
    this.malformed++;
  }

  onPong(sentAt: number) {
    const now = performance.now();
    this.lastPongAt = now;
    const rtt = now - sentAt;
    if (rtt >= 0 && rtt < 10000) this.rttMs = Number.isNaN(this.rttMs) ? rtt : this.rttMs + (rtt - this.rttMs) * 0.2;
  }

  /** Returns false if the frame should be discarded. */
  acceptFrame(p: FramePacket, expectedRate: number): boolean {
    const now = performance.now();
    if (this.lastSeq !== null) {
      const gap = p.seq - this.lastSeq;
      if (gap <= 0) {
        if (this.lastSeq - p.seq > 1000 || p.seq < 5) {
          this.reboots++; // counter restarted: the board rebooted
          this.seqStep = null;
        } else {
          this.outOfOrder++;
          return false;
        }
      } else {
        // A link may carry every Nth device frame (USB): learn the normal step.
        this.seqStep = Math.min(this.seqStep ?? gap, gap);
        if (gap > this.seqStep) this.dropped += Math.round(gap / this.seqStep) - 1;
      }
    }
    this.lastSeq = p.seq;
    if (this.lastArrival) {
      const expected = 1000 / expectedRate;
      this.jitterMs += (Math.abs(now - this.lastArrival - expected) - this.jitterMs) * 0.05;
    }
    this.lastArrival = now;
    this.lastFrameAt = now;
    return true;
  }
}

/** Heartbeat message; the firmware answers {"type":"pong","t":…} with the same t. */
export const pingMessage = () => ({ type: 'cmd', cmd: 'ping', t: Math.round(performance.now()) });

export type { DevicePacket };
