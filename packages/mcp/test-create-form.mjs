// One-shot end-to-end test of the formstr MCP server. Spawns the server, does the
// MCP handshake, then runs a self-cleaning round-trip:
//   create_form  →  get_form (verify it published)  →  delete_form (clean up)
// so it leaves no test data behind. Run from the repo root:
//   FORMSTR_MCP_NCRYPTSEC_PASSPHRASE='<your passphrase>' node packages/mcp/test-create-form.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, "dist", "index.js");

const passphrase = process.env.FORMSTR_MCP_NCRYPTSEC_PASSPHRASE;
if (!passphrase) {
  console.error("Set FORMSTR_MCP_NCRYPTSEC_PASSPHRASE='<your passphrase>' first.");
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath, // absolute path to this node binary
  args: [serverEntry, "--allow-writes"],
  env: { ...process.env, FORMSTR_MCP_NCRYPTSEC_PASSPHRASE: passphrase },
  stderr: "inherit", // surface the server's "signed in as …" / errors
});

const client = new Client({ name: "create-form-test", version: "1.0.0" });

/** Call a tool, print its text, and return { text, data, isError }. */
async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  if (text) console.log(text);
  return { text, data: res.structuredContent, isError: Boolean(res.isError) };
}

let pass = true;
try {
  await client.connect(transport);
  console.log("\n✅ connected to the MCP server\n");

  const { tools } = await client.listTools();
  console.log(`tools exposed: ${tools.length}\n`);

  // 1) create
  console.log("→ create_form …");
  const created = await call("create_form", {
    name: "MCP round-trip test",
    fields: [{ label: "Your email", type: "text", required: true }],
  });
  const { formId, pubkey } = created.data ?? {};
  if (created.isError || !formId || !pubkey) throw new Error("create_form did not return formId/pubkey");
  console.log(`   created formId=${formId}\n`);

  // 2) verify it published (read-back from relays)
  console.log("→ get_form (verify) …");
  const got = await call("get_form", { pubkey, formId });
  const found = !got.isError && got.data?.form?.id === formId;
  console.log(`   round-trip read-back: ${found ? "FOUND ✅" : "NOT FOUND ❌"}\n`);
  pass = pass && found;

  // 3) clean up so the test leaves nothing behind
  console.log("→ delete_form (cleanup) …");
  const deleted = await call("delete_form", { formId, formPubkey: pubkey, confirm: true });
  console.log(`   cleanup: ${deleted.isError ? "FAILED ❌" : "done ✅"}\n`);
  pass = pass && !deleted.isError;

  console.log(pass ? "🎉 ROUND-TRIP PASSED" : "⚠️  ROUND-TRIP INCOMPLETE (see above)");
} catch (err) {
  pass = false;
  console.error("\n❌ test failed:", err?.message ?? err);
} finally {
  await client.close();
  process.exitCode = pass ? 0 : 1;
}
