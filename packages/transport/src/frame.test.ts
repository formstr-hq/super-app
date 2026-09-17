import { describe, expect, it } from "vitest";

import { decodeFrame, encodeFrame, FrameType, HEADER_LEN, type Frame } from "./frame";

const SID = "00112233445566778899aabbccddeeff";

function frame(over: Partial<Frame> = {}): Frame {
  return { session: SID, type: FrameType.Data, seq: 1, ack: 0, payload: new Uint8Array(), ...over };
}

describe("frame codec", () => {
  it("round-trips header fields", () => {
    const f = frame({ type: FrameType.Data, seq: 0x01020304, ack: 0x0a0b0c0d });
    const out = decodeFrame(encodeFrame(f));
    expect(out.session).toBe(SID);
    expect(out.type).toBe(FrameType.Data);
    expect(out.seq).toBe(0x01020304);
    expect(out.ack).toBe(0x0a0b0c0d);
  });

  it("round-trips the payload", () => {
    const payload = new Uint8Array([9, 8, 7, 255, 0, 128]);
    const out = decodeFrame(encodeFrame(frame({ payload })));
    expect(Array.from(out.payload)).toEqual(Array.from(payload));
  });

  it("handles empty payloads (control frames)", () => {
    const out = decodeFrame(encodeFrame(frame({ type: FrameType.Ack })));
    expect(out.payload.length).toBe(0);
    expect(out.type).toBe(FrameType.Ack);
  });

  it("encodes to header length + payload length", () => {
    expect(encodeFrame(frame({ payload: new Uint8Array(100) })).length).toBe(HEADER_LEN + 100);
  });

  it("rejects a truncated buffer", () => {
    expect(() => decodeFrame(new Uint8Array(10))).toThrow(/too short/);
  });

  it("rejects an unknown version byte", () => {
    const bytes = encodeFrame(frame());
    bytes[0] = 0x99;
    expect(() => decodeFrame(bytes)).toThrow(/version/);
  });

  it("survives a payload larger than the MTU boundary", () => {
    const payload = new Uint8Array(32 * 1024).map((_, i) => i % 256);
    const out = decodeFrame(encodeFrame(frame({ payload })));
    expect(out.payload).toEqual(payload);
  });
});
