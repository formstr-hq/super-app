import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { nip19 } from "nostr-tools";

import { updateModel, updateWhitelist, type ResolvedConfig } from "../config.js";
import { resolveAdminHosts, toUrl } from "../net.js";
import type { HomeNodeState } from "../state.js";

import { DASHBOARD_HTML } from "./dashboard.js";

export interface AdminDeps {
  cfg: ResolvedConfig;
  state: HomeNodeState;
  myPubkey: string;
  /** Live relay connection status, e.g. from NostrRuntime.pool.listConnectionStatus(). */
  relayStatus: () => Record<string, boolean>;
}

function buildStatus(deps: AdminDeps) {
  const { cfg, state, myPubkey, relayStatus } = deps;
  return {
    node: {
      npub: nip19.npubEncode(myPubkey),
      relays: cfg.relays,
      privacy: cfg.privacy,
      harnessAuto: cfg.harnessAuto,
      model: cfg.model,
      // Auto-detected + configured ACPs; `default` is the one sessions route to.
      exposed: cfg.exposed.map((h) => ({
        name: h.name,
        command: h.command,
        args: h.args,
        default: h.command === cfg.harness.command,
      })),
    },
    relayStatus: relayStatus(),
    whitelist: cfg.raw.whitelist,
    sessions: state.snapshot().sessions,
  };
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

export interface AdminServer {
  /** Browser URLs the dashboard is reachable on (localhost + Yggdrasil, etc.). */
  urls: string[];
  /** The Yggdrasil address it bound to, if any. */
  ygg: string | null;
  close(): void;
}

/** Start the admin dashboard, binding localhost and/or the Yggdrasil address. */
export function startAdminServer(deps: AdminDeps): AdminServer {
  const { cfg, state } = deps;
  const { hosts, ygg } = resolveAdminHosts(cfg.admin.host);

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";

    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
      return;
    }

    if (req.method === "GET" && url === "/api/status") {
      json(res, 200, buildStatus(deps));
      return;
    }

    if (req.method === "GET" && url === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = () => res.write(`data: ${JSON.stringify(buildStatus(deps))}\n\n`);
      send();
      const onChange = () => send();
      state.on("change", onChange);
      const ping = setInterval(send, 5000); // also refresh relay status
      req.on("close", () => {
        state.off("change", onChange);
        clearInterval(ping);
      });
      return;
    }

    if (req.method === "POST" && url === "/api/sessions/kill") {
      void readBody(req).then((body) => {
        const ok = state.kill(String(body.id ?? ""));
        json(res, ok ? 200 : 404, { ok });
      });
      return;
    }

    if (req.method === "POST" && url === "/api/model") {
      void readBody(req).then((body) => {
        updateModel(cfg, String(body.model ?? ""));
        state.emit("change");
        json(res, 200, { ok: true, model: cfg.model });
      });
      return;
    }

    if (req.method === "POST" && url === "/api/whitelist") {
      void readBody(req).then((body) => {
        const npub = String(body.npub ?? "");
        const action = body.action === "remove" ? "remove" : "add";
        try {
          updateWhitelist(cfg, npub, action);
          state.emit("change");
          json(res, 200, { ok: true });
        } catch (e) {
          json(res, 400, { ok: false, error: (e as Error).message });
        }
      });
      return;
    }

    json(res, 404, { error: "not found" });
  };

  // A net.Server binds a single address, so run one server per host, all sharing
  // the same handler (localhost + the Yggdrasil address, etc.).
  const servers = hosts.map((host) => {
    const s = createServer(handler);
    s.on("error", (e) =>
      console.error(`admin bind ${host}:${cfg.admin.port} failed: ${e.message}`),
    );
    s.listen(cfg.admin.port, host);
    return s;
  });

  return {
    urls: hosts.map((h) => toUrl(h, cfg.admin.port)),
    ygg,
    close: () => servers.forEach((s) => s.close()),
  };
}
