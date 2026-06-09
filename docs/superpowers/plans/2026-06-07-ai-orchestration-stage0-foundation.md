# AI Orchestration — Stage 0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a new framework-agnostic `@formstr/agent` package that owns the 7 domain services + the 51-tool registry (+ neutral `result`/`safety` helpers), so the in-browser agent (later stages) and the stdio MCP share one tool source — and make `@formstr/mcp` publishable by dropping its `@formstr/app` dependency. **No user-visible behavior change.**

**Architecture:** `@formstr/core` (primitives) ← **`@formstr/agent`** (services + tool registry, source-exported TS, no build step) ← { `@formstr/mcp` (thin stdio adapter), `@formstr/app` (consumes services from agent) }. Tool handlers are _moved unchanged_; only their result type becomes a neutral `ToolResult` (mcp maps it back to the SDK `CallToolResult` at registration).

**Tech Stack:** pnpm workspaces, TypeScript (ESM, `moduleResolution: bundler`), zod, vitest, tsup (mcp build), Vite (app build). Reference: spec `docs/superpowers/specs/2026-06-07-ai-orchestration-design.md` §4.1–4.2, §6 (Stage 0), §7.

---

## File structure (what Stage 0 creates / moves / modifies)

**New package `packages/agent/`:**

- `package.json` — `@formstr/agent`, `private`, source `exports`, deps `@formstr/core` + `nostr-tools` + `zod`.
- `tsconfig.json` — extends base, `noEmit`, references `../core`.
- `src/index.ts` — barrel: re-exports `toolRegistry`, types, `result`/`safety` helpers.
- `src/result.ts` — neutral `ToolResult` + `ok`/`fail`/`table` (moved from mcp, retyped).
- `src/safety.ts` — `GATED_TOOLS`/`isGated`/`requireConfirm` (moved from mcp, retyped).
- `src/tools/types.ts` — `ToolEntry`, `ToolCtx`.
- `src/tools/shared.ts` — helpers (moved from mcp, import path fixed).
- `src/tools/{forms,calendar,pages,polls,drive}.ts` — registry arrays (converted from mcp `registerX`).
- `src/tools/index.ts` — `export const toolRegistry`.
- `src/services/**` — the 7 services + types + their tests (moved from app).
- `test/{result,safety,shared,forms,calendar,pages,polls,drive}.test.ts` — moved from mcp, retyped.

**Modified:**

- `packages/mcp/src/server.ts` — `buildServer` iterates `toolRegistry` + `adapt()`; imports from `@formstr/agent`.
- `packages/mcp/package.json` — drop `@formstr/app`; add `@formstr/agent`.
- `packages/mcp/src/{result.ts,safety.ts,tools/}` — deleted (moved to agent).
- `packages/mcp/test/{result,safety,shared,forms,calendar,pages,polls,drive}.test.ts` — moved to agent (others stay).
- `packages/mcp/test/smoke.test.ts` — assert `buildServer` registers tools + gating via the adapter.
- `packages/app/package.json` — add `@formstr/agent`; remove the `./services` export.
- `packages/app/src/**` — 68 files: rewrite `../…/services/X` imports → `@formstr/agent/services/X`.
- `packages/app/tsconfig.json` — add `{ "path": "../agent" }`? **No** — agent is source-exported (noEmit), so app resolves it via `exports`, not project references. Leave references as-is.

---

## Task 1: Scaffold the `@formstr/agent` package

**Files:**

- Create: `packages/agent/package.json`
- Create: `packages/agent/tsconfig.json`
- Create: `packages/agent/src/index.ts`

- [ ] **Step 1: Create `packages/agent/package.json`**

```json
{
  "name": "@formstr/agent",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./services": "./src/services/index.ts",
    "./services/*": "./src/services/*.ts",
    "./tools": "./src/tools/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@formstr/core": "workspace:*",
    "nostr-tools": "^2.16.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  }
}
```

> Source `exports` (no build step) — matches how `@formstr/app/services` is consumed today; Vite/tsup/tsc all compile the `.ts` directly. Pin `vitest`/`zod`/`nostr-tools` to the versions already in the lockfile (`grep '"vitest"\|"zod"\|"nostr-tools"' packages/*/package.json`).

