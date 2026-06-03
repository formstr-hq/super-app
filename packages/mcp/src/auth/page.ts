/**
 * The login page, inlined as a string so the single-file CJS bundle needs no asset
 * copying. Served by `loginServer` on localhost. It mirrors the super-app's sign-in
 * options: paste an nsec, create a guest identity, or connect a remote signer (NIP-46).
 */
export function loginPageHtml(opts: { token: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign in · Formstr MCP</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0d1117; color: #e6edf3; padding: 24px; }
  .wrap { width: 100%; max-width: 460px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { margin: 0 0 24px; color: #9da7b3; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px;
    padding: 18px; margin-bottom: 14px; }
  .card h2 { font-size: 14px; margin: 0 0 10px; text-transform: uppercase;
    letter-spacing: .04em; color: #9da7b3; }
  input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #30363d;
    background: #0d1117; color: #e6edf3; font-family: ui-monospace, monospace; }
  button { width: 100%; margin-top: 10px; padding: 10px 12px; border: 0; border-radius: 8px;
    background: #238636; color: #fff; font-weight: 600; cursor: pointer; }
  button.secondary { background: #21262d; border: 1px solid #30363d; color: #e6edf3; }
  button:disabled { opacity: .5; cursor: default; }
  .uri { word-break: break-all; font-family: ui-monospace, monospace; font-size: 12px;
    background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 10px; margin-top: 10px; }
  #qr { display: block; margin: 12px auto 0; border-radius: 8px; max-width: 220px; }
  .status { margin-top: 16px; padding: 12px; border-radius: 8px; text-align: center; display: none; }
  .status.ok { display: block; background: #122117; border: 1px solid #238636; }
  .status.err { display: block; background: #2d1517; border: 1px solid #da3633; color: #ffb3b3; }
  .hint { color: #9da7b3; font-size: 13px; margin: 0 0 10px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Sign in to Formstr</h1>
  <p class="sub">Your key is stored in your OS keychain and never shown to the AI agent.</p>

  <div class="card">
    <h2>Paste your nsec</h2>
    <input id="nsec" type="password" placeholder="nsec1…" autocomplete="off" spellcheck="false" />
    <button id="nsecBtn">Sign in with nsec</button>
  </div>

  <div class="card">
    <h2>New identity</h2>
    <p class="hint">Generate a fresh Nostr key (stored locally in your keychain).</p>
    <button id="guestBtn" class="secondary">Create a guest identity</button>
  </div>

  <div class="card">
    <h2>Connect a signer (NIP-46)</h2>
    <p class="hint">Keep your key in your extension or bunker app (Amber, nsec.app, nsecbunker). The MCP only holds a session token.</p>
    <button id="connectBtn" class="secondary">Connect remote signer</button>
    <div id="nip46Box" style="display:none">
      <div class="uri" id="uri"></div>
      <img id="qr" alt="Scan to connect" />
    </div>
  </div>

  <div class="status" id="status"></div>
</div>

<script>
  const TOKEN = ${JSON.stringify(opts.token)};
  const $ = (id) => document.getElementById(id);
  const status = $("status");
  function ok(msg) { status.className = "status ok"; status.textContent = msg; }
  function err(msg) { status.className = "status err"; status.textContent = msg; }
  function lock() { for (const b of document.querySelectorAll("button")) b.disabled = true; }

  async function submit(body) {
    const res = await fetch("/submit", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { err(data.error || "Sign-in failed."); return; }
    lock(); ok("Signed in as " + (data.pubkey || "") + ". You can close this tab.");
  }

  $("nsecBtn").onclick = () => {
    const nsec = $("nsec").value.trim();
    if (!nsec) return err("Enter your nsec.");
    submit({ method: "nsec", nsec });
  };
  $("guestBtn").onclick = () => submit({ method: "guest" });

  $("connectBtn").onclick = async () => {
    $("connectBtn").disabled = true;
    const res = await fetch("/nip46/start", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { $("connectBtn").disabled = false; return err(data.error || "Could not start."); }
    $("nip46Box").style.display = "block";
    $("uri").textContent = data.uri;
    if (data.qr) $("qr").src = data.qr; else $("qr").style.display = "none";
    ok("Waiting for your signer to approve the connection…");
    poll();
  };

  async function poll() {
    try {
      const res = await fetch("/nip46/status");
      const data = await res.json();
      if (data.connected) { lock(); ok("Connected as " + (data.pubkey || "") + ". You can close this tab."); return; }
      if (data.error) { err(data.error); return; }
    } catch (_) {}
    setTimeout(poll, 1500);
  }
</script>
</body>
</html>`;
}
