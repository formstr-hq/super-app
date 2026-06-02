# Formstr MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@formstr/mcp`, a standalone stdio MCP server that exposes the Formstr super-app's forms/calendar/pages/drive/polls capabilities to any MCP host (Claude Code/Desktop, Cursor, Odysseus).

**Architecture:** A thin Node adapter. It boots the existing `@formstr/core` singletons (a `LocalSigner` from an nsec, relay defaults, a Node WebSocket impl, a `localStorage` shim), imports the browser-free service layer from `@formstr/app/services` (Approach B — subpath export, bundled with tsup so tree-shaking drops React), and maps each MCP tool call to a service call. Reads + constructive creates are always on; destructive/outward tools are registered only with `--allow-writes` and additionally require a per-call `confirm: true`.

**Tech Stack:** TypeScript (ESM), `@modelcontextprotocol/sdk@^1.29.0`, `zod@^3`, `ws`, `tsup@^8`, `vitest` (already in the repo), `pnpm` workspaces, Node ≥20.

**Spec:** `docs/superpowers/specs/2026-06-03-formstr-mcp-server-design.md`

---

## Reference: the v1 tool set (grounded in services that actually exist)

| Tier   | Tool                    | Service call                                                 |
| ------ | ----------------------- | ------------------------------------------------------------ |
| Read   | `list_forms`            | `fetchMyForms()`                                             |
| Read   | `get_form`              | `fetchForm(pubkey, formId, viewKey?)`                        |
| Read   | `fetch_form_responses`  | `fetchResponses(formPubkey, formId, signingKey?)`            |
| Read   | `list_pages`            | `fetchMyPages()`                                             |
| Read   | `list_polls`            | `fetchMyPolls()`                                             |
| Read   | `get_poll`              | `fetchPoll(eventId)`                                         |
| Read   | `fetch_poll_results`    | `fetchPollResults(pollId)`                                   |
| Read   | `browse_files`          | `fetchFileIndex()` + `extractFolders()`                      |
| Read   | `list_calendar_events`  | `fetchCalendarEventsSync(params)`                            |
| Create | `create_form`           | `createForm(params)` (+ persist, see Task 8)                 |
| Create | `create_page`           | `savePage(params)`                                           |
| Create | `save_private_note`     | `savePage(params)`                                           |
| Create | `create_poll`           | `createPoll(draft)`                                          |
| Create | `create_calendar_event` | `publishPublicCalendarEvent` / `publishPrivateCalendarEvent` |
| Gated  | `delete_form`           | `deleteForm(formId, formPubkey)`                             |
| Gated  | `delete_calendar_event` | `deleteCalendarEvent(eventId, coordinate?)`                  |
| Gated  | `submit_form_response`  | `submitResponse(formPubkey, formId, responses, encrypt)`     |
| Gated  | `submit_poll_response`  | `submitPollResponse(...)`                                    |
| Gated  | `rsvp_event`            | `rsvpToEvent(coordinate, status, isPrivate)`                 |

**Deferred in v1 (no service support yet — do NOT implement; list in README):**
`update_form`, `update_event`, `delete_event` alias, `share_form`, `share_page`,
`import_form_from_naddr`, `attach_form_to_event`. These need store-level orchestration
(gift-wrap key distribution, calendar update) that the service layer does not expose.

---

## File structure

```
packages/mcp/
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  README.md
  src/
    index.ts              # entry: parse config → bootstrap → start server
    config.ts             # zod-validated config from flags/env/file
    bootstrap.ts          # localStorage shim, ws impl, signer login, relay override
    safety.ts             # tier classification + confirm-gating helper
    result.ts             # ActionResult → MCP CallToolResult formatting
    server.ts             # build McpServer, register tool modules per allow-writes
    tools/
      shared.ts           # arg transforms (npub/hex, AI fields → FormField)
      forms.ts
      calendar.ts
      pages.ts
      drive.ts
      polls.ts
  test/
    config.test.ts
    safety.test.ts
    shared.test.ts
    forms.test.ts
    smoke.test.ts

packages/app/
  src/services/index.ts   # NEW barrel re-exporting all five service modules
  package.json            # ADD "./services" export entry
  src/services/pages/service.ts  # MODIFY generateShareLink to guard `window`
```

---

## Task 1: Scaffold the `@formstr/mcp` package

**Files:**

- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/tsup.config.ts`
- Create: `packages/mcp/vitest.config.ts`
- Create: `packages/mcp/src/index.ts` (temporary smoke entry)

- [ ] **Step 1: Create `packages/mcp/package.json`**

```json
{
  "name": "@formstr/mcp",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "bin": { "formstr-mcp": "./dist/index.js" },
  "main": "./dist/index.js",
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@formstr/app": "workspace:*",
    "@formstr/core": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "nostr-tools": "^2.16.0",
    "ws": "^8.18.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/ws": "^8.5.0",
    "tsup": "^8.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create `packages/mcp/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `packages/mcp/tsup.config.ts`**

The `banner` adds the shebang; `noExternal` forces the workspace packages + their pure-TS deps to be bundled (so the published binary is self-contained and React never enters the graph because the services don't import it).

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  noExternal: ["@formstr/app", "@formstr/core"],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  sourcemap: true,
});
```

- [ ] **Step 4: Create `packages/mcp/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create a temporary `packages/mcp/src/index.ts`**

```ts
console.error("formstr-mcp: scaffold ok");
```

- [ ] **Step 6: Install and verify the workspace picks up the package**

Run: `pnpm install`
Expected: completes; `@formstr/mcp` resolves `@formstr/app`/`@formstr/core` via `workspace:*`.

Run: `pnpm --filter @formstr/mcp dev`
Expected: prints `formstr-mcp: scaffold ok` to stderr.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp pnpm-lock.yaml
git commit -m "feat(mcp): scaffold @formstr/mcp package"
```

---

## Task 2: Expose `@formstr/app/services` as a subpath (Approach B) + guard the lone browser global

**Files:**

- Create: `packages/app/src/services/index.ts`
- Modify: `packages/app/package.json` (add `exports` map)
- Modify: `packages/app/src/services/pages/service.ts:168-176` (`generateShareLink`)

- [ ] **Step 1: Create the services barrel `packages/app/src/services/index.ts`**

```ts
export * as forms from "./forms/service";
export * as calendar from "./calendar/service";
export * as calendarRsvp from "./calendar/rsvp";
export * as pages from "./pages/service";
export * as drive from "./drive/service";
export * as polls from "./polls/service";