- [ ] **Step 2: Create `packages/agent/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "./src",
    "types": []
  },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 3: Create a placeholder `packages/agent/src/index.ts`**

```ts
// Barrel — populated by later tasks (services, tool registry, result/safety).
export {};
```

- [ ] **Step 4: Link the workspace and verify it resolves**

Run: `pnpm install`
Expected: completes; `@formstr/agent` appears under `node_modules/@formstr/`.

Run: `pnpm --filter @formstr/agent typecheck`
Expected: PASS (empty project).

- [ ] **Step 5: Commit**

```bash
git add packages/agent pnpm-lock.yaml
git commit -m "chore(agent): scaffold @formstr/agent package"
```

---

## Task 2: Move the services into `@formstr/agent`

**Files:**

- Move: `packages/app/src/services/**` → `packages/agent/src/services/**`

- [ ] **Step 1: Move the directory (history-preserving)**

```bash
git mv packages/app/src/services packages/agent/src/services
```

> This moves all 7 service modules (`forms`, `calendar` incl. `rsvp`/`booking`/`viewKey`/`calendarListCodec`, `pages`, `drive`, `polls`), their `types`, the `index.ts` barrel, and the 9 `*.test.ts` files. Service files import only `@formstr/core` + `nostr-tools` + sibling relatives, all of which still resolve after the move.

- [ ] **Step 2: Run the moved service tests in their new home**

Run: `pnpm --filter @formstr/agent test`
Expected: PASS — the 9 moved service test files run green (core 71-style suites now under agent). If a test imports `vitest` and fails to resolve, confirm `vitest` is in `agent` devDeps (Task 1).

- [ ] **Step 3: Typecheck agent**

Run: `pnpm --filter @formstr/agent typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(agent): move domain services into @formstr/agent"
```

---

## Task 3: Point `@formstr/app` at the moved services

**Files:**

- Modify: `packages/app/package.json` (add dep, drop `./services` export)
- Modify: 68 files under `packages/app/src/**` (rewrite service imports)

- [ ] **Step 1: Add the dependency and drop the stale export**

In `packages/app/package.json`: add `"@formstr/agent": "workspace:*"` to `dependencies`, and **remove** the `exports` block (`"./services": "./src/services/index.ts"`) — nothing imports `@formstr/app/services` after this task.

- [ ] **Step 2: Rewrite every deep service import to the package path**

Run (rewrites all `(../)+services/<path>` → `@formstr/agent/services/<path>`):

```bash
cd packages/app
grep -rlE 'from "(\.\./)+services/' src \
  | xargs perl -pi -e 's{from "(?:\.\./)+services/}{from "\@formstr/agent/services/}g'
cd ../..
```

- [ ] **Step 3: Verify no stray relative service imports remain**

Run: `grep -rnE 'from "(\.\./)+services/' packages/app/src ; echo "exit:$?"`
Expected: no matches (grep `exit:1`).

- [ ] **Step 4: Reinstall (new workspace dep) and typecheck the app**

Run: `pnpm install && pnpm --filter @formstr/app typecheck`
Expected: PASS. (`src/ai/actionDispatcher.ts` is in the app tsconfig `exclude` list, so it won't be typechecked here, but its imports were still rewritten by Step 2 so the later Vite build resolves.)

- [ ] **Step 5: Run app tests + build**

Run: `pnpm --filter @formstr/app test && pnpm --filter @formstr/app build`
Expected: PASS / built. (The app still uses its existing `ai/tools.ts` + `actionDispatcher.ts`; those are deleted in Stage 1.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(app): import domain services from @formstr/agent"
```

---

## Task 4: Move + neutralize `result` and `safety` (TDD)

**Files:**

- Create: `packages/agent/src/result.ts`
- Create: `packages/agent/src/safety.ts`
- Create: `packages/agent/test/result.test.ts`, `packages/agent/test/safety.test.ts`
- (mcp copies are deleted in Task 9.)

- [ ] **Step 1: Write the failing neutral-result test**

`packages/agent/test/result.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ok, fail, table } from "../src/result";

describe("ToolResult helpers", () => {
  it("ok carries text + data and ok:true", () => {
    const r = ok("done", { id: "x" });
    expect(r).toEqual({ ok: true, text: "done", data: { id: "x" } });
  });
  it("fail carries text + code and ok:false", () => {
    expect(fail("nope", "NOT_FOUND")).toEqual({ ok: false, text: "nope", errorCode: "NOT_FOUND" });
  });
  it("table renders a markdown table, _(none)_ when empty", () => {
    expect(table([], ["a"])).toBe("_(none)_");
    expect(table([{ a: 1 }], ["a"])).toContain("| a |");
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `pnpm --filter @formstr/agent test result`
Expected: FAIL — `Cannot find module '../src/result'`.

- [ ] **Step 3: Create `packages/agent/src/result.ts` (neutral)**

```ts
export interface ToolResult {
  ok: boolean;
  text: string;
  data?: unknown;
  errorCode?: string;
}

export function ok(text: string, data?: unknown): ToolResult {
  return data !== undefined ? { ok: true, text, data } : { ok: true, text };
}

export function fail(text: string, errorCode?: string): ToolResult {
  return errorCode !== undefined ? { ok: false, text, errorCode } : { ok: false, text };
}

export function table(rows: Record<string, unknown>[], cols: string[]): string {
  if (rows.length === 0) return "_(none)_";
  const header = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => String(r[c] ?? "")).join(" | ")} |`).join("\n");
  return `${header}\n${body}`;
}
```

- [ ] **Step 4: Create `packages/agent/src/safety.ts` (neutral)**

Copy `packages/mcp/src/safety.ts`, change the import + return type so `requireConfirm` returns `ToolResult | null` instead of `CallToolResult | null`:

```ts
import { fail, type ToolResult } from "./result";

export const GATED_TOOLS = [
  "delete_form",
  "delete_calendar_event",
  "update_calendar_event",
  "attach_form_to_event",
  "submit_form_response",
  "submit_poll_response",
  "rsvp_event",
  "delete_page",
  "share_page",
  "delete_poll",
  "clear_my_vote",
  "delete_file",
  "rename_file",
  "move_file",
] as const;

export type GatedTool = (typeof GATED_TOOLS)[number];
export function isGated(tool: string): tool is GatedTool {
  return (GATED_TOOLS as readonly string[]).includes(tool);
}

export function requireConfirm(
  tool: string,
  args: { confirm?: boolean },
  effect: string,
): ToolResult | null {
  if (args.confirm === true) return null;
  return fail(
    `Confirmation required for "${tool}". This action is irreversible and acts on your Nostr identity: ${effect}. Re-call with "confirm": true to proceed.`,
  );
}
```

- [ ] **Step 5: Port the safety test**

Copy `packages/mcp/test/safety.test.ts` → `packages/agent/test/safety.test.ts`; fix the import to `../src/safety`. If it asserts on `CallToolResult` shape (`.isError`), change to the neutral shape (`.ok === false`).

- [ ] **Step 6: Run the result + safety tests**

Run: `pnpm --filter @formstr/agent test result safety`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/result.ts packages/agent/src/safety.ts packages/agent/test/result.test.ts packages/agent/test/safety.test.ts
git commit -m "feat(agent): neutral ToolResult + result/safety helpers"
```

---

## Task 5: Define the tool registry types + move `shared.ts`

**Files:**

- Create: `packages/agent/src/tools/types.ts`
- Move: `packages/mcp/src/tools/shared.ts` → `packages/agent/src/tools/shared.ts`
- Move: `packages/mcp/test/shared.test.ts` → `packages/agent/test/shared.test.ts`

- [ ] **Step 1: Create `packages/agent/src/tools/types.ts`**

```ts
import type { z } from "zod";
import type { ToolResult } from "../result";

/** Execution context passed to every tool handler. */
export interface ToolCtx {
  /** When false, the stdio MCP does not register `write` tools. The app sets true. */
  allowWrites: boolean;
}

