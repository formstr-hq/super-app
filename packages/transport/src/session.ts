import {
  COALESCE_MS,
  DELAYED_ACK_MS,
  HEARTBEAT_MS,
  MISSED_PONGS_DEAD,
  MTU,
  RETRANSMIT_ATTEMPTS,
  RTO_INITIAL_MS,
  RTO_MAX_MS,
  SEND_WINDOW,
} from "./constants";
import { FrameType, type Frame } from "./frame";
import type { NostrDuplex } from "./types";

/** Where a session's outbound frames go — `Wire.send` in prod, a mock in tests. */
export type FrameSink = (frame: Frame) => void;

export interface SessionOptions {
  /** Peer's hex pubkey. */
  peer: string;
  /** Initiator sends Syn; responder waits for one. */
  role: "initiator" | "responder";
  /** Shared 128-bit session id (hex). Initiator picks it; responder echoes it. */
  sessionId: string;
  /** Outbound frame sink. */
  send: FrameSink;
}

interface Unacked {
  frame: Frame;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const EMPTY = new Uint8Array(0);

/** 128-bit random session id as hex. */
export function newSessionId(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * The reliability state machine for ONE peer connection. Rebuilds a reliable,
 * ordered byte stream over Nostr's unreliable pub/sub, and exposes itself purely
 * as a {@link NostrDuplex}. See DESIGN.md §6 for the protocol.
 *
 * Frame-indexed (frames are the retransmit unit), TCP-ish: 2-way handshake,
 * cumulative ack, retransmit-on-timeout, out-of-order reassembly, a fixed send
 * window for flow control, heartbeat liveness, and Fin teardown.
 */
export class Session {
  readonly peer: string;
  readonly id: string;
  readonly duplex: NostrDuplex;

  private readonly role: "initiator" | "responder";
  private readonly sink: FrameSink;

  private established = false;
  private dead = false;

  // outbound
  private sendSeq = 1; // next Data seq; 0 is reserved for Syn/SynAck
  private readonly unacked = new Map<number, Unacked>();
  private peerAck = -1; // highest cumulative ack the peer has confirmed
  private windowWaiters: Array<() => void> = [];

  // outbound coalescing buffer (Nagle)
  private outChunks: Uint8Array[] = [];
  private outLen = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // inbound
  private recvNext = 1; // next in-order Data seq we expect
  private readonly recvBuffer = new Map<number, Uint8Array>();
  private ackTimer: ReturnType<typeof setTimeout> | null = null;

  // liveness
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedPongs = 0;

  // readable side
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private readableClosed = false;

  // lifecycle
  private establishedResolve!: () => void;
  private establishedReject!: (e: Error) => void;
  private readonly establishedPromise: Promise<void>;
  private closedResolve!: () => void;
  private readonly closedPromise: Promise<void>;

  constructor(opts: SessionOptions) {
    this.peer = opts.peer;
    this.id = opts.sessionId;
    this.role = opts.role;
    this.sink = opts.send;

    this.establishedPromise = new Promise((res, rej) => {
      this.establishedResolve = res;
      this.establishedReject = rej;
    });
    // A responder never awaits this promise; swallow a possible pre-handshake
    // rejection so it can't surface as an unhandled rejection.
    if (this.role === "responder") void this.establishedPromise.catch(() => {});
    this.closedPromise = new Promise((res) => {
      this.closedResolve = res;
    });

    const readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
      },
    });
    const writable = new WritableStream<Uint8Array>({
      write: (chunk) => this.writeChunk(chunk),
      close: () => this.finish(),
      abort: () => this.finish(),
    });
    this.duplex = {
      peer: this.peer,
      readable,
      writable,
      closed: this.closedPromise,
      close: () => this.close(),
    };
  }

  /** Initiator only: send Syn and resolve once the handshake completes. */
  start(): Promise<void> {
    if (this.role !== "initiator") throw new Error("only the initiator may start()");
    this.trackAndSend(this.frame(FrameType.Syn, 0, EMPTY));
    return this.establishedPromise;
  }

  /** Feed an inbound frame (from Wire.subscribe or a test harness). */
  deliver(frame: Frame): void {
    if (this.dead) return;
    this.clearAcked(frame.ack);
    switch (frame.type) {
      case FrameType.Syn:
        this.onSyn();
        break;
      case FrameType.SynAck:
        this.onSynAck();
        break;
      case FrameType.Data:
        this.onData(frame);
        break;
      case FrameType.Ack:
        break; // ack already applied above
      case FrameType.Ping:
        this.rawSend(this.frame(FrameType.Pong, 0, EMPTY));
        break;
      case FrameType.Pong:
        this.missedPongs = 0;
        break;
      case FrameType.Fin:
        this.onFin();
        break;
    }
  }

  async close(): Promise<void> {
    this.finish();
    await this.closedPromise;
  }

  // --- handshake ---------------------------------------------------------

  private onSyn(): void {
    if (!this.established) this.markEstablished();
    // (Re)send SynAck. Track it once so a lost SynAck is retransmitted until the
    // initiator's confirming Ack clears it.
    if (this.unacked.has(0)) this.rawSend(this.frame(FrameType.SynAck, 0, EMPTY));
    else this.trackAndSend(this.frame(FrameType.SynAck, 0, EMPTY));
  }

  private onSynAck(): void {
    if (!this.established) this.markEstablished();
    // Confirm so the responder stops retransmitting its SynAck.
    this.rawSend(this.frame(FrameType.Ack, 0, EMPTY));
  }

  private markEstablished(): void {
    this.established = true;
    this.establishedResolve();
    this.startHeartbeat();
  }

  // --- data --------------------------------------------------------------

  private onData(frame: Frame): void {
    const seq = frame.seq;
    if (seq === this.recvNext) {
      this.enqueue(frame.payload);
      this.recvNext++;
      while (this.recvBuffer.has(this.recvNext)) {
        this.enqueue(this.recvBuffer.get(this.recvNext)!);
        this.recvBuffer.delete(this.recvNext);
        this.recvNext++;
      }
    } else if (seq > this.recvNext && seq < this.recvNext + SEND_WINDOW) {
      this.recvBuffer.set(seq, frame.payload); // future frame, within window
    }
    // seq < recvNext: duplicate already delivered — fall through and ack.
    this.scheduleAck();
  }

  private enqueue(payload: Uint8Array): void {
    if (this.readableClosed || payload.length === 0) return;
    this.controller.enqueue(payload);
  }

  private scheduleAck(): void {
    if (this.ackTimer) return;
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      this.rawSend(this.frame(FrameType.Ack, 0, EMPTY));
    }, DELAYED_ACK_MS);
  }

  private async writeChunk(chunk: Uint8Array): Promise<void> {
    if (this.dead) throw new Error("session closed");
    await this.establishedPromise;
    if (chunk.length === 0) return;
    this.outChunks.push(chunk.slice()); // copy; held until flushed
    this.outLen += chunk.length;
    // Flush whole MTU-sized frames now (with flow control); buffer the remainder
    // for a short coalescing window so tiny writes ride in one frame.
    while (this.outLen >= MTU) {
      await this.waitForWindow();
      if (this.dead) throw new Error("session closed");
      this.flushOne(MTU);
    }
    if (this.outLen > 0) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.dead) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPending();
    }, COALESCE_MS);
  }

  /** Emit buffered bytes as Data frames (respecting the send window). */
  private flushPending(): void {
    if (this.dead) return;
    while (this.outLen > 0 && this.inFlight() < SEND_WINDOW) {
      this.flushOne(Math.min(this.outLen, MTU));
    }
    if (this.outLen > 0) this.scheduleFlush(); // window full — retry shortly
  }

  /** Pull up to `n` buffered bytes into a single Data frame and send it. */
  private flushOne(n: number): void {
    const payload = new Uint8Array(n);
    let filled = 0;
    while (filled < n && this.outChunks.length > 0) {
      const head = this.outChunks[0];
      const take = Math.min(head.length, n - filled);
      payload.set(head.subarray(0, take), filled);
      filled += take;
      if (take === head.length) this.outChunks.shift();
      else this.outChunks[0] = head.subarray(take);
    }
    this.outLen -= filled;
    this.trackAndSend(this.frame(FrameType.Data, this.sendSeq++, payload));
  }

  // --- outbound reliability ---------------------------------------------

  private frame(type: FrameType, seq: number, payload: Uint8Array): Frame {
    return { session: this.id, type, seq, ack: this.recvNext - 1, payload };
  }

  private rawSend(frame: Frame): void {
    if (!this.dead) this.sink(frame);
  }

  private trackAndSend(frame: Frame): void {
    const entry: Unacked = { frame, attempts: 0, timer: null };
    this.unacked.set(frame.seq, entry);
    this.rawSend(frame);
    this.arm(entry);
  }

  private arm(entry: Unacked): void {
    const rto = Math.min(RTO_INITIAL_MS * 2 ** entry.attempts, RTO_MAX_MS);
    entry.timer = setTimeout(() => {
      if (this.dead) return;
      if (entry.attempts >= RETRANSMIT_ATTEMPTS) {
        this.fail(new Error("peer unresponsive"));
        return;
      }
      entry.attempts++;
      this.rawSend(entry.frame);
      this.arm(entry);
    }, rto);
  }

  private clearAcked(ack: number): void {
    if (ack <= this.peerAck) return;
    this.peerAck = ack;
    for (const [seq, entry] of this.unacked) {
      if (seq <= ack) {
        if (entry.timer) clearTimeout(entry.timer);
        this.unacked.delete(seq);
      }
    }
    this.wakeWindow();
    if (this.outLen > 0) this.flushPending(); // freed window → send buffered bytes
  }

  private inFlight(): number {
    return this.sendSeq - 1 - Math.max(this.peerAck, 0);
  }

  private waitForWindow(): Promise<void> {
    if (this.inFlight() < SEND_WINDOW) return Promise.resolve();
    return new Promise((res) => this.windowWaiters.push(res));
  }

  private wakeWindow(): void {
    while (this.windowWaiters.length && this.inFlight() < SEND_WINDOW) {
      this.windowWaiters.shift()!();
    }
  }

  // --- liveness ----------------------------------------------------------

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.missedPongs >= MISSED_PONGS_DEAD) {
        this.fail(new Error("peer timed out"));
        return;
      }
      this.missedPongs++;
      this.rawSend(this.frame(FrameType.Ping, 0, EMPTY));
    }, HEARTBEAT_MS);
  }

  // --- teardown ----------------------------------------------------------

  private onFin(): void {
    this.teardown();
  }

  private finish(): void {
    if (this.dead) return;
    this.flushPending(); // best-effort flush of buffered bytes before closing
    this.rawSend(this.frame(FrameType.Fin, 0, EMPTY));
    this.teardown();
  }

  private fail(err: Error): void {
    if (this.dead) return;
    if (!this.established) this.establishedReject(err);
    if (!this.readableClosed) {
      this.readableClosed = true;
      try {
        this.controller.error(err);
      } catch {
        /* already errored/closed */
      }
    }
    this.teardown();
  }

  private teardown(): void {
    if (this.dead) return;
    this.dead = true;
    for (const e of this.unacked.values()) if (e.timer) clearTimeout(e.timer);
    this.unacked.clear();
    if (this.ackTimer) clearTimeout(this.ackTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.outChunks = [];
    this.outLen = 0;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (!this.readableClosed) {
      this.readableClosed = true;
      try {
        this.controller.close();
      } catch {
        /* already closed */
      }
    }
    const waiters = this.windowWaiters;
    this.windowWaiters = [];
    for (const w of waiters) w();
    this.closedResolve();
  }
}