export * from "./forms/types";
export * from "./calendar/types";
export * from "./pages/types";
export * from "./drive/types";
export * from "./polls/types";
```

- [ ] **Step 2: Add the `exports` map to `packages/app/package.json`**

Insert after the `"type": "module",` line (the app has no `exports` today; adding a subpath export does not affect the Vite app build, which uses its own entry):

```json
  "exports": {
    "./services": "./src/services/index.ts"
  },
```

- [ ] **Step 3: Guard `window` in `generateShareLink`**

Replace the body of `generateShareLink` in `packages/app/src/services/pages/service.ts` (currently lines 168-176):

```ts
export function generateShareLink(address: string, viewKey: string, editKey?: string): ShareResult {
  const keys: Record<string, string> = { viewKey };
  if (editKey) keys["editKey"] = editKey;

  const nkeysFragment = encodeNKeys(keys);
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://formstr.app";
  const url = `${origin}/pages/${address}#${nkeysFragment}`;

  return { url, address, viewKey, editKey };
}
```

- [ ] **Step 4: Verify the app still type-checks**

Run: `pnpm --filter @formstr/app typecheck`
Expected: PASS (no new errors).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/services/index.ts packages/app/package.json packages/app/src/services/pages/service.ts
git commit -m "feat(app): export services subpath + make generateShareLink headless-safe"
```

---

## Task 3: Config module (TDD)

**Files:**

- Create: `packages/mcp/src/config.ts`
- Test: `packages/mcp/test/config.test.ts`

Config precedence: CLI flag > env var > config file. nsec is required; relays optional.

- [ ] **Step 1: Write the failing test `packages/mcp/test/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveConfig, redact } from "../src/config";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

describe("resolveConfig", () => {
  it("reads nsec from env", () => {
    const cfg = resolveConfig({ argv: [], env: { FORMSTR_NSEC: NSEC } });
    expect(cfg.nsec).toBe(NSEC);
    expect(cfg.allowWrites).toBe(false);
  });

  it("CLI flag overrides env for nsec and enables writes", () => {
    const cfg = resolveConfig({
      argv: ["--nsec", NSEC, "--allow-writes"],
      env: { FORMSTR_NSEC: "nsec1ignored" },
    });
    expect(cfg.nsec).toBe(NSEC);
    expect(cfg.allowWrites).toBe(true);
  });

  it("parses comma-separated relays from env", () => {
    const cfg = resolveConfig({
      argv: [],
      env: { FORMSTR_NSEC: NSEC, FORMSTR_RELAYS: "wss://a.example , wss://b.example" },
    });
    expect(cfg.relays).toEqual(["wss://a.example", "wss://b.example"]);
  });

  it("throws a clear error when nsec is missing", () => {
    expect(() => resolveConfig({ argv: [], env: {} })).toThrow(/nsec/i);
  });

  it("redact hides all but the prefix", () => {
    expect(redact(NSEC)).toBe("nsec1…");
    expect(redact(undefined)).toBe("(none)");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @formstr/mcp test config`
Expected: FAIL — cannot find module `../src/config`.

- [ ] **Step 3: Implement `packages/mcp/src/config.ts`**

```ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export interface ResolvedConfig {
  nsec: string;
  relays?: string[];
  allowWrites: boolean;
}

interface ConfigInput {
  argv: string[];
  env: NodeJS.ProcessEnv;
}

const fileSchema = z
  .object({ nsec: z.string().optional(), relays: z.array(z.string()).optional() })
  .partial();

function parseFlags(argv: string[]): { nsec?: string; relays?: string[]; allowWrites: boolean } {
  let nsec: string | undefined;
  let relays: string[] | undefined;
  let allowWrites = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--nsec") nsec = argv[++i];
    else if (argv[i] === "--relays") relays = splitRelays(argv[++i]);
    else if (argv[i] === "--allow-writes") allowWrites = true;
  }
  return { nsec, relays, allowWrites };
}

function splitRelays(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function readConfigFile(): { nsec?: string; relays?: string[] } {
  const path = join(homedir(), ".config", "formstr-mcp", "config.json");
  try {
    return fileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

export function resolveConfig(input: ConfigInput): ResolvedConfig {
  const flags = parseFlags(input.argv);
  const file = readConfigFile();
  const nsec = flags.nsec ?? input.env.FORMSTR_NSEC ?? file.nsec;
  const relays = flags.relays ?? splitRelays(input.env.FORMSTR_RELAYS) ?? file.relays ?? undefined;
  const allowWrites = flags.allowWrites || input.env.FORMSTR_ALLOW_WRITES === "true";

  if (!nsec) {
    throw new Error(
      "No signing key found. Provide an nsec via --nsec, FORMSTR_NSEC, or ~/.config/formstr-mcp/config.json",
    );
  }
  return { nsec, relays, allowWrites };
}

export function redact(secret: string | undefined): string {
  if (!secret) return "(none)";
  return secret.slice(0, 5) + "…";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @formstr/mcp test config`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/config.ts packages/mcp/test/config.test.ts
git commit -m "feat(mcp): config resolution (flags/env/file) with nsec redaction"
```

---

## Task 4: Bootstrap module (TDD)

**Files:**

- Create: `packages/mcp/src/bootstrap.ts`
- Test: `packages/mcp/test/bootstrap.test.ts`

Responsibilities: install an in-memory `localStorage` shim (the signer's `persist()` writes to it), set the Node WebSocket impl, log the signer in from the nsec, and optionally override module relays.

- [ ] **Step 1: Write the failing test `packages/mcp/test/bootstrap.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { signerManager } from "@formstr/core";
import { bootstrap } from "../src/bootstrap";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