export interface ToolEntry {
  name: string;
  description: string;
  /** zod raw shape — same value MCP's registerTool takes as `inputSchema`. */
  inputSchema: z.ZodRawShape;
  handler: (args: any, ctx: ToolCtx) => Promise<ToolResult>;
  /** Mutating/outward tool — stdio MCP registers it only when allowWrites. */
  write?: boolean;
}
```

> `args: any` mirrors the current handlers (zod-inferred at the MCP boundary); keeping it loose avoids rewriting 51 signatures in Stage 0. Stage 1 derives JSON-schema from `inputSchema`.

- [ ] **Step 2: Move `shared.ts` and fix its services import**

```bash
git mv packages/mcp/src/tools/shared.ts packages/agent/src/tools/shared.ts
git mv packages/mcp/test/shared.test.ts packages/agent/test/shared.test.ts
```

In `packages/agent/src/tools/shared.ts`: change `from "@formstr/app/services"` → `from "../services"`. Replace its `RegisterCtx` interface with a re-export so existing tool code keeps compiling:

```ts
export type { ToolCtx as RegisterCtx } from "./types";
```

In `packages/agent/test/shared.test.ts`: fix the import path to `../src/tools/shared`.

- [ ] **Step 3: Run shared test + typecheck**

Run: `pnpm --filter @formstr/agent test shared && pnpm --filter @formstr/agent typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(agent): ToolEntry/ToolCtx types + move shared helpers"
```

---

## Task 6: Convert the **forms** tools to a registry array (worked example)

This task establishes the exact transform; Task 7 repeats it for the other four modules.

**Files:**

- Move: `packages/mcp/src/tools/forms.ts` → `packages/agent/src/tools/forms.ts`
- Move: `packages/mcp/test/forms.test.ts` → `packages/agent/test/forms.test.ts`

- [ ] **Step 1: Move the module**

```bash
git mv packages/mcp/src/tools/forms.ts packages/agent/src/tools/forms.ts
```

- [ ] **Step 2: Transform `registerForms(server, ctx)` → `formsTools: ToolEntry[]`**

Apply this mechanical transform to `packages/agent/src/tools/forms.ts`:

1. Imports: `from "@formstr/app/services"` → `from "../services"`; `from "../result"`, `from "../safety"` (now siblings); **remove** `import type { McpServer }`; add `import type { ToolEntry } from "./types";`.
2. Replace the function wrapper with an exported array. Each existing `server.registerTool("name", { description, inputSchema }, handler)` becomes an object literal `{ name: "name", description, inputSchema, handler, write }`.
3. Tools defined **before** the old `if (!ctx.allowWrites) return;` line are `write: false` (omit the flag): `list_forms`, `get_form`, `fetch_form_responses`, `create_form`, `import_form_from_naddr`.
4. Tools defined **after** that line are `write: true`: `update_form`, `share_form`, `delete_form`, `submit_form_response`. (Of these, `share_form`/`delete_form`/`submit_form_response` are also in `GATED_TOOLS` — their bodies already call `requireConfirm(...)`, which now returns a neutral `ToolResult`; no change needed.)
5. Handler bodies are otherwise unchanged (they already return via `ok()/fail()`, now neutral).

Resulting shape:

```ts
import { forms, FORM_KINDS, type FormField } from "../services";
import { createRef, parseRef } from "@formstr/core";
import { nip19 } from "nostr-tools";
import { z } from "zod";

