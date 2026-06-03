import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { generateSecretKey, getPublicKey } from "nostr-tools";
import { decode, nsecEncode } from "nostr-tools/nip19";
import QRCode from "qrcode";

import { type Credential } from "./credential";
import { openBrowser } from "./openBrowser";
import { loginPageHtml } from "./page";

/** A NIP-46 handshake the server drives: returns a URI to display + a promise that
 *  resolves with a credential once the remote signer connects. Injected by `login.ts`
 *  so this module stays free of relay/pool concerns and is easy to test. */
export interface Nip46Handshake {
  start(): Promise<{ uri: string; connected: Promise<Credential> }>;
}

export interface LoginServerDeps {
  nip46?: Nip46Handshake;
  /** Override the browser opener (tests pass a no-op). */
  open?: (url: string) => void;
  /** Override QR generation (tests skip it). */
  makeQr?: (text: string) => Promise<string | null>;
  /** Called with the local URL once listening (tests grab the port here). */
  onListening?: (url: string) => void;
}

/**
 * Run the one-shot localhost login server. Resolves with the chosen `Credential` once the
 * user signs in (nsec / guest / NIP-46), then shuts down. The session token guards every
 * mutating request so another local process can't drive the flow.
 */
export function runLoginServer(deps: LoginServerDeps = {}): Promise<Credential> {
  const token = randomBytes(16).toString("hex");
  const openFn = deps.open ?? openBrowser;
  const makeQr =
    deps.makeQr ??
    (async (t: string) => {
      try {
        return await QRCode.toDataURL(t);
      } catch {
        return null;
      }
    });

  return new Promise<Credential>((resolve, reject) => {
    let nip46Status: { connected: boolean; pubkey?: string; error?: string } = { connected: false };
    let settled = false;

    const finish = (cred: Credential): void => {
      if (settled) return;
      settled = true;
      setTimeout(() => server.close(), 100); // let the HTTP response flush first
      resolve(cred);
    };

    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(loginPageHtml({ token }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/submit") {
        const body = await readJson(req);
        if (body.token !== token) return json(res, 403, { error: "Invalid session token." });
        if (body.method !== "guest" && body.method !== "nsec") {
          return json(res, 400, { error: "Unknown sign-in method." });
        }
        let cred: Credential;
        try {
          cred = body.method === "guest" ? guestCredential() : nsecCredential(body.nsec);
        } catch (e) {
          return json(res, 400, { error: e instanceof Error ? e.message : "Invalid input." });
        }
        json(res, 200, { pubkey: cred.pubkey });
        finish(cred);
        return;
      }

      if (req.method === "POST" && url.pathname === "/nip46/start") {
        const body = await readJson(req);
        if (body.token !== token) return json(res, 403, { error: "Invalid session token." });
        if (!deps.nip46) return json(res, 400, { error: "Remote signing not available." });
        const { uri, connected } = await deps.nip46.start();
        connected
          .then((cred) => {
            nip46Status = { connected: true, pubkey: cred.pubkey };
            finish(cred);
          })
          .catch((e: unknown) => {
            nip46Status = {
              connected: false,
              error: e instanceof Error ? e.message : "Connection failed.",
            };
          });
        return json(res, 200, { uri, qr: await makeQr(uri) });
      }

      if (req.method === "GET" && url.pathname === "/nip46/status") {
        return json(res, 200, nip46Status);
      }

      json(res, 404, { error: "Not found." });
    }

    const server = createServer((req, res) => {
      handle(req, res).catch((e) =>
        json(res, 500, { error: e instanceof Error ? e.message : "Server error." }),
      );
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const localUrl = `http://127.0.0.1:${port}/`;
      if (deps.onListening) {
        deps.onListening(localUrl);
      } else {
        console.error(`formstr-mcp: opening ${localUrl} to sign in (open it manually if needed)`);
        openFn(localUrl);
      }
    });
  });
}

function nsecCredential(nsec: unknown): Credential {
  if (typeof nsec !== "string") throw new Error("Missing nsec.");
  const decoded = decode(nsec.trim());
  if (decoded.type !== "nsec") throw new Error("Invalid nsec.");
  return { method: "local", pubkey: getPublicKey(decoded.data), nsec: nsec.trim() };
}

function guestCredential(): Credential {
  const sk = generateSecretKey();
  return { method: "local", pubkey: getPublicKey(sk), nsec: nsecEncode(sk) };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function json(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}
