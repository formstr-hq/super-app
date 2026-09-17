/**
 * A minimal JSON-RPC 2.0 peer over a newline-delimited byte duplex (our Nostr
 * transport). Bidirectional: we send requests/notifications to the agent AND
 * answer requests the agent sends us (e.g. session/request_permission).
 *
 * ACP frames JSON-RPC as one compact JSON object per line.
 */

export type RpcParams = Record<string, unknown>;
export type RequestHandler = (params: RpcParams) => Promise<unknown> | unknown;
export type NotificationHandler = (params: RpcParams) => void;

interface Duplexish {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

interface PeerHandlers {
  requests?: Record<string, RequestHandler>;
  notifications?: Record<string, NotificationHandler>;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class JsonRpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

export class JsonRpcPeer {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = "";
  private closed = false;

  constructor(
    private readonly duplex: Duplexish,
    private readonly handlers: PeerHandlers = {},
  ) {
    this.writer = duplex.writable.getWriter();
    void this.readLoop();
  }

  /** Send a request and resolve with its result (or reject on error). */
  request<T = unknown>(method: string, params: RpcParams = {}): Promise<T> {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    void this.send({ jsonrpc: "2.0", id, method, params });
    return promise as Promise<T>;
  }

  /** Fire-and-forget notification (no id, no response). */
  notify(method: string, params: RpcParams = {}): void {
    void this.send({ jsonrpc: "2.0", method, params });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error("peer closed"));
    this.pending.clear();
    try {
      await this.writer.close();
    } catch {
      /* already closing */
    }
  }

  private async send(msg: unknown): Promise<void> {
    if (this.closed) return;
    await this.writer.write(this.encoder.encode(JSON.stringify(msg) + "\n"));
  }

  private async readLoop(): Promise<void> {
    const reader = this.duplex.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.buffer += this.decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, nl).trim();
          this.buffer = this.buffer.slice(nl + 1);
          if (line) this.dispatch(line);
        }
      }
    } catch {
      /* stream error — treat as close */
    } finally {
      reader.releaseLock();
      void this.close();
    }
  }

  private dispatch(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // ignore malformed line
    }

    const hasId = "id" in msg && msg.id !== null && msg.id !== undefined;
    const isResponse = hasId && ("result" in msg || "error" in msg);

    if (isResponse) {
      const p = this.pending.get(msg.id as number);
      if (!p) return;
      this.pending.delete(msg.id as number);
      if ("error" in msg) {
        const err = msg.error as { code?: number; message?: string };
        p.reject(new JsonRpcError(err.code ?? -1, err.message ?? "rpc error"));
      } else {
        p.resolve(msg.result);
      }
      return;
    }

    if (typeof msg.method === "string" && hasId) {
      void this.handleRequest(msg.id as number, msg.method, (msg.params ?? {}) as RpcParams);
    } else if (typeof msg.method === "string") {
      this.handlers.notifications?.[msg.method]?.((msg.params ?? {}) as RpcParams);
    }
  }

  private async handleRequest(id: number, method: string, params: RpcParams): Promise<void> {
    const handler = this.handlers.requests?.[method];
    if (!handler) {
      void this.send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `no method ${method}` },
      });
      return;
    }
    try {
      const result = await handler(params);
      void this.send({ jsonrpc: "2.0", id, result: result ?? null });
    } catch (e) {
      void this.send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(e) } });
    }
  }
}