import { ok, fail, table } from "../result";
import { requireConfirm } from "../safety";
import { aiFieldsToFormFields, normalizePubkeyList } from "./shared";
import type { ToolEntry } from "./types";

// ... unchanged helpers: optionShape, fieldShape, formNaddr, npub, renderField ...

export const formsTools: ToolEntry[] = [
  {
    name: "list_forms",
    description: "List the forms in the user's forms index, with metadata.",
    inputSchema: {},
    handler: async () => {
      // body identical to the old registerTool handler
    },
  },
  // get_form, fetch_form_responses, create_form, import_form_from_naddr ...
  {
    name: "update_form",
    description:
      "Update a form's name, fields, or description (republishes it). Requires confirm:true.",
    inputSchema: {
      formId: z.string(),
      formPubkey: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      fields: z.array(fieldShape).optional(),
      confirm: z.boolean().optional(),
    },
    write: true,
    handler: async ({ formId, formPubkey, name, description, fields, confirm }) => {
      // body identical
    },
  },
  // share_form (write), delete_form (write), submit_form_response (write) ...
];
```

- [ ] **Step 3: Port the forms test to the registry shape**

Move + adapt the test:

```bash
git mv packages/mcp/test/forms.test.ts packages/agent/test/forms.test.ts
```

In `packages/agent/test/forms.test.ts`:

- `vi.mock("@formstr/app/services", …)` → `vi.mock("../src/services", …)` (and the `import { forms } from "@formstr/app/services"` → `from "../src/services"`).
- Replace the `fakeServer()` + `registerForms` pattern with registry lookup + `ToolCtx`:

```ts
import { formsTools } from "../src/tools/forms";
import type { ToolCtx } from "../src/tools/types";