describe("bootstrap", () => {
  beforeEach(() => {
    // @ts-expect-error reset shim between tests
    delete globalThis.localStorage;
  });

  it("installs a localStorage shim and logs the signer in from nsec", async () => {
    await bootstrap({ nsec: NSEC, allowWrites: false });
    expect(typeof globalThis.localStorage?.getItem).toBe("function");
    const pk = signerManager.getPublicKey();
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an invalid nsec", async () => {
    await expect(bootstrap({ nsec: "not-an-nsec", allowWrites: false })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @formstr/mcp test bootstrap`
Expected: FAIL — cannot find module `../src/bootstrap`.

- [ ] **Step 3: Implement `packages/mcp/src/bootstrap.ts`**

```ts
import { relayManager, signerManager } from "@formstr/core";
import { useWebSocketImplementation } from "nostr-tools/pool";
import WebSocket from "ws";
import type { ResolvedConfig } from "./config";

function installLocalStorageShim(): void {
  if (typeof globalThis.localStorage !== "undefined") return;
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

function overrideRelays(relays: string[]): void {
  // RelayManager.getRelaysForModule returns hardcoded module defaults; for v1 we
  // override it process-wide so every module uses the operator's relay set.
  relayManager.getRelaysForModule = () => [...relays];
}

export async function bootstrap(cfg: Pick<ResolvedConfig, "nsec" | "relays">): Promise<void> {
  installLocalStorageShim();
  useWebSocketImplementation(WebSocket);
  if (cfg.relays?.length) overrideRelays(cfg.relays);
  await signerManager.loginWithNsec(cfg.nsec);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @formstr/mcp test bootstrap`
Expected: PASS (2 tests). No network is touched — `loginWithNsec` only derives the pubkey.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/bootstrap.ts packages/mcp/test/bootstrap.test.ts
git commit -m "feat(mcp): bootstrap (localStorage shim, ws impl, nsec login, relay override)"
```

---

## Task 5: Safety + result helpers (TDD)

**Files:**

- Create: `packages/mcp/src/safety.ts`
- Create: `packages/mcp/src/result.ts`
- Test: `packages/mcp/test/safety.test.ts`

- [ ] **Step 1: Write the failing test `packages/mcp/test/safety.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { requireConfirm, GATED_TOOLS } from "../src/safety";

describe("safety", () => {
  it("lists the destructive/outward tools", () => {
    expect(GATED_TOOLS).toContain("delete_form");
    expect(GATED_TOOLS).toContain("submit_form_response");
    expect(GATED_TOOLS).toContain("rsvp_event");
    expect(GATED_TOOLS).not.toContain("create_form");
  });

  it("blocks a gated call without confirm and describes the effect", () => {
    const blocked = requireConfirm("delete_form", { confirm: false }, "deletes form abc");
    expect(blocked).not.toBeNull();
    expect(blocked!.isError).toBe(true);
    expect(JSON.stringify(blocked)).toMatch(/confirm/i);
    expect(JSON.stringify(blocked)).toMatch(/deletes form abc/);
  });

  it("allows a gated call when confirm is true", () => {
    expect(requireConfirm("delete_form", { confirm: true }, "deletes form abc")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @formstr/mcp test safety`
Expected: FAIL — cannot find module `../src/safety`.

- [ ] **Step 3: Implement `packages/mcp/src/result.ts`**

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function ok(message: string, data?: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: data === undefined ? undefined : (data as Record<string, unknown>),
  };
}

export function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
```

- [ ] **Step 4: Implement `packages/mcp/src/safety.ts`**

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fail } from "./result";

export const GATED_TOOLS = [
  "delete_form",
  "delete_calendar_event",
  "submit_form_response",
  "submit_poll_response",
  "rsvp_event",
] as const;

export type GatedTool = (typeof GATED_TOOLS)[number];

export function isGated(tool: string): tool is GatedTool {
  return (GATED_TOOLS as readonly string[]).includes(tool);
}

/**
 * Returns a blocking CallToolResult when a gated tool is invoked without
 * `confirm: true`, naming the irreversible effect. Returns null when allowed.
 */
export function requireConfirm(
  tool: string,
  args: { confirm?: boolean },
  effect: string,
): CallToolResult | null {
  if (args.confirm === true) return null;
  return fail(
    `Confirmation required for "${tool}". This action is irreversible and acts on your Nostr identity: ${effect}. Re-call with "confirm": true to proceed.`,
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @formstr/mcp test safety`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/safety.ts packages/mcp/src/result.ts packages/mcp/test/safety.test.ts
git commit -m "feat(mcp): safety gating + ActionResult→CallToolResult helpers"
```

---

## Task 6: Shared arg transforms (TDD)

**Files:**

- Create: `packages/mcp/src/tools/shared.ts`
- Test: `packages/mcp/test/shared.test.ts`

These are lifted from the (commented) `actionDispatcher.ts` so AI tool args map onto service params identically.

- [ ] **Step 1: Write the failing test `packages/mcp/test/shared.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { normalizePubkey, normalizePubkeyList, aiFieldsToFormFields } from "../src/tools/shared";

const HEX = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const NPUB = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";

describe("shared transforms", () => {
  it("normalizes hex and npub to hex, rejects junk", () => {
    expect(normalizePubkey(HEX)).toBe(HEX);
    expect(normalizePubkey(NPUB)).toBe(HEX);
    expect(normalizePubkey("garbage")).toBeNull();
  });

  it("filters a mixed pubkey list to valid hex", () => {
    expect(normalizePubkeyList([HEX, "garbage", NPUB])).toEqual([HEX, HEX]);
  });

  it("maps AI field objects to FormField with generated ids", () => {
    const fields = aiFieldsToFormFields([
      { label: "Name", type: "shortText", required: true },
      { label: "Color", type: "radioButton", options: ["Red", "Blue"] },
    ]);
    expect(fields[0]).toMatchObject({ id: "f0", label: "Name", required: true });
    expect(fields[1].options).toEqual([
      { id: "o0", label: "Red" },
      { id: "o1", label: "Blue" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @formstr/mcp test shared`
Expected: FAIL — cannot find module `../src/tools/shared`.

- [ ] **Step 3: Implement `packages/mcp/src/tools/shared.ts`**

```ts
import { nip19 } from "nostr-tools";
import type { AnswerType, FormField } from "@formstr/app/services";

export function normalizePubkey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return decoded.data;
    } catch {
      // ignore
    }
  }
  return null;
}

export function normalizePubkeyList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => (typeof v === "string" ? normalizePubkey(v) : null))
    .filter((p): p is string => !!p);
}

interface AiField {
  label?: string;
  type?: string;
  options?: string[];
  required?: boolean;
  placeholder?: string;
  gridRows?: string[];
  gridCols?: string[];
}

export function aiFieldsToFormFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];
  return (value as AiField[]).map((f, i) => ({
    id: `f${i}`,
    label: f.label ?? "",
    type: (f.type as AnswerType) ?? ("shortText" as AnswerType),
    required: f.required ?? false,
    placeholder: f.placeholder,
    options: f.options?.map((o, j) => ({ id: `o${j}`, label: o })),
    gridRows: f.gridRows,
    gridCols: f.gridCols,
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @formstr/mcp test shared`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/shared.ts packages/mcp/test/shared.test.ts
git commit -m "feat(mcp): shared arg transforms (pubkey normalize, AI fields→FormField)"
```

---

## Task 7: Tool-module contract

**Files:**

- Modify: `packages/mcp/src/tools/shared.ts` (append the `ToolModule` type + `RegisterCtx`)

Each module exports a `register(server, ctx)` function. `ctx.allowWrites` decides whether gated tools are registered. This keeps `server.ts` trivial.

- [ ] **Step 1: Append to `packages/mcp/src/tools/shared.ts`**

```ts
export interface RegisterCtx {
  allowWrites: boolean;
}
```

(Each module exports a `register(server, ctx)` function directly; `server.ts` calls them in turn. No registry array is needed — YAGNI.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @formstr/mcp typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/src/tools/shared.ts
git commit -m "feat(mcp): tool-module registration contract"
```

---

## Task 8: Forms tools (TDD with mocked services)

**Files:**

- Create: `packages/mcp/src/tools/forms.ts`
- Test: `packages/mcp/test/forms.test.ts`

`create_form` mirrors the client: create the template, then read-modify-write the
kind-14083 list via `saveToMyForms` so encrypted-form keys persist and the form lists
reliably. `fetch_form_responses` looks up the form's `signingKey` from `fetchMyForms`
so it can decrypt encrypted responses.

- [ ] **Step 1: Write the failing test `packages/mcp/test/forms.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/app/services", () => ({
  forms: {
    createForm: vi.fn(),
    fetchMyForms: vi.fn(),
    saveToMyForms: vi.fn(),
    fetchForm: vi.fn(),
    fetchResponses: vi.fn(),
    deleteForm: vi.fn(),
    submitResponse: vi.fn(),
  },
}));

import { forms } from "@formstr/app/services";
import { registerForms } from "../src/tools/forms";

function fakeServer() {
  const tools = new Map<string, { handler: (a: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (a: any) => Promise<any>) =>
      tools.set(name, { handler }),
  } as any;
  return { server, tools };
}

describe("forms tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers read+create tools without writes; gated tools only with writes", () => {
    const ro = fakeServer();
    registerForms(ro.server, { allowWrites: false });
    expect(ro.tools.has("list_forms")).toBe(true);
    expect(ro.tools.has("create_form")).toBe(true);
    expect(ro.tools.has("delete_form")).toBe(false);

    const rw = fakeServer();
    registerForms(rw.server, { allowWrites: true });
    expect(rw.tools.has("delete_form")).toBe(true);
    expect(rw.tools.has("submit_form_response")).toBe(true);
  });

  it("create_form creates then persists to the forms list", async () => {
    (forms.createForm as any).mockResolvedValue({
      formId: "abc",
      pubkey: "pk",
      signingKey: "sk",
      viewKey: "vk",
    });
    (forms.fetchMyForms as any).mockResolvedValue([]);
    const { server, tools } = fakeServer();
    registerForms(server, { allowWrites: false });

    const res = await tools.get("create_form")!.handler({
      name: "Survey",
      fields: [{ label: "Q1", type: "shortText" }],
      encrypted: true,
    });

    expect(forms.createForm).toHaveBeenCalledOnce();
    expect(forms.saveToMyForms).toHaveBeenCalledOnce();
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.formId).toBe("abc");
  });

  it("delete_form requires confirm", async () => {
    const { server, tools } = fakeServer();
    registerForms(server, { allowWrites: true });
    const blocked = await tools.get("delete_form")!.handler({ formId: "abc", formPubkey: "pk" });
    expect(blocked.isError).toBe(true);
    expect(forms.deleteForm).not.toHaveBeenCalled();

    const okRes = await tools
      .get("delete_form")!
      .handler({ formId: "abc", formPubkey: "pk", confirm: true });
    expect(forms.deleteForm).toHaveBeenCalledWith("abc", "pk");
    expect(okRes.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @formstr/mcp test forms`
Expected: FAIL — cannot find module `../src/tools/forms`.

- [ ] **Step 3: Implement `packages/mcp/src/tools/forms.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { forms } from "@formstr/app/services";
import type { FormSummary } from "@formstr/app/services";
import { ok, fail } from "../result";
import { requireConfirm } from "../safety";
import { aiFieldsToFormFields, normalizePubkeyList, type RegisterCtx } from "./shared";

const fieldShape = z
  .object({
    label: z.string(),
    type: z.string(),
    options: z.array(z.string()).optional(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    gridRows: z.array(z.string()).optional(),
    gridCols: z.array(z.string()).optional(),
  })
  .passthrough();

export function registerForms(server: McpServer, ctx: RegisterCtx): void {
  server.registerTool(
    "list_forms",
    { description: "List the forms in the user's forms index, with metadata.", inputSchema: {} },
    async () => {
      const list = await forms.fetchMyForms();
      return ok(`You have ${list.length} form(s).`, {
        forms: list.map((f) => ({
          id: f.id,
          name: f.name,
          pubkey: f.pubkey,
          isEncrypted: f.isEncrypted,
        })),
      });
    },
  );

  server.registerTool(
    "get_form",
    {
      description: "Fetch a single form's definition. Provide viewKey for encrypted forms.",
      inputSchema: { pubkey: z.string(), formId: z.string(), viewKey: z.string().optional() },
    },
    async ({ pubkey, formId, viewKey }) => {
      const form = await forms.fetchForm(pubkey, formId, viewKey);
      return form ? ok(`Form "${form.name}".`, { form }) : fail("Form not found.");
    },
  );

  server.registerTool(
    "fetch_form_responses",
    {
      description: "Get all responses/submissions for a specific form.",
      inputSchema: { formAuthorPubkey: z.string(), formId: z.string() },
    },
    async ({ formAuthorPubkey, formId }) => {
      const mine = await forms.fetchMyForms();
      const signingKey = mine.find(
        (f) => f.pubkey === formAuthorPubkey && f.id === formId,
      )?.signingKey;
      const responses = await forms.fetchResponses(formAuthorPubkey, formId, signingKey);
      return ok(`Found ${responses.length} response(s).`, {
        count: responses.length,
        responses: responses.map((r) => ({
          id: r.id,
          pubkey: r.pubkey,
          createdAt: r.createdAt,
          responses: r.responses,
        })),
      });
    },
  );

  server.registerTool(
    "create_form",
    {
      description:
        "Create a new form/survey with fields. Returns formId, pubkey, naddr coordinate.",
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        fields: z.array(fieldShape),
        publicForm: z.boolean().optional(),
        encrypted: z.boolean().optional(),
        allowedResponders: z.array(z.string()).optional(),
        collaborators: z.array(z.string()).optional(),
        notifyNpubs: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const fields = aiFieldsToFormFields(args.fields);
      const encrypt = args.encrypted ?? false;
      const allowedResponders = normalizePubkeyList(args.allowedResponders);
      const collaborators = normalizePubkeyList(args.collaborators);
      const notifyNpubs = normalizePubkeyList(args.notifyNpubs);
      const result = await forms.createForm({
        name: args.name,
        fields,
        encrypt,
        settings: {
          description: args.description,
          publicForm: args.publicForm ?? false,
          allowedResponders: allowedResponders.length ? allowedResponders : undefined,
          collaborators: collaborators.length ? collaborators : undefined,
          notifyNpubs: notifyNpubs.length ? notifyNpubs : undefined,
        },
      });

      // Read-modify-write the kind-14083 list so the form lists and (if encrypted)
      // its keys persist for later response decryption.
      const existing = await forms.fetchMyForms();
      const summary: FormSummary = {
        id: result.formId,
        name: args.name,
        pubkey: result.pubkey,
        createdAt: Math.floor(Date.now() / 1000),
        isEncrypted: encrypt,
        signingKey: result.signingKey,
        viewKey: result.viewKey,
      };
      await forms.saveToMyForms([...existing, summary]);

      const coordinate = `30168:${result.pubkey}:${result.formId}`;
      return ok(`Created form "${args.name}" with ${fields.length} field(s).`, {
        formId: result.formId,
        pubkey: result.pubkey,
        coordinate,
      });
    },
  );

  if (!ctx.allowWrites) return;

  server.registerTool(
    "delete_form",
    {
      description: "Delete a form (publishes a NIP-09 deletion). Requires confirm:true.",
      inputSchema: { formId: z.string(), formPubkey: z.string(), confirm: z.boolean().optional() },
    },
    async ({ formId, formPubkey, confirm }) => {
      const blocked = requireConfirm("delete_form", { confirm }, `deletes form ${formId}`);
      if (blocked) return blocked;
      await forms.deleteForm(formId, formPubkey);
      return ok(`Deleted form ${formId}.`);
    },
  );

  server.registerTool(
    "submit_form_response",
    {
      description: "Submit a response to a form on your identity. Requires confirm:true.",
      inputSchema: {
        formAuthorPubkey: z.string(),
        formId: z.string(),
        encrypt: z.boolean().optional(),
        answers: z.array(
          z.object({ fieldId: z.string(), answer: z.string(), metadata: z.string().optional() }),
        ),
        confirm: z.boolean().optional(),
      },
    },
    async ({ formAuthorPubkey, formId, encrypt, answers, confirm }) => {
      const blocked = requireConfirm(
        "submit_form_response",
        { confirm },
        `publicly submits ${answers.length} answer(s) to form ${formId}`,
      );
      if (blocked) return blocked;
      await forms.submitResponse(
        formAuthorPubkey,
        formId,
        answers.map((a) => ({ fieldId: a.fieldId, answer: a.answer, metadata: a.metadata })),
        Boolean(encrypt),
      );
      return ok(`Submitted ${answers.length} answer(s) to form ${formId}.`);
    },
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @formstr/mcp test forms`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/forms.ts packages/mcp/test/forms.test.ts
git commit -m "feat(mcp): forms tools (list/get/responses/create + gated delete/submit)"
```

---

## Task 9: Polls tools

**Files:**

- Create: `packages/mcp/src/tools/polls.ts`

Service signatures: `createPoll(draft)`, `fetchPoll(eventId)`, `fetchPollResults(pollId)`,
`fetchMyPolls()`, `submitPollResponse(...)`. `PollDraft` shape: `{ question, options: {label}[], pollType, endsAt?, hashtags? }`.

- [ ] **Step 1: Implement `packages/mcp/src/tools/polls.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { polls } from "@formstr/app/services";
import { ok, fail } from "../result";
import { requireConfirm } from "../safety";
import type { RegisterCtx } from "./shared";

export function registerPolls(server: McpServer, ctx: RegisterCtx): void {
  server.registerTool(
    "list_polls",
    { description: "List polls created by the user.", inputSchema: {} },
    async () => {
      const mine = await polls.fetchMyPolls();
      return ok(`You have ${mine.length} poll(s).`, { polls: mine });
    },
  );

  server.registerTool(
    "get_poll",
    {
      description: "Fetch a single poll by its event id.",
      inputSchema: { pollEventId: z.string() },
    },
    async ({ pollEventId }) => {
      const poll = await polls.fetchPoll(pollEventId);
      return poll
        ? ok(`Poll "${poll.question ?? pollEventId}".`, { poll })
        : fail("Poll not found.");
    },
  );

  server.registerTool(
    "fetch_poll_results",
    {
      description: "Get current results/votes for a poll.",
      inputSchema: { pollEventId: z.string() },
    },
    async ({ pollEventId }) => {
      const results = await polls.fetchPollResults(pollEventId);
      return ok(`Poll has ${results.totalVotes ?? 0} vote(s).`, { results });
    },
  );

  server.registerTool(
    "create_poll",
    {
      description: "Create a new poll/vote.",
      inputSchema: {
        question: z.string(),
        options: z.array(z.string()).min(2),
        pollType: z.enum(["singlechoice", "multiplechoice"]).optional(),
        endsAt: z.string().optional(),
        hashtags: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const poll = await polls.createPoll({
        question: args.question,
        options: args.options.map((label) => ({ label })),
        pollType: args.pollType ?? "singlechoice",
        endsAt: args.endsAt ? new Date(args.endsAt) : undefined,
        hashtags: args.hashtags,
      });
      return ok(`Created poll "${args.question}".`, { id: poll.id });
    },
  );

  if (!ctx.allowWrites) return;

  server.registerTool(
    "submit_poll_response",
    {
      description: "Cast a vote on a poll on your identity. Requires confirm:true.",
      inputSchema: {
        pollEventId: z.string(),
        optionIds: z.array(z.string()).min(1),
        confirm: z.boolean().optional(),
      },
    },
    async ({ pollEventId, optionIds, confirm }) => {
      const blocked = requireConfirm(
        "submit_poll_response",
        { confirm },
        `votes on poll ${pollEventId}`,
      );
      if (blocked) return blocked;
      await polls.submitPollResponse(pollEventId, optionIds);
      return ok(`Voted on poll ${pollEventId}.`);
    },
  );
}
```

> Implementation note: confirm `submitPollResponse`'s exact parameter order against
> `packages/app/src/services/polls/service.ts:70` before finalizing; adjust the call if
> it takes a different shape. `Poll`/`PollResults` field names (`id`, `question`,
> `totalVotes`) are surfaced as-is in `structuredContent`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @formstr/mcp typecheck`
Expected: PASS (fix any field-name mismatches flagged against the poll types).

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/src/tools/polls.ts
git commit -m "feat(mcp): polls tools (list/get/results/create + gated vote)"
```

---

## Task 10: Calendar tools

**Files:**

- Create: `packages/mcp/src/tools/calendar.ts`

Service signatures: `publishPublicCalendarEvent(params)`, `publishPrivateCalendarEvent(params)`,
`deleteCalendarEvent(eventId, coordinate?)`, `fetchCalendarEventsSync(params)`,
and `rsvpToEvent(coordinate, status, isPrivate)` from `calendar/rsvp`.

- [ ] **Step 1: Implement `packages/mcp/src/tools/calendar.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { calendar, calendarRsvp } from "@formstr/app/services";
import { ok } from "../result";
import { requireConfirm } from "../safety";
import type { RegisterCtx } from "./shared";

export function registerCalendar(server: McpServer, ctx: RegisterCtx): void {
  server.registerTool(
    "list_calendar_events",
    { description: "List the user's calendar events.", inputSchema: {} },
    async () => {
      const events = await calendar.fetchCalendarEventsSync({});
      return ok(`Found ${events.length} event(s).`, { events });
    },
  );

  server.registerTool(
    "create_calendar_event",
    {
      description:
        "Schedule a calendar event. Start/end are ISO 8601. Private events are encrypted.",
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        start: z.string(),
        end: z.string().optional(),
        location: z.string().optional(),
        isPrivate: z.boolean().optional(),
      },
    },
    async (args) => {
      const begin = new Date(args.start);
      const end = args.end ? new Date(args.end) : new Date(begin.getTime() + 3_600_000);
      const params = {
        title: args.title,
        description: args.description ?? "",
        begin,
        end,
        location: args.location,
      };
      const event = args.isPrivate
        ? await calendar.publishPrivateCalendarEvent(params)
        : await calendar.publishPublicCalendarEvent(params);
      return ok(`Created event "${args.title}".`, { eventId: event.eventId ?? event.id });
    },
  );

  if (!ctx.allowWrites) return;

  server.registerTool(
    "delete_calendar_event",
    {
      description: "Delete a calendar event. Requires confirm:true.",
      inputSchema: {
        eventId: z.string(),
        coordinate: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ eventId, coordinate, confirm }) => {
      const blocked = requireConfirm(
        "delete_calendar_event",
        { confirm },
        `deletes event ${eventId}`,
      );
      if (blocked) return blocked;
      await calendar.deleteCalendarEvent(eventId, coordinate);
      return ok(`Deleted event ${eventId}.`);
    },
  );

  server.registerTool(
    "rsvp_event",
    {
      description: "RSVP to a calendar event on your identity. Requires confirm:true.",
      inputSchema: {
        eventCoordinate: z.string(),
        status: z.enum(["accepted", "declined", "tentative"]),
        isPrivate: z.boolean().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ eventCoordinate, status, isPrivate, confirm }) => {
      const blocked = requireConfirm("rsvp_event", { confirm }, `sends "${status}" RSVP`);
      if (blocked) return blocked;
      await calendarRsvp.rsvpToEvent(eventCoordinate, status, Boolean(isPrivate));
      return ok(`RSVP "${status}" sent.`);
    },
  );
}
```

> Implementation note: confirm the param object shapes for
> `publishPublic/PrivateCalendarEvent` and the return field for the event id against
> `packages/app/src/services/calendar/service.ts:21,76`; adjust `params`/`event.eventId`
> accordingly. `fetchCalendarEventsSync` arg shape is at `:174`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @formstr/mcp typecheck`
Expected: PASS (resolve any field/param mismatches flagged by the calendar types).

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/src/tools/calendar.ts
git commit -m "feat(mcp): calendar tools (list/create + gated delete/rsvp)"
```

---

## Task 11: Pages + Drive tools

**Files:**

- Create: `packages/mcp/src/tools/pages.ts`
- Create: `packages/mcp/src/tools/drive.ts`

Service signatures: pages `savePage({title, content})`, `fetchMyPages()`;
drive `fetchFileIndex()`, `extractFolders(files)`.

- [ ] **Step 1: Implement `packages/mcp/src/tools/pages.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pages } from "@formstr/app/services";
import { ok } from "../result";
import type { RegisterCtx } from "./shared";

export function registerPages(server: McpServer, _ctx: RegisterCtx): void {
  server.registerTool(
    "list_pages",
    { description: "List the user's documents/pages.", inputSchema: {} },
    async () => {
      const list = await pages.fetchMyPages();
      return ok(`You have ${list.length} page(s).`, { pages: list });
    },
  );

  const createHandler = async (args: { title?: string; content: string }) => {
    const page = await pages.savePage({ title: args.title ?? "Untitled", content: args.content });
    return ok(`Saved page "${args.title ?? "Untitled"}".`, { address: page.address });
  };

  server.registerTool(
    "create_page",
    {
      description: "Create an encrypted document/page (Markdown).",
      inputSchema: { title: z.string(), content: z.string() },
    },
    createHandler,
  );

  server.registerTool(
    "save_private_note",
    {
      description: "Save a quick private encrypted note (Markdown).",
      inputSchema: { title: z.string(), content: z.string() },
    },
    createHandler,
  );
}
```

- [ ] **Step 2: Implement `packages/mcp/src/tools/drive.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { drive } from "@formstr/app/services";
import { ok } from "../result";
import type { RegisterCtx } from "./shared";

export function registerDrive(server: McpServer, _ctx: RegisterCtx): void {
  server.registerTool(
    "browse_files",
    {
      description: "List files in the user's encrypted drive, optionally under a folder.",
      inputSchema: { folder: z.string().optional() },
    },
    async ({ folder }) => {
      const files = await drive.fetchFileIndex();
      const folders = drive.extractFolders(files);
      const prefix = folder && folder !== "/" ? folder : null;
      const shown = prefix ? files.filter((f) => (f.folder ?? "/").startsWith(prefix)) : files;
      return ok(`Found ${shown.length} file(s). Folders: ${folders.join(", ") || "none"}.`, {
        files: shown.map((f) => ({ name: f.name, size: f.size, type: f.type, folder: f.folder })),
        folders,
      });
    },
  );
}
```

> Implementation note: confirm `FileMetadata` field names (`name`, `size`, `type`,
> `folder`) against `packages/app/src/services/drive/types.ts`; adjust the projection if
> they differ. `PageSummary`/`PageDocument` (`address`) are at `pages/types.ts`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @formstr/mcp typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/src/tools/pages.ts packages/mcp/src/tools/drive.ts
git commit -m "feat(mcp): pages + drive tools (read + page creates)"
```

---

## Task 12: Server assembly + entry point

**Files:**

- Create: `packages/mcp/src/server.ts`
- Overwrite: `packages/mcp/src/index.ts`

- [ ] **Step 1: Implement `packages/mcp/src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerForms } from "./tools/forms";
import { registerCalendar } from "./tools/calendar";
import { registerPages } from "./tools/pages";
import { registerDrive } from "./tools/drive";
import { registerPolls } from "./tools/polls";
import type { RegisterCtx } from "./tools/shared";

export function buildServer(ctx: RegisterCtx): McpServer {
  const server = new McpServer({ name: "formstr", version: "0.0.1" });
  registerForms(server, ctx);
  registerCalendar(server, ctx);
  registerPages(server, ctx);
  registerDrive(server, ctx);
  registerPolls(server, ctx);
  return server;
}

export async function startStdio(ctx: RegisterCtx): Promise<void> {
  const server = buildServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 2: Overwrite `packages/mcp/src/index.ts`**

```ts
import { resolveConfig, redact } from "./config";
import { bootstrap } from "./bootstrap";
import { signerManager } from "@formstr/core";
import { startStdio } from "./server";

async function main(): Promise<void> {
  const cfg = resolveConfig({ argv: process.argv.slice(2), env: process.env });
  await bootstrap(cfg);
  const pubkey = signerManager.getPublicKey();
  console.error(
    `formstr-mcp: signed in as ${pubkey?.slice(0, 12)}… (key ${redact(cfg.nsec)}), ` +
      `writes ${cfg.allowWrites ? "ENABLED" : "disabled"}`,
  );
  await startStdio({ allowWrites: cfg.allowWrites });
  console.error("formstr-mcp: server running on stdio");
}

main().catch((err) => {
  console.error("formstr-mcp: fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 3: Build**

Run: `pnpm --filter @formstr/mcp build`
Expected: produces `packages/mcp/dist/index.js` with a `#!/usr/bin/env node` shebang.

Run: `grep -c "from \"react\"" packages/mcp/dist/index.js`
Expected: `0` — React is not in the bundle.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/src/server.ts packages/mcp/src/index.ts
git commit -m "feat(mcp): assemble stdio server + entry point"
```

---

## Task 13: Smoke test (MCP handshake over stdio)

**Files:**

- Test: `packages/mcp/test/smoke.test.ts`

Boots the built server as a subprocess and drives the MCP `initialize` + `tools/list`
handshake with the SDK client, asserting the tool set matches `--allow-writes`. Uses a
throwaway nsec; no relay calls happen during a handshake.

- [ ] **Step 1: Write the smoke test `packages/mcp/test/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

async function toolNames(args: string[]): Promise<Set<string>> {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js", ...args],
    env: { ...process.env, FORMSTR_NSEC: NSEC },
  });
  const client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();
  return new Set(tools.map((t) => t.name));
}

describe("smoke: stdio handshake", () => {
  it("read-only mode hides gated tools", async () => {
    const names = await toolNames([]);
    expect(names.has("list_forms")).toBe(true);
    expect(names.has("create_form")).toBe(true);
    expect(names.has("delete_form")).toBe(false);
    expect(names.has("submit_form_response")).toBe(false);
  }, 30_000);

  it("--allow-writes exposes gated tools", async () => {
    const names = await toolNames(["--allow-writes"]);
    expect(names.has("delete_form")).toBe(true);
    expect(names.has("rsvp_event")).toBe(true);
    expect(names.has("submit_poll_response")).toBe(true);
  }, 30_000);
});
```

- [ ] **Step 2: Build then run the smoke test**

Run: `pnpm --filter @formstr/mcp build && pnpm --filter @formstr/mcp test smoke`
Expected: PASS (2 tests). The subprocess runs `dist/index.js`; cwd is the package dir.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/test/smoke.test.ts
git commit -m "test(mcp): stdio handshake smoke test for tool gating"
```

---

## Task 14: Full suite + README + host config

**Files:**

- Create: `packages/mcp/README.md`

- [ ] **Step 1: Run the whole package suite**

Run: `pnpm --filter @formstr/mcp test`
Expected: PASS (config, bootstrap, safety, shared, forms, smoke).

- [ ] **Step 2: Run repo-wide typecheck**

Run: `pnpm typecheck`
Expected: PASS for `@formstr/core`, `@formstr/app`, `@formstr/mcp`.

- [ ] **Step 3: Create `packages/mcp/README.md`**

````markdown
# @formstr/mcp

A standalone Model Context Protocol (MCP) server that exposes the Formstr super-app
(forms, calendar, pages, drive, polls) to any MCP host — Claude Code/Desktop, Cursor,
Odysseus, etc. Built on `@formstr/core` and the super-app's service layer; talks Nostr
directly.

## Quick start

```bash
pnpm --filter @formstr/mcp build
node packages/mcp/dist/index.js --nsec nsec1...        # read + create tools
node packages/mcp/dist/index.js --nsec nsec1... --allow-writes   # + destructive/outward tools
```

Config precedence: CLI flag > env var > `~/.config/formstr-mcp/config.json` (`{ "nsec": "...", "relays": ["wss://..."] }`, chmod `0600`).

| Var                         | Meaning                                   |
| --------------------------- | ----------------------------------------- |
| `FORMSTR_NSEC`              | signing key (required)                    |
| `FORMSTR_RELAYS`            | comma-separated relay override (optional) |
| `FORMSTR_ALLOW_WRITES=true` | enable gated tools (optional)             |

## Host config

```json
{
  "mcpServers": {
    "formstr": {
      "command": "node",
      "args": ["/abs/path/packages/mcp/dist/index.js"],
      "env": { "FORMSTR_NSEC": "nsec1..." }
    }
  }
}
```

## Safety model

Destructive/outward tools (`delete_form`, `delete_calendar_event`,
`submit_form_response`, `submit_poll_response`, `rsvp_event`) are **not registered**
unless `--allow-writes` is set, and each additionally requires `"confirm": true` per call.

## Tools

Read: `list_forms`, `get_form`, `fetch_form_responses`, `list_pages`, `list_polls`,
`get_poll`, `fetch_poll_results`, `browse_files`, `list_calendar_events`.
Create: `create_form`, `create_page`, `save_private_note`, `create_poll`,
`create_calendar_event`.
Gated: `delete_form`, `delete_calendar_event`, `submit_form_response`,
`submit_poll_response`, `rsvp_event`.

### Deferred (not yet implemented)

`update_form`, `update_event`, `share_form`, `share_page`, `import_form_from_naddr`,
`attach_form_to_event` — these need store-level orchestration (gift-wrap key
distribution, calendar update) not yet exposed by the service layer.

## Security

The server holds your `nsec` in-process on your machine. Treat the key as a
local-trust secret (env injection or `0600` config). A NIP-46 bunker mode (no key in
process) is the planned sovereign upgrade.
````

- [ ] **Step 4: Manual live check (optional, documented — not automated)**

Run: `node packages/mcp/dist/index.js --nsec <throwaway> --allow-writes`
Then from an MCP host, call `create_form` then `list_forms`; verify the new form
appears. (Skipped in CI because it touches public relays.)

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/README.md
git commit -m "docs(mcp): README with host config, safety model, tool list"
```

---

## Self-review checklist (run after implementation)

- [ ] **Spec coverage:** D1 universal server (Task 12) · D2 nsec/LocalSigner (Task 4) ·
      D3 read+create on / destructive gated (Tasks 5,8–11) · D4 stdio (Task 12) · D5
      Approach B subpath + tsup bundle, React-free verified (Tasks 1,2,12) · D6 branch off
      main (done). Safety two-layer model = Task 5 + per-tool `requireConfirm`.
- [ ] **Placeholder scan:** the three "Implementation note" callouts (Tasks 9–11) point
      at exact source lines to confirm field/param names during coding — they are
      verification steps, not deferred work; the code compiles as written against the
      documented signatures.
- [ ] **Type consistency:** `RegisterCtx`/`ToolModule` (Task 7) used by every module;
      `ok`/`fail` (Task 5) used everywhere; `requireConfirm` signature stable across Tasks
      8–11; `GATED_TOOLS` (Task 5) matches the gated tools actually registered.

## Notes for the implementer

- **TDD where it pays:** pure units (config, safety, shared, tool registration/gating)
  are unit-tested with mocked services. Network service calls are exercised only via the
  optional manual live check — do not write tests that hit real relays in CI.
- **Field-name drift:** the poll/calendar/drive "Implementation note" callouts exist
  because those `structuredContent` projections reference type fields not fully read
  during planning. Open the cited `types.ts`, confirm names, fix the projection if
  needed. `typecheck` will catch mismatches.
- **DRY:** `create_page`/`save_private_note` share one handler (Task 11). Pubkey
  normalization and AI-field mapping live only in `shared.ts`.
