import type { VerifiedEvent } from "nostr-tools";

export interface BlossomUploadResult {
  sha256: string;
  url: string;
  size: number;
}

/**
 * Unified Blossom (BUD-02/03/04) client.
 * Extracted from Forms, Pages, and Drive — all three have overlapping implementations.
 */
export class BlossomClient {
  constructor(private serverUrl: string) {}

  /**
   * BUD-02: Upload file blob.
   * Authorization via kind 24242 event.
   */
  async upload(
    data: Uint8Array,
    authEvent: VerifiedEvent,
    contentType?: string,
  ): Promise<BlossomUploadResult> {
    const authHeader = `Nostr ${btoa(JSON.stringify(authEvent))}`;
    const sha256 = await sha256Hex(data);

    const response = await fetch(`${this.serverUrl}/upload`, {
      method: "PUT",
      headers: {
        Authorization: authHeader,
        "Content-Type": contentType ?? "application/octet-stream",
        // BUD-02: lets servers verify the blob and is required by some (e.g.
        // the standalone formstr-drive's default servers).
        "X-SHA-256": sha256,
      },
      body: data as unknown as BodyInit,
    });

    if (!response.ok) {
      throw new Error(`Blossom upload failed: ${response.status} ${response.statusText}`);
    }

    // Most servers return a JSON descriptor; some return just the hash as text.
    const text = await response.text();
    try {
      const json = JSON.parse(text) as Partial<BlossomUploadResult> & { x?: string };
      const hash = json.sha256 ?? json.x ?? sha256;
      return {
        sha256: hash,
        url: json.url ?? `${this.serverUrl}/${hash}`,
        size: json.size ?? data.byteLength,
      };
    } catch {
      const hash = text.trim() || sha256;
      return { sha256: hash, url: `${this.serverUrl}/${hash}`, size: data.byteLength };
    }
  }

  /**
   * BUD-03: Download file blob by SHA-256 hash.
   */
  async download(sha256: string, authEvent?: VerifiedEvent): Promise<Uint8Array> {
    const headers: Record<string, string> = {};
    if (authEvent) {
      headers["Authorization"] = `Nostr ${btoa(JSON.stringify(authEvent))}`;
    }

    const response = await fetch(`${this.serverUrl}/${sha256}`, { headers });

    if (!response.ok) {
      throw new Error(`Blossom download failed: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * BUD-04: Delete file blob by SHA-256 hash.
   */
  async delete(sha256: string, authEvent: VerifiedEvent): Promise<void> {
    const authHeader = `Nostr ${btoa(JSON.stringify(authEvent))}`;

    const response = await fetch(`${this.serverUrl}/${sha256}`, {
      method: "DELETE",
      headers: { Authorization: authHeader },
    });

    if (!response.ok) {
      throw new Error(`Blossom delete failed: ${response.status} ${response.statusText}`);
    }
  }

  getServerUrl(): string {
    return this.serverUrl;
  }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