const byName = (name: string) => formsTools.find((t) => t.name === name)!;
const RW: ToolCtx = { allowWrites: true };

// registration/gating assertion becomes a `write` + filter check:
it("marks reads/creates as non-write and destructive tools as write", () => {
  expect(byName("list_forms").write).toBeFalsy();
  expect(byName("create_form").write).toBeFalsy();
  expect(byName("delete_form").write).toBe(true);
  expect(byName("submit_form_response").write).toBe(true);
});

it("create_form creates the form", async () => {
  (forms.createForm as any).mockResolvedValue({
    formId: "abc",
    pubkey: "pk",
    signingKey: "sk",
    viewKey: "vk",
  });
  const res = await byName("create_form").handler(
    { name: "Survey", fields: [{ label: "Q1", type: "shortText" }], encrypted: true },
    RW,
  );
  expect(forms.createForm).toHaveBeenCalledOnce();
  expect(res.ok).toBe(true);
  expect((res.data as any).formId).toBe("abc");
});

it("delete_form requires confirm", async () => {
  const res = await byName("delete_form").handler({ formId: "f", formPubkey: "p" }, RW);
  expect(res.ok).toBe(false);
  expect(res.text).toMatch(/confirm/i);
});
```

> Assertion swaps from the old CallToolResult shape: `res.isError` (falsy) → `res.ok === true`; `res.structuredContent.X` → `(res.data as any).X`.

- [ ] **Step 4: Run forms tests + typecheck**

Run: `pnpm --filter @formstr/agent test forms && pnpm --filter @formstr/agent typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): forms tool registry (converted from mcp)"
```

---

## Task 7: Convert calendar, pages, polls, drive tools

Apply the **exact same transform as Task 6** to each module. For each: `git mv packages/mcp/src/tools/<m>.ts packages/agent/src/tools/<m>.ts` and `git mv packages/mcp/test/<m>.test.ts packages/agent/test/<m>.test.ts`, fix imports (`@formstr/app/services` → `../services`; add `ToolEntry`; drop `McpServer`), and replace `registerX(server, ctx)` with `export const <m>Tools: ToolEntry[]`.

The `write: true` set per module = every tool defined after that module's `if (!ctx.allowWrites) return;` boundary. Cross-check against `GATED_TOOLS` for the confirm subset (handlers already call `requireConfirm`):

- [ ] **Step 1: calendar** (`calendarTools`, 19 tools). Reads/creates non-write; `write: true` for the mutating set, which includes the gated `delete_calendar_event`, `update_calendar_event`, `attach_form_to_event`, `rsvp_event`. Port `calendar.test.ts`. Run: `pnpm --filter @formstr/agent test calendar` → PASS. Commit `feat(agent): calendar tool registry`.
- [ ] **Step 2: pages** (`pagesTools`, 10 tools). Gated writes: `delete_page`, `share_page`. Port `pages.test.ts`. Run test → PASS. Commit `feat(agent): pages tool registry`.
- [ ] **Step 3: polls** (`pollsTools`, 8 tools). Gated writes: `delete_poll`, `clear_my_vote`, `submit_poll_response`. Port `polls.test.ts`. Run test → PASS. Commit `feat(agent): polls tool registry`.
- [ ] **Step 4: drive** (`driveTools`, 5 tools). Gated writes: `delete_file`, `rename_file`, `move_file`. Port `drive.test.ts`. Run test → PASS. Commit `feat(agent): drive tool registry`.
- [ ] **Step 5: Full agent suite + typecheck**

Run: `pnpm --filter @formstr/agent test && pnpm --filter @formstr/agent typecheck`
Expected: PASS (all moved service tests + result/safety/shared + 5 tool suites).

---

## Task 8: Aggregate the registry + agent barrel

**Files:**

- Create: `packages/agent/src/tools/index.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Create `packages/agent/src/tools/index.ts`**

