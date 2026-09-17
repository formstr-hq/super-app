/** Self-contained admin dashboard page (no build step, no external assets). */
export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>formstr home node</title>
<style>
  :root { color-scheme: dark; --bg:#0f1210; --card:#171b18; --line:#2a312c; --fg:#e6ece8; --dim:#8a958d; --accent:#4fb07a; --danger:#e8705c; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,sans-serif; background:var(--bg); color:var(--fg); }
  header { display:flex; align-items:center; gap:.6rem; padding:1rem 1.5rem; border-bottom:1px solid var(--line); }
  header .dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 8px var(--accent); }
  header h1 { font-size:15px; font-weight:600; margin:0; }
  header .npub { color:var(--dim); font-family:ui-monospace,monospace; font-size:12px; margin-left:auto; }
  main { display:grid; grid-template-columns:1fr 1fr; gap:1rem; padding:1.5rem; max-width:1100px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1rem 1.1rem; }
  .card.wide { grid-column:1 / -1; }
  .card h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); margin:0 0 .75rem; }
  .row { display:flex; align-items:center; gap:.6rem; padding:.45rem 0; border-top:1px solid var(--line); }
  .row:first-of-type { border-top:none; }
  .mono { font-family:ui-monospace,monospace; font-size:12px; }
  .pill { font-size:11px; padding:.1rem .5rem; border-radius:999px; border:1px solid var(--line); color:var(--dim); }
  .pill.on { color:var(--accent); border-color:var(--accent); }
  .pill.off { color:var(--danger); border-color:var(--danger); }
  .spacer { flex:1; }
  button { font:inherit; font-size:12px; cursor:pointer; border-radius:7px; border:1px solid var(--line); background:transparent; color:var(--fg); padding:.3rem .7rem; }
  button.danger { color:var(--danger); border-color:var(--danger); }
  button:hover { background:#ffffff10; }
  input { font:inherit; font-size:13px; background:#0c0f0d; border:1px solid var(--line); color:var(--fg); border-radius:7px; padding:.4rem .6rem; flex:1; }
  .empty { color:var(--dim); font-style:italic; padding:.5rem 0; }
  .addrow { display:flex; gap:.5rem; margin-top:.75rem; }
</style>
</head>
<body>
<header>
  <span class="dot"></span>
  <h1>formstr home node</h1>
  <span class="npub" id="npub">—</span>
</header>
<main>
  <section class="card">
    <h2>Exposed ACPs</h2>
    <div id="exposed"></div>
    <div class="addrow">
      <input id="modelInput" placeholder="model, e.g. ollama-cloud/glm-5.3-flash" />
      <button id="modelBtn">Set model</button>
    </div>
    <div class="empty" id="modelHint"></div>
  </section>
  <section class="card">
    <h2>Relays</h2>
    <div id="relays"></div>
  </section>
  <section class="card wide">
    <h2>Active sessions</h2>
    <div id="sessions"></div>
  </section>
  <section class="card wide">
    <h2>Allowed devices (npubs)</h2>
    <div id="whitelist"></div>
    <div class="addrow">
      <input id="npubInput" placeholder="npub1…" />
      <button id="addBtn">Allow</button>
    </div>
  </section>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const kb = (n) => n < 1024 ? n + " B" : (n/1024).toFixed(1) + " KB";
  const ago = (t) => { const s = Math.floor((Date.now()-t)/1000); return s<60?s+"s":Math.floor(s/60)+"m"; };

  function render(s) {
    $("npub").textContent = s.node.npub;
    $("exposed").innerHTML = s.node.exposed.map((e) =>
      '<div class="row"><span class="mono">' + e.name + '</span>' +
      (e.default ? '<span class="pill on">default</span>' : '') +
      '<span class="spacer"></span>' +
      '<span class="pill mono">' + [e.command].concat(e.args||[]).join(" ") + '</span></div>'
    ).join("") || '<div class="empty">none detected</div>';

    const mi = $("modelInput");
    if (document.activeElement !== mi) mi.value = s.node.model || "";
    $("modelHint").textContent = s.node.model
      ? "current: " + s.node.model + " (applies to new sessions)"
      : "using the harness default (set one if prompts hang)";

    $("relays").innerHTML = s.node.relays.map((r) => {
      const on = s.relayStatus[r];
      return '<div class="row"><span class="mono">' + r + '</span><span class="spacer"></span>' +
        '<span class="pill ' + (on?'on':'off') + '">' + (on?'connected':'offline') + '</span></div>';
    }).join("");

    $("sessions").innerHTML = s.sessions.length ? s.sessions.map((x) =>
      '<div class="row"><span class="mono">' + x.peerNpub.slice(0,16) + '…</span>' +
      '<span class="pill">' + (x.pid?('pid '+x.pid):'no pid') + '</span>' +
      '<span class="pill">' + ago(x.startedAt) + '</span>' +
      '<span class="pill">↓' + kb(x.bytesIn) + ' ↑' + kb(x.bytesOut) + '</span>' +
      '<span class="spacer"></span>' +
      (x.status==='active' ? '<button class="danger" onclick="killSession(\\''+x.id+'\\')">Kill</button>'
                           : '<span class="pill off">closed</span>') +
      '</div>'
    ).join("") : '<div class="empty">no active sessions</div>';

    $("whitelist").innerHTML = s.whitelist.map((n) =>
      '<div class="row"><span class="mono">' + n + '</span><span class="spacer"></span>' +
      '<button class="danger" onclick="removeNpub(\\''+n+'\\')">Remove</button></div>'
    ).join("") || '<div class="empty">none — nobody can connect</div>';
  }

  async function killSession(id) { await fetch('/api/sessions/kill', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})}); }
  async function removeNpub(npub) { await fetch('/api/whitelist', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({npub,action:'remove'})}); }
  $("modelBtn").onclick = async () => {
    await fetch('/api/model', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:$("modelInput").value.trim()})});
  };
  $("addBtn").onclick = async () => {
    const npub = $("npubInput").value.trim();
    if (!npub) return;
    const res = await fetch('/api/whitelist', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({npub,action:'add'})});
    if (res.ok) $("npubInput").value = ''; else alert('Invalid npub');
  };

  const es = new EventSource('/api/events');
  es.onmessage = (e) => render(JSON.parse(e.data));
</script>
</body>
</html>`;
