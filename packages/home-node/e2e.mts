// Full end-to-end over the real tunnel, run N times. Reproduces the browser's
// exact path (transport identity -> connect -> ACP init/session/prompt).
import { LocalSigner, NostrRuntime } from "@formstr/core";
import { connect } from "@formstr/nostr-transport";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { useWebSocketImplementation } from "nostr-tools/pool";
import WebSocket from "ws";

useWebSocketImplementation(WebSocket);
const homeHex = nip19.decode(process.argv[2]).data as string;
const N = Number(process.argv[3] ?? 3);
const relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];

async function once(n: number) {
  const sk = generateSecretKey();
  const myNpub = nip19.npubEncode(getPublicKey(sk));
  await fetch("http://127.0.0.1:4577/api/whitelist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ npub: myNpub, action: "add" }) });
  const runtime = new NostrRuntime();
  (runtime.pool as any)._WebSocket = WebSocket;
  const duplex = await connect({ runtime, signer: new LocalSigner(sk), relays }, { to: homeHex });
  const enc = new TextEncoder(); const dec = new TextDecoder();
  const writer = duplex.writable.getWriter();
  let id = 0; const pending = new Map<number, (m: any) => void>();
  const send = (m: unknown) => writer.write(enc.encode(JSON.stringify(m) + "\n"));
  const req = (method: string, params: unknown) => { const i = ++id; void send({ jsonrpc: "2.0", id: i, method, params }); return new Promise<any>((r) => pending.set(i, r)); };
  let answer = "";
  void (async () => { const rd = duplex.readable.getReader(); let buf = "";
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let nl: number; while ((nl = buf.indexOf("\n")) !== -1) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue;
        const m = JSON.parse(line);
        if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
        else if (m.method === "session/update" && m.params.update.sessionUpdate === "agent_message_chunk") answer += m.params.update.content?.text ?? "";
        else if (m.method && m.id) void send({ jsonrpc: "2.0", id: m.id, result: null });
      } }
  })();
  await req("initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  const sn = await req("session/new", { cwd: ".", mcpServers: [] });
  const t0 = Date.now();
  const pr = await req("session/prompt", { sessionId: sn.result.sessionId, prompt: [{ type: "text", text: "reply with exactly two words: hello there" }] });
  const ms = Date.now() - t0;
  await duplex.close();
  if (pr.error) console.log(`#${n}: ❌ ${ms}ms  error=${JSON.stringify(pr.error.message)}`);
  else console.log(`#${n}: ✅ ${ms}ms  stop=${pr.result.stopReason}  answer=${JSON.stringify(answer.trim())}`);
}

for (let i = 1; i <= N; i++) {
  try { await once(i); } catch (e) { console.log(`#${i}: 💥 ${(e as Error).message}`); }
}
process.exit(0);