```ts
import { calendarTools } from "./calendar";
import { driveTools } from "./drive";
import { formsTools } from "./forms";
import { pagesTools } from "./pages";
import { pollsTools } from "./polls";
import type { ToolEntry } from "./types";

export const toolRegistry: ToolEntry[] = [
  ...formsTools,
  ...calendarTools,
  ...pagesTools,
  ...pollsTools,
  ...driveTools,
];

export type { ToolEntry, ToolCtx } from "./types";
```

- [ ] **Step 2: Populate `packages/agent/src/index.ts`**

```ts
export { toolRegistry } from "./tools";
export type { ToolEntry, ToolCtx } from "./tools/types";
export type { ToolResult } from "./result";
export { ok, fail, table } from "./result";
export { GATED_TOOLS, isGated, requireConfirm } from "./safety";
```

- [ ] **Step 3: Write a registry-count test**

`packages/agent/test/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toolRegistry } from "../src/tools";

describe("toolRegistry", () => {
  it("exposes all 51 tools with unique names", () => {
    expect(toolRegistry).toHaveLength(51);
    expect(new Set(toolRegistry.map((t) => t.name)).size).toBe(51);
  });
  it("every entry has a description and inputSchema", () => {
    for (const t of toolRegistry) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeTypeOf("object");
    }
  });
});
```

- [ ] **Step 4: Run it**

Run: `pnpm --filter @formstr/agent test registry`
Expected: PASS (length 51). If the count differs, a tool was dropped during conversion — diff against `git show HEAD~:packages/mcp/src/tools/<m>.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agent): aggregate toolRegistry + package barrel"
```

---

## Task 9: Rewire `@formstr/mcp` as a thin adapter

**Files:**

- Modify: `packages/mcp/src/server.ts`
- Modify: `packages/mcp/package.json`
- Delete: `packages/mcp/src/result.ts`, `packages/mcp/src/safety.ts`, `packages/mcp/src/tools/` (now in agent)

- [ ] **Step 1: Rewrite `packages/mcp/src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toolRegistry, type ToolCtx, type ToolResult } from "@formstr/agent";

function adapt(r: ToolResult): CallToolResult {
  return {
    content: [{ type: "text", text: r.text }],
    ...(r.data !== undefined ? { structuredContent: r.data as Record<string, unknown> } : {}),
    ...(r.ok ? {} : { isError: true }),
  };
}

export function buildServer(ctx: ToolCtx): McpServer {
  const server = new McpServer({ name: "formstr", version: "0.0.1" });
  for (const t of toolRegistry) {
    if (t.write && !ctx.allowWrites) continue;
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.inputSchema },
      async (args: unknown) => adapt(await t.handler(args, ctx)),
    );
  }
  return server;
}

export async function startStdio(ctx: ToolCtx): Promise<void> {
  const server = buildServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

> `RegisterCtx` is replaced by `ToolCtx` (same `{ allowWrites }` shape). If `index.ts` or others import `RegisterCtx` from `./tools/shared`, update them to `import type { ToolCtx } from "@formstr/agent"`.

- [ ] **Step 2: Delete the moved files + fix any dangling imports**

```bash
git rm packages/mcp/src/result.ts packages/mcp/src/safety.ts
git rm -r packages/mcp/src/tools
grep -rn "src/tools\|./result\|./safety\|RegisterCtx\|@formstr/app" packages/mcp/src
```

Fix every hit from the grep (point to `@formstr/agent`). Expected remaining: none referencing the deleted paths or `@formstr/app`.

- [ ] **Step 3: Update `packages/mcp/package.json` deps**

Remove `"@formstr/app": "workspace:*"`; add `"@formstr/agent": "workspace:*"`. Keep `@formstr/core`, MCP SDK, keyring, ws, qrcode, zod.

- [ ] **Step 4: Reinstall + typecheck mcp**

Run: `pnpm install && pnpm --filter @formstr/mcp typecheck`
Expected: PASS, and mcp no longer resolves `@formstr/app`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(mcp): thin stdio adapter over @formstr/agent registry (drop @formstr/app dep)"
```

