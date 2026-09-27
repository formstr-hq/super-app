import { EventEmitter } from "node:events";

/** Serializable view of one live session (what the dashboard sees). */
export interface SessionInfo {
  id: string;
  peerHex: string;
  peerNpub: string;
  pid: number | null;
  startedAt: number;
  bytesIn: number; // edge -> harness
  bytesOut: number; // harness -> edge
  status: "active" | "closed";
}

/** Non-serializable per-session handles (kept out of the JSON snapshot). */
interface SessionHandle {
  info: SessionInfo;
  kill: () => void;
}

export interface Snapshot {
  sessions: SessionInfo[];
  updatedAt: number;
}

/**
 * Live state of the home node, observable by the admin dashboard. Emits
 * "change" whenever anything the dashboard renders is updated.
 */
export class HomeNodeState extends EventEmitter {
  private readonly handles = new Map<string, SessionHandle>();

  register(info: SessionInfo, kill: () => void): void {
    this.handles.set(info.id, { info, kill });
    this.emit("change");
  }

  countIn(id: string, n: number): void {
    const h = this.handles.get(id);
    if (h) {
      h.info.bytesIn += n;
      this.emit("change");
    }
  }

  countOut(id: string, n: number): void {
    const h = this.handles.get(id);
    if (h) {
      h.info.bytesOut += n;
      this.emit("change");
    }
  }

  setPid(id: string, pid: number | null): void {
    const h = this.handles.get(id);
    if (h) {
      h.info.pid = pid;
      this.emit("change");
    }
  }

  close(id: string): void {
    const h = this.handles.get(id);
    if (!h) return;
    h.info.status = "closed";
    this.emit("change");
    // Drop closed sessions shortly after so the dashboard can show the flash.
    setTimeout(() => {
      this.handles.delete(id);
      this.emit("change");
    }, 3000).unref?.();
  }

  /** Ask a session to terminate (kills the harness + tears down the tunnel). */
  kill(id: string): boolean {
    const h = this.handles.get(id);
    if (!h) return false;
    h.kill();
    return true;
  }

  snapshot(): Snapshot {
    return {
      sessions: [...this.handles.values()].map((h) => ({ ...h.info })),
      updatedAt: Date.now(),
    };
  }
}
