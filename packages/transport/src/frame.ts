/**
 * Wire framing for the reliable-stream layer.
 *
 * Nostr gives us a signed, encrypted pub/sub bus but NOT ordering, delivery, or
 * de-duplication. These frames are what we run on top to recover a reliable,
 * ordered byte stream: a tiny header + a payload, one frame per Nostr event
 * (payload chunked to stay under relay size caps).
 *
 * Framing is byte-oriented on purpose — the transport ships opaque bytes and
 * lets the consumer (e.g. ACP's JSON-RPC line framing) impose its own message
 * boundaries.
 */

export enum FrameType {
  /** Session open request (initiator -> responder). */
  Syn = 0,
  /** Session accept (responder -> initiator). */
  SynAck = 1,
  /** Ordered data chunk. */
  Data = 2,
  /** Acknowledges the highest contiguous `seq` received. */
  Ack = 3,
  /** Keepalive; also carries a cumulative ack. */
  Ping = 4,
  Pong = 5,
  /** Graceful close. */
  Fin = 6,
}

export interface Frame {
  /** Session id — random per connection, so a peer can multiplex. */
  session: string;
  type: FrameType;
  /** Monotonic per-direction sequence number for Data frames. */
  seq: number;
  /** Cumulative ack: highest contiguous seq the sender has received. */
  ack: number;
  /** Opaque bytes for Data frames; empty otherwise. */
  payload: Uint8Array;
}

/** Wire format version — first header byte, so the format can evolve. */
export const FRAME_VERSION = 0x01;

/** version(1) + type(1) + session(16) + seq(4) + ack(4). See DESIGN.md §3. */
export const HEADER_LEN = 26;
const SESSION_BYTES = 16;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== SESSION_BYTES * 2) {
    throw new Error(`session id must be ${SESSION_BYTES * 2} hex chars, got ${hex.length}`);
  }
  const out = new Uint8Array(SESSION_BYTES);
  for (let i = 0; i < SESSION_BYTES; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Serialize a frame to its on-the-wire bytes (header + payload). */
export function encodeFrame(frame: Frame): Uint8Array {
  const out = new Uint8Array(HEADER_LEN + frame.payload.length);
  const view = new DataView(out.buffer);
  out[0] = FRAME_VERSION;
  out[1] = frame.type;
  out.set(hexToBytes(frame.session), 2);
  view.setUint32(18, frame.seq, false); // big-endian
  view.setUint32(22, frame.ack, false);
  out.set(frame.payload, HEADER_LEN);
  return out;
}

/** Parse on-the-wire bytes back into a frame. Throws on a malformed/short buffer. */
export function decodeFrame(bytes: Uint8Array): Frame {
  if (bytes.length < HEADER_LEN) {
    throw new Error(`frame too short: ${bytes.length} < ${HEADER_LEN}`);
  }
  if (bytes[0] !== FRAME_VERSION) {
    throw new Error(`unsupported frame version ${bytes[0]}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    type: bytes[1] as FrameType,
    session: bytesToHex(bytes.subarray(2, 18)),
    seq: view.getUint32(18, false),
    ack: view.getUint32(22, false),
    payload: bytes.slice(HEADER_LEN),
  };
}