---

## Task 10: MCP adapter smoke test + tsup bundle config

**Files:**

- Modify: `packages/mcp/test/smoke.test.ts`
- Modify: `packages/mcp/tsup.config.ts` (or `tsup` field) — bundle workspace deps for publish

- [ ] **Step 1: Add a `buildServer` smoke test**

Append to `packages/mcp/test/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server";

describe("buildServer", () => {
  it("registers fewer tools in read-only mode than with writes", () => {
    const ro = buildServer({ allowWrites: false });
    const rw = buildServer({ allowWrites: true });
    const count = (s: any) => Object.keys(s._registeredTools ?? {}).length;
    expect(count(rw)).toBeGreaterThan(count(ro));
    expect(count(rw)).toBe(51);
  });
});
```

> If `_registeredTools` is not accessible on `McpServer`, assert indirectly by listing via the SDK's `Client` over `InMemoryTransport`, or expose the count from `buildServer`. Verify the internal name first: `grep -rn "registeredTools\|_registeredTools" node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js | head`.

- [ ] **Step 2: Configure tsup to bundle workspace deps (publishable standalone)**

In `packages/mcp/tsup.config.ts` set `noExternal: [/^@formstr\//]` so `@formstr/agent` + `@formstr/core` are inlined into `dist`:

```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node18",
  noExternal: [/^@formstr\//],
  clean: true,
});
```

> Keeps `@napi-rs/keyring`, `ws`, `qrcode`, MCP SDK as normal external runtime deps; only the private `@formstr/*` packages are inlined. (Decision per spec §3.7 default: bundle standalone.) Move `@formstr/agent`/`@formstr/core` to `devDependencies` so the published manifest carries no unresolvable `@formstr/*` runtime deps.

- [ ] **Step 3: Run mcp tests + build**

Run: `pnpm --filter @formstr/mcp test && pnpm --filter @formstr/mcp build`
Expected: tests PASS; `dist/index.js` builds with no `@formstr/*` import left (spot check: `grep -c "@formstr" packages/mcp/dist/index.js` → `0`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(mcp): buildServer smoke + tsup standalone bundle config"
```

---

## Task 11: Whole-repo green gate

- [ ] **Step 1: Install, typecheck, test, build across the workspace**

Run:

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

Expected: all PASS. Test counts: the ~9 service suites + result/safety/shared + 5 tool suites + registry now run under `@formstr/agent`; `@formstr/mcp` keeps `bootstrap/config/credential/keystore/loginServer/smoke`; `@formstr/app` unchanged minus the moved service tests.

- [ ] **Step 2: Manual stdio smoke (external-client parity)**

Run: `node packages/mcp/dist/index.js whoami` (or `pnpm --filter @formstr/mcp dev whoami`)
Expected: prints the signed-in identity (auth path unchanged). Optionally start the server and confirm it lists 51 tools with writes enabled.

- [ ] **Step 3: Final commit (if Step 1 reformatted anything via hooks)**

```bash
git add -A
git commit -m "chore: Stage 0 green gate (agent extraction complete)" --allow-empty
```

---

## Self-review checklist (run before handing off to execution)

- **Spec coverage:** §4.1 (`@formstr/agent`, neutral `ToolResult`, `ToolEntry`, two-gate model) → Tasks 1,4,5,6,7,8. §4.2 (mcp thin adapter, drop `@formstr/app`, publishable) → Tasks 9,10. §6 Stage 0 ("no behavior change", green gate, stdio still serves 51 tools) → Task 11. §7 (port tool tests to agent) → Tasks 4–8.
- **No behavior change:** handlers moved verbatim; only result type + import paths change; mcp re-maps to `CallToolResult`. ✓
- **Deferred items honored:** publishing = bundle standalone (Task 10.2); the `@formstr/app/services` shim was dropped in favour of an import rewrite (Task 3) because the app uses deep relative service imports, not the barrel — note this supersedes the spec §9 "shim" default.
