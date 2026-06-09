# AI Orchestration — Stage 1 (Agent Runtime + Confirmation UX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's bespoke single-round `IntentRouter` (+ its hand-written `tools.ts` and the dead `actionDispatcher.ts` stub) with a provider-agnostic **multi-step tool-use agent** that drives the already-extracted `@formstr/agent` 51-tool registry, can chain tool calls across modules in one message, and intercepts irreversible (gated) tools with an inline confirmation card before executing them.

**Architecture:** A new `packages/app/src/ai/agent.ts` runs a `[system, …history, user]` → `provider.generateStream(messages, tools)` loop (cap `MAX_STEPS = 8`). Tool JSON-schemas come from a new `getToolSchemas()` in `@formstr/agent` (zod → JSON-schema, cached). Each emitted tool call executes against `toolRegistry` with `ctx = { allowWrites: true }`; calls whose name `isGated()` first run a no-op confirm-preview (`requireConfirm` short-circuits), surface the effect text in a `ConfirmActionCard`, and only run for real (`confirm: true`) on Approve. Tool results map to `EntityRef`s app-side for entity cards and feed back into the loop. Stage 1 runs on the **existing** `OllamaProvider` / `CloudLLMProvider`; the full provider set + BYOK is Stage 2.

**Tech Stack:** pnpm workspaces, TypeScript (ESM, `moduleResolution: bundler`), zod + `zod-to-json-schema`, zustand, React + MUI + lucide-react, vitest. Reference: spec `docs/superpowers/specs/2026-06-07-ai-orchestration-design.md` §4.3 (agent runtime), §4.6 (UI), §5 (data flow), §6 (Stage 1), §7 (testing).

---

## File structure (what Stage 1 creates / modifies / deletes)

**New (`@formstr/agent`):**

- `packages/agent/src/schema.ts` — `getToolSchemas(): ToolSchema[]` (registry zod shapes → JSON-schema, cached) + `ToolSchema` type.
- `packages/agent/test/schema.test.ts` — derivation tests.

**Modified (`@formstr/agent`):**

- `packages/agent/src/safety.ts` — extract `export const CONFIRM_REQUIRED_PREFIX` and use it in `requireConfirm`'s message (no message change).
- `packages/agent/src/index.ts` — export `getToolSchemas`, `ToolSchema`, `CONFIRM_REQUIRED_PREFIX`.
- `packages/agent/package.json` — add `zod-to-json-schema` dependency.
- `packages/agent/test/safety.test.ts` — assert `requireConfirm` output starts with `CONFIRM_REQUIRED_PREFIX`.

**New (`@formstr/app`):**

- `packages/app/src/ai/toolSchemas.ts` — `buildToolDefinitions(): ToolDefinition[]` (agent schemas → OpenAI-style tool defs the existing providers consume).
- `packages/app/src/ai/entityMap.ts` — `entityFromTool(name, args, data): EntityRef | null`.
- `packages/app/src/ai/agent.ts` — the `Agent` class (multi-step loop + gated confirm + text-JSON fallback). Replaces `intentRouter.ts`.
- `packages/app/src/ai/toolSchemas.test.ts`, `entityMap.test.ts`, `agent.test.ts` — logic tests.
- `packages/app/src/stores/aiStore.test.ts` — store confirm-wiring + run-finalization (mocks `../ai`).
- `packages/app/src/components/ai/ConfirmActionCard.tsx` — inline gated-action confirm card.
- `packages/app/src/components/ai/AgentRunBlock.tsx` — grouped multi-step "run" block.

**Modified (`@formstr/app`):**

- `packages/app/src/ai/types.ts` — relax `ToolDefinition.function.parameters`; add `RunStep`, `RunStepStatus`, `ConfirmRequest`, `AgentCallbacks`.
- `packages/app/src/ai/context.ts` — refresh the capability list in the system prompt.
- `packages/app/src/ai/index.ts` — export `Agent`, `buildToolDefinitions`, `entityFromTool`; drop `IntentRouter`, `toolDefinitions`, `dispatchAction`.
- `packages/app/src/stores/aiPendingStore.ts` — extend `moduleForTool` to cover all 51 tool names.
- `packages/app/src/stores/aiStore.ts` — drive the `Agent`; add `pendingConfirm` + `resolveConfirm` + live `streamingSteps`; persist `run` on assistant messages.
- `packages/app/src/components/ai/MessageBubble.tsx` — render `AgentRunBlock` when a message has `run` steps.
- `packages/app/src/components/ai/AIChatPanel.tsx` — render the live run block + the `ConfirmActionCard`.
- `packages/app/tsconfig.json` — remove the `src/ai/actionDispatcher.ts` exclude.

**Deleted (`@formstr/app`):**

- `packages/app/src/ai/intentRouter.ts`, `packages/app/src/ai/tools.ts`, `packages/app/src/ai/actionDispatcher.ts`.

---

## Task 1: `getToolSchemas()` + `CONFIRM_REQUIRED_PREFIX` in `@formstr/agent`

**Files:**

- Modify: `packages/agent/package.json`
- Create: `packages/agent/src/schema.ts`
- Modify: `packages/agent/src/safety.ts`
- Modify: `packages/agent/src/index.ts`
- Create: `packages/agent/test/schema.test.ts`
- Modify: `packages/agent/test/safety.test.ts`

- [ ] **Step 1: Add the `zod-to-json-schema` dependency**

In `packages/agent/package.json`, add to `dependencies` (version already resolved in `pnpm-lock.yaml` is `3.25.2`):

```json
"zod-to-json-schema": "^3.24.0"
```

Run: `pnpm install`
Expected: completes; `zod-to-json-schema` resolves under `@formstr/agent`.

- [ ] **Step 2: Write the failing schema test**

Create `packages/agent/test/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { getToolSchemas } from "../src/schema";

describe("getToolSchemas", () => {
  const schemas = getToolSchemas();

  it("derives one schema per registry tool (51)", () => {
    expect(schemas).toHaveLength(51);
    expect(new Set(schemas.map((s) => s.name)).size).toBe(51);
  });

  it("every schema has name, description and an object json-schema", () => {
    for (const s of schemas) {
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect((s.parameters as { type?: string }).type).toBe("object");
    }
  });

  it("create_form exposes its zod fields as json-schema properties", () => {
    const cf = schemas.find((s) => s.name === "create_form")!;
    const params = cf.parameters as { properties: Record<string, unknown>; required?: string[] };
    expect(params.properties.name).toBeDefined();
    expect(params.properties.fields).toBeDefined();
    expect(params.required).toContain("name");
  });

  it("does not leak $schema or $ref into tool parameters", () => {
    const json = JSON.stringify(schemas);
    expect(json).not.toContain("$ref");
    expect(json).not.toContain("$schema");
  });
});
```

- [ ] **Step 3: Run it; verify it fails**

Run: `pnpm --filter @formstr/agent test schema`
Expected: FAIL — `Cannot find module '../src/schema'`.

- [ ] **Step 4: Implement `packages/agent/src/schema.ts`**

```ts
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { toolRegistry } from "./tools";

/** A tool's name + description + a JSON-schema object for its parameters. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

let cached: ToolSchema[] | null = null;

/**
 * Derive provider-neutral JSON-schema tool definitions from the registry's
 * zod input shapes. `$refStrategy: "none"` inlines nested objects (LLM tool
 * APIs reject `$ref`); we also strip the `$schema` meta key. Cached — the
 * registry is static for the process lifetime.
 */
export function getToolSchemas(): ToolSchema[] {
  if (cached) return cached;
  cached = toolRegistry.map((t) => {
    const json = zodToJsonSchema(z.object(t.inputSchema), {
      $refStrategy: "none",
    }) as Record<string, unknown>;
    delete json.$schema;
    return { name: t.name, description: t.description, parameters: json };
  });
  return cached;
}
```

- [ ] **Step 5: Extract `CONFIRM_REQUIRED_PREFIX` in `safety.ts`**

In `packages/agent/src/safety.ts`, add the constant above `requireConfirm` and use it in the message (the rendered text is identical — it already begins with this phrase):

```ts
/** Every `requireConfirm` rejection message starts with this — lets callers
 *  (the in-app agent) distinguish a "needs confirmation" preview from a real
 *  validation error without parsing the whole string. */
export const CONFIRM_REQUIRED_PREFIX = "Confirmation required";
```

Then change the `requireConfirm` return to build the message from the constant:

```ts
export function requireConfirm(
  tool: string,
  args: { confirm?: boolean },
  effect: string,
): ToolResult | null {
  if (args.confirm === true) return null;
  return fail(
    `${CONFIRM_REQUIRED_PREFIX} for "${tool}". This action is irreversible and acts on your Nostr identity: ${effect}. Re-call with "confirm": true to proceed.`,
  );
}
```

- [ ] **Step 6: Export the new symbols from the barrel**

In `packages/agent/src/index.ts`, add:

```ts
export { getToolSchemas } from "./schema";
export type { ToolSchema } from "./schema";
export { GATED_TOOLS, isGated, requireConfirm, CONFIRM_REQUIRED_PREFIX } from "./safety";
```

(Replace the existing `export { GATED_TOOLS, isGated, requireConfirm } from "./safety";` line with the one above so `CONFIRM_REQUIRED_PREFIX` is included.)

- [ ] **Step 7: Extend the safety test**

The file already has `import { requireConfirm, isGated, GATED_TOOLS } from "../src/safety";` — add `CONFIRM_REQUIRED_PREFIX` to that existing import line:

```ts
import { requireConfirm, isGated, GATED_TOOLS, CONFIRM_REQUIRED_PREFIX } from "../src/safety";
```

Then append this new `describe` block at the end of `packages/agent/test/safety.test.ts` (do **not** re-import `describe`/`it`/`expect`/`requireConfirm` — they're already imported at the top):

```ts
describe("CONFIRM_REQUIRED_PREFIX", () => {
  it("prefixes every requireConfirm rejection", () => {
    const blocked = requireConfirm("delete_form", {}, "deletes form f1");
    expect(blocked).not.toBeNull();
    expect(blocked!.ok).toBe(false);
    expect(blocked!.text.startsWith(CONFIRM_REQUIRED_PREFIX)).toBe(true);
  });
});
```

- [ ] **Step 8: Run agent tests + typecheck**

Run: `pnpm --filter @formstr/agent test schema safety && pnpm --filter @formstr/agent typecheck`
Expected: PASS (schema 4 tests, safety incl. the 2 new).

- [ ] **Step 9: Commit**

```bash
git add packages/agent/src/schema.ts packages/agent/src/safety.ts packages/agent/src/index.ts packages/agent/package.json packages/agent/test/schema.test.ts packages/agent/test/safety.test.ts pnpm-lock.yaml
git commit -m "feat(agent): getToolSchemas (zod→json-schema) + CONFIRM_REQUIRED_PREFIX"
```

---

## Task 2: App AI types + `buildToolDefinitions()`

**Files:**

- Modify: `packages/app/src/ai/types.ts`
- Create: `packages/app/src/ai/toolSchemas.ts`
- Create: `packages/app/src/ai/toolSchemas.test.ts`

- [ ] **Step 1: Relax `ToolDefinition.parameters` and add agent-runtime types**

In `packages/app/src/ai/types.ts`, change the `ToolDefinition.function.parameters` field from the strict `ToolParameter` object to a generic JSON-schema object (the only producer after this stage is `buildToolDefinitions`, and providers just serialize it):

```ts
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
```

Then append these new types at the end of the file:

```ts
export type RunStepStatus = "running" | "success" | "error" | "declined";

export interface RunStep {
  id: string;
  toolName: string;
  module: EntityRef["module"] | null;
  status: RunStepStatus;
  resultText?: string;
  entity?: EntityRef;
}

export interface ConfirmRequest {
  /** matches the triggering tool call id */
  id: string;
  toolName: string;
  module: EntityRef["module"] | null;
  /** human-readable effect text (from the handler's requireConfirm message) */
  message: string;
}

export interface AgentCallbacks {
  onToken: (token: string) => void;
  /** clear the live streaming buffer (e.g. when switching from pre-tool chatter to tool execution) */
  onContentReset?: () => void;
  onStepStart?: (step: RunStep) => void;
  onStepUpdate?: (step: RunStep) => void;
  onEntity?: (entity: EntityRef) => void;
  /** resolve true to run a gated tool, false to decline */
  onConfirmRequired?: (req: ConfirmRequest) => Promise<boolean>;
  onWarning?: (message: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}
```

> `ToolParameter` stays defined (unused after `tools.ts` is deleted in Task 10) — leaving it avoids touching unrelated imports now; it can be pruned later.

- [ ] **Step 2: Write the failing `buildToolDefinitions` test**

Create `packages/app/src/ai/toolSchemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { buildToolDefinitions } from "./toolSchemas";

describe("buildToolDefinitions", () => {
  const defs = buildToolDefinitions();

  it("wraps every registry schema as an OpenAI-style function tool", () => {
    expect(defs.length).toBe(51);
    for (const d of defs) {
      expect(d.type).toBe("function");
      expect(d.function.name).toBeTruthy();
      expect(d.function.description).toBeTruthy();
      expect((d.function.parameters as { type?: string }).type).toBe("object");
    }
  });

  it("includes create_form with its parameters", () => {
    const cf = defs.find((d) => d.function.name === "create_form")!;
    expect(
      (cf.function.parameters as { properties: Record<string, unknown> }).properties.name,
    ).toBeDefined();
  });

  it("returns a stable cached array", () => {
    expect(buildToolDefinitions()).toBe(defs);
  });
});
```

- [ ] **Step 3: Run it; verify it fails**

Run: `pnpm --filter @formstr/app test -- toolSchemas`
Expected: FAIL — `Cannot find module './toolSchemas'`.

- [ ] **Step 4: Implement `packages/app/src/ai/toolSchemas.ts`**

```ts
import { getToolSchemas } from "@formstr/agent";

import type { ToolDefinition } from "./types";

let cached: ToolDefinition[] | null = null;

/** The registry tools as OpenAI-style function definitions for the LLM providers. */
export function buildToolDefinitions(): ToolDefinition[] {
  if (cached) return cached;
  cached = getToolSchemas().map((s) => ({
    type: "function" as const,
    function: { name: s.name, description: s.description, parameters: s.parameters },
  }));
  return cached;
}
```

- [ ] **Step 5: Run it; verify it passes**

Run: `pnpm --filter @formstr/app test -- toolSchemas`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/ai/types.ts packages/app/src/ai/toolSchemas.ts packages/app/src/ai/toolSchemas.test.ts
git commit -m "feat(app): tool-schema derivation + agent-runtime types"
```

---

## Task 3: `entityFromTool()` result → entity-card mapper

**Files:**

- Create: `packages/app/src/ai/entityMap.ts`
- Create: `packages/app/src/ai/entityMap.test.ts`

- [ ] **Step 1: Write the failing mapper test**

Create `packages/app/src/ai/entityMap.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { entityFromTool } from "./entityMap";

describe("entityFromTool", () => {
  it("maps create_form to a forms entity using the naddr", () => {
    const e = entityFromTool(
      "create_form",
      { name: "Survey" },
      { naddr: "naddr1abc", formId: "f1" },
    );
    expect(e).toEqual({ module: "forms", ref: "naddr1abc", label: "Survey", route: "/forms" });
  });

  it("maps create_calendar_event using eventId, then coordinate fallback", () => {
    expect(
      entityFromTool(
        "create_calendar_event",
        { title: "Lunch" },
        { eventId: "e1", coordinate: "31923:pk:e1" },
      ),
    ).toEqual({ module: "calendar", ref: "e1", label: "Lunch", route: "/calendar" });
    expect(entityFromTool("update_calendar_event", {}, { coordinate: "31923:pk:e9" })).toEqual({
      module: "calendar",
      ref: "31923:pk:e9",
      label: "31923:pk:e9",
      route: "/calendar",
    });
  });

  it("maps create_page / save_private_note to a pages entity via address", () => {
    expect(
      entityFromTool("save_private_note", { title: "Note" }, { address: "30023:pk:n1" }),
    ).toEqual({ module: "pages", ref: "30023:pk:n1", label: "Note", route: "/pages" });
  });

  it("maps create_poll to a polls entity via id", () => {
    expect(entityFromTool("create_poll", { question: "Lunch?" }, { id: "p1" })).toEqual({
      module: "polls",
      ref: "p1",
      label: "Lunch?",
      route: "/polls",
    });
  });

  it("returns null for reads and deletes", () => {
    expect(entityFromTool("list_forms", {}, { forms: [] })).toBeNull();
    expect(entityFromTool("delete_poll", { pollId: "p1" }, undefined)).toBeNull();
  });

  it("returns null when the data lacks a usable ref", () => {
    expect(entityFromTool("create_form", { name: "X" }, {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `pnpm --filter @formstr/app test -- entityMap`
Expected: FAIL — `Cannot find module './entityMap'`.

- [ ] **Step 3: Implement `packages/app/src/ai/entityMap.ts`**

```ts
import type { EntityRef } from "./types";

type Dict = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Map a successful tool result to an EntityRef for the AI panel's entity cards.
 * Only constructive / updating tools produce a navigable entity; reads and
 * deletes return null. `route` is app-routing (lives here, not in the shared
 * registry). Returns null when no usable reference is present.
 */
export function entityFromTool(name: string, args: Dict, data: unknown): EntityRef | null {
  const d = (data ?? {}) as Dict;
  const a = (args ?? {}) as Dict;

  switch (name) {
    case "create_form":
    case "import_form_from_naddr":
    case "update_form": {
      const ref = str(d.naddr);
      if (!ref) return null;
      return { module: "forms", ref, label: str(a.name) ?? ref, route: "/forms" };
    }
    case "create_calendar_event":
    case "update_calendar_event":
    case "attach_form_to_event": {
      const ref = str(d.eventId) ?? str(d.coordinate) ?? str(d.id);
      if (!ref) return null;
      return { module: "calendar", ref, label: str(a.title) ?? ref, route: "/calendar" };
    }
    case "create_calendar":
    case "update_calendar": {
      const ref = str(d.id);
      if (!ref) return null;
      return { module: "calendar", ref, label: str(a.title) ?? ref, route: "/calendar" };
    }
    case "create_page":
    case "save_private_note":
    case "update_page": {
      const ref = str(d.address);
      if (!ref) return null;
      return { module: "pages", ref, label: str(a.title) ?? ref, route: "/pages" };
    }
    case "create_poll": {
      const ref = str(d.id);
      if (!ref) return null;
      return { module: "polls", ref, label: str(a.question) ?? ref, route: "/polls" };
    }
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `pnpm --filter @formstr/app test -- entityMap`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/ai/entityMap.ts packages/app/src/ai/entityMap.test.ts
git commit -m "feat(app): map tool results to entity-card refs"
```

---

## Task 4: Make `moduleForTool` exhaustive (all 51 tools)

`AgentRunBlock` and `ToolCallChip` color/group steps by `moduleForTool(name)`; today it only covers the old 19-tool subset, so most registry tools would render as a generic wrench. Extend it.

**Files:**

- Modify: `packages/app/src/stores/aiPendingStore.ts`
- Create: `packages/app/src/stores/aiPendingStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/stores/aiPendingStore.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { moduleForTool } from "./aiPendingStore";

describe("moduleForTool", () => {
  it("classifies a representative tool from each module", () => {
    expect(moduleForTool("create_form")).toBe("forms");
    expect(moduleForTool("submit_form_response")).toBe("forms");
    expect(moduleForTool("create_calendar_event")).toBe("calendar");
    expect(moduleForTool("list_booking_requests")).toBe("calendar");
    expect(moduleForTool("rsvp_event")).toBe("calendar");
    expect(moduleForTool("create_page")).toBe("pages");
    expect(moduleForTool("set_page_tags")).toBe("pages");
    expect(moduleForTool("create_poll")).toBe("polls");
    expect(moduleForTool("clear_my_vote")).toBe("polls");
    expect(moduleForTool("browse_files")).toBe("drive");
    expect(moduleForTool("rename_file")).toBe("drive");
  });

  it("returns null for an unknown tool", () => {
    expect(moduleForTool("does_not_exist")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `pnpm --filter @formstr/app test -- aiPendingStore`
Expected: FAIL — e.g. `list_booking_requests` / `rename_file` / `set_page_tags` return `null`.

- [ ] **Step 3: Replace `moduleForTool` with a name-set classifier**

In `packages/app/src/stores/aiPendingStore.ts`, replace the entire `moduleForTool` function (keep the doc comment) with:

```ts
const FORMS_TOOLS = new Set([
  "list_forms",
  "get_form",
  "fetch_form_responses",
  "create_form",
  "import_form_from_naddr",
  "update_form",
  "share_form",
  "delete_form",
  "submit_form_response",
]);

const CALENDAR_TOOLS = new Set([
  "list_calendar_events",
  "get_calendar_event",
  "create_calendar_event",
  "update_calendar_event",
  "delete_calendar_event",
  "delete_event",
  "update_event",
  "attach_form_to_event",
  "rsvp_event",
  "fetch_event_rsvps",
  "list_invitations",
  "list_scheduling_pages",
  "list_booking_requests",
  "approve_booking",
  "decline_booking",
  "list_calendars",
  "create_calendar",
  "update_calendar",
  "delete_calendar",
  "add_event_to_calendar",
  "remove_event_from_calendar",
]);

const PAGES_TOOLS = new Set([
  "list_pages",
  "get_page",
  "create_page",
  "update_page",
  "delete_page",
  "save_private_note",
  "share_page",
  "list_shared_pages",
  "get_page_tags",
  "set_page_tags",
]);

const POLLS_TOOLS = new Set([
  "list_polls",
  "list_recent_polls",
  "get_poll",
  "create_poll",
  "delete_poll",
  "submit_poll_response",
  "clear_my_vote",
  "fetch_poll_results",
]);

const DRIVE_TOOLS = new Set([
  "browse_files",
  "get_file_info",
  "delete_file",
  "rename_file",
  "move_file",
]);

/**
 * Map a tool name to the module it belongs to, so the AI panel can color/group
 * steps and flip per-module pending flags without a giant switch.
 */
export function moduleForTool(toolName: string): AIModule | null {
  if (FORMS_TOOLS.has(toolName)) return "forms";
  if (CALENDAR_TOOLS.has(toolName)) return "calendar";
  if (PAGES_TOOLS.has(toolName)) return "pages";
  if (POLLS_TOOLS.has(toolName)) return "polls";
  if (DRIVE_TOOLS.has(toolName)) return "drive";
  return null;
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `pnpm --filter @formstr/app test -- aiPendingStore`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/stores/aiPendingStore.ts packages/app/src/stores/aiPendingStore.test.ts
git commit -m "feat(app): exhaustive moduleForTool over the 51-tool registry"
```

---

## Task 5: Agent core — multi-step loop + non-gated execution + entities + MAX_STEPS

**Files:**

- Create: `packages/app/src/ai/agent.ts`
- Create: `packages/app/src/ai/agent.test.ts`

This task builds the loop with tools running **directly** (no confirm gate yet — gated handlers would simply return their "needs confirm" `ToolResult` as a step result; the tests here avoid gated tools). Tasks 6 and 7 add the confirm gate and the text-JSON fallback.

- [ ] **Step 1: Write the failing agent-core test**

Create `packages/app/src/ai/agent.test.ts`. It mocks `@formstr/agent` so handler outcomes are fully controlled, and a `FakeProvider` scripts each `generateStream` round:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

import type {
  AgentCallbacks,
  GenerateOptions,
  LLMProvider,
  Message,
  StreamCallbacks,
  ToolCall,
  ToolDefinition,
} from "./types";

// ── Mock the shared registry so tools are deterministic ──────────────────
const handlerSpies = {
  create_poll: vi.fn(async () => ({ ok: true, text: "Created poll.", data: { id: "p1" } })),
  create_calendar_event: vi.fn(async () => ({
    ok: true,
    text: "Created event.",
    data: { eventId: "e1" },
  })),
  list_polls: vi.fn(async () => ({ ok: true, text: "0 polls.", data: { polls: [] } })),
};

vi.mock("@formstr/agent", () => {
  const registry = [
    {
      name: "create_poll",
      description: "Create a poll",
      inputSchema: {},
      write: false,
      handler: handlerSpies.create_poll,
    },
    {
      name: "create_calendar_event",
      description: "Create event",
      inputSchema: {},
      write: false,
      handler: handlerSpies.create_calendar_event,
    },
    {
      name: "list_polls",
      description: "List polls",
      inputSchema: {},
      handler: handlerSpies.list_polls,
    },
    {
      name: "delete_poll",
      description: "Delete a poll",
      inputSchema: {},
      write: true,
      handler: vi.fn(),
    },
  ];
  return {
    toolRegistry: registry,
    isGated: (n: string) => n === "delete_poll",
    CONFIRM_REQUIRED_PREFIX: "Confirmation required",
    getToolSchemas: () =>
      registry.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: { type: "object", properties: {} },
      })),
  };
});

import { Agent } from "./agent";
import { ConversationContext } from "./context";

// ── A scriptable provider ────────────────────────────────────────────────
type Scripted = {
  text?: string;
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
};

class FakeProvider implements LLMProvider {
  rounds: Scripted[];
  calls = 0;
  constructor(rounds: Scripted[]) {
    this.rounds = rounds;
  }
  async isAvailable() {
    return true;
  }
  async getAvailableModels() {
    return ["fake"];
  }
  async generate() {
    return { content: "" };
  }
  async generateStream(
    _messages: Message[],
    _tools: ToolDefinition[],
    cb: StreamCallbacks,
    _options?: GenerateOptions,
  ): Promise<void> {
    const round = this.rounds[this.calls] ?? {};
    this.calls += 1;
    if (round.text) cb.onToken(round.text);
    for (const tc of round.toolCalls ?? []) {
      cb.onToolCall?.({ id: crypto.randomUUID(), name: tc.name, arguments: tc.arguments ?? {} });
    }
    cb.onDone();
  }
}

function collectCallbacks(over: Partial<AgentCallbacks> = {}) {
  const tokens: string[] = [];
  const steps: Array<{ toolName: string; status: string }> = [];
  const entities: string[] = [];
  let done = false;
  let error: Error | null = null;
  const cb: AgentCallbacks = {
    onToken: (t) => tokens.push(t),
    onStepStart: (s) => steps.push({ toolName: s.toolName, status: s.status }),
    onStepUpdate: (s) => steps.push({ toolName: s.toolName, status: s.status }),
    onEntity: (e) => entities.push(e.ref),
    onDone: () => {
      done = true;
    },
    onError: (e) => {
      error = e;
    },
    ...over,
  };
  return {
    cb,
    tokens,
    steps,
    entities,
    get done() {
      return done;
    },
    get error() {
      return error;
    },
  };
}

describe("Agent (core loop)", () => {
  beforeEach(() => {
    Object.values(handlerSpies).forEach((s) => s.mockClear());
  });

  it("answers without tools when the model emits only text", async () => {
    const agent = new Agent(
      new FakeProvider([{ text: "Hello there." }]),
      new ConversationContext(),
    );
    const c = collectCallbacks();
    await agent.run("hi", "pk", c.cb);
    expect(c.tokens.join("")).toBe("Hello there.");
    expect(c.done).toBe(true);
    expect(handlerSpies.create_poll).not.toHaveBeenCalled();
  });

  it("executes a single tool call then concludes on the next round", async () => {
    const provider = new FakeProvider([
      { toolCalls: [{ name: "create_poll", arguments: { question: "Lunch?" } }] },
      { text: "Done — created your poll." },
    ]);
    const agent = new Agent(provider, new ConversationContext());
    const c = collectCallbacks();
    await agent.run("make a poll", "pk", c.cb);
    expect(handlerSpies.create_poll).toHaveBeenCalledOnce();
    expect(c.entities).toContain("p1"); // entity mapped from data.id
    expect(c.steps.some((s) => s.toolName === "create_poll" && s.status === "success")).toBe(true);
    expect(c.tokens.join("")).toContain("Done");
    expect(c.done).toBe(true);
  });

  it("chains tool calls across modules in one run", async () => {
    const provider = new FakeProvider([
      {
        toolCalls: [
          { name: "create_poll", arguments: { question: "Lunch?" } },
          {
            name: "create_calendar_event",
            arguments: { title: "Lunch", start: "2026-06-10T12:00:00Z" },
          },
        ],
      },
      { text: "Created the poll and the event." },
    ]);
    const agent = new Agent(provider, new ConversationContext());
    const c = collectCallbacks();
    await agent.run("poll + event", "pk", c.cb);
    expect(handlerSpies.create_poll).toHaveBeenCalledOnce();
    expect(handlerSpies.create_calendar_event).toHaveBeenCalledOnce();
    expect(c.entities).toEqual(["p1", "e1"]);
  });

  it("stops after MAX_STEPS when the model never concludes", async () => {
    // Every round asks for another tool call → would loop forever without the cap.
    const provider = new FakeProvider(
      Array.from({ length: 20 }, () => ({ toolCalls: [{ name: "list_polls" }] })),
    );
    const agent = new Agent(provider, new ConversationContext());
    let warned = "";
    const c = collectCallbacks({ onWarning: (m) => (warned = m) });
    await agent.run("loop forever", "pk", c.cb);
    expect(provider.calls).toBeLessThanOrEqual(8);
    expect(warned).toMatch(/stopped/i);
    expect(c.done).toBe(true);
  });

  it("reports a thrown handler as an error step, not a crash", async () => {
    handlerSpies.create_poll.mockRejectedValueOnce(new Error("relay down"));
    const provider = new FakeProvider([
      { toolCalls: [{ name: "create_poll", arguments: {} }] },
      { text: "Sorry, that failed." },
    ]);
    const agent = new Agent(provider, new ConversationContext());
    const c = collectCallbacks();
    await agent.run("make a poll", "pk", c.cb);
    expect(c.steps.some((s) => s.toolName === "create_poll" && s.status === "error")).toBe(true);
    expect(c.error).toBeNull();
    expect(c.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `pnpm --filter @formstr/app test -- agent`
Expected: FAIL — `Cannot find module './agent'`.

- [ ] **Step 3: Implement `packages/app/src/ai/agent.ts`**

> Task 5 imports only what it uses (`toolRegistry` + types). Task 6 adds `isGated`/`CONFIRM_REQUIRED_PREFIX` and the `DECLINED_TEXT` constant when the confirm gate needs them — the app tsconfig has `noUnusedLocals`, so don't import them early.

```ts
import { toolRegistry, type ToolCtx, type ToolResult } from "@formstr/agent";

import { moduleForTool, useAIPendingStore } from "../stores/aiPendingStore";

import type { ConversationContext } from "./context";
import { entityFromTool } from "./entityMap";
import { buildToolDefinitions } from "./toolSchemas";
import type {
  AgentCallbacks,
  LLMProvider,
  Message,
  RunStep,
  RunStepStatus,
  ToolCall,
} from "./types";

const MAX_STEPS = 8;

function msg(role: Message["role"], content: string, toolCallId?: string): Message {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now(), toolCallId };
}

/**
 * Provider-agnostic multi-step tool-use agent. Each iteration streams one
 * assistant turn from the provider; if it requests tools we run them against
 * the @formstr/agent registry (with allowWrites — the user's own session),
 * feed the results back, and loop so the model can chain further calls across
 * modules. Stops at a final text answer or MAX_STEPS.
 */
export class Agent {
  private provider: LLMProvider;
  private context: ConversationContext;
  private readonly ctx: ToolCtx = { allowWrites: true };

  constructor(provider: LLMProvider, context: ConversationContext) {
    this.provider = provider;
    this.context = context;
  }

  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  resetContext(): void {
    this.context.reset();
  }

  async run(
    userMessage: string,
    pubkey: string | null,
    cb: AgentCallbacks,
    model?: string,
  ): Promise<void> {
    this.context.addMessage(msg("user", userMessage));
    const system = this.context.buildSystemPrompt(pubkey);
    const tools = buildToolDefinitions();

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const messages: Message[] = [msg("system", system), ...this.context.getMessages()];
        const { text, toolCalls } = await this.runStep(messages, tools, model, cb.onToken);

        if (toolCalls.length === 0) {
          if (text.trim()) this.context.addMessage(msg("assistant", text));
          cb.onDone();
          return;
        }

        // Record the assistant turn (with its tool_calls) so the model sees its
        // own prior calls, then clear the live buffer before executing.
        const assistant = msg("assistant", text || "");
        assistant.toolCalls = toolCalls;
        this.context.addMessage(assistant);
        cb.onContentReset?.();

        for (const tc of toolCalls) {
          await this.executeAndRecord(tc, cb);
        }
      }

      cb.onWarning?.(`Stopped after ${MAX_STEPS} steps to avoid an endless loop.`);
      cb.onDone();
    } catch (e) {
      cb.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /** One provider round → accumulated text + normalized tool calls. */
  private runStep(
    messages: Message[],
    tools: ReturnType<typeof buildToolDefinitions>,
    model: string | undefined,
    onToken: (t: string) => void,
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    return new Promise((resolve, reject) => {
      let text = "";
      const toolCalls: ToolCall[] = [];
      this.provider
        .generateStream(
          messages,
          tools,
          {
            onToken(t) {
              text += t;
              onToken(t);
            },
            onToolCall(tc) {
              toolCalls.push(tc);
            },
            onDone() {
              resolve({ text, toolCalls });
            },
            onError(err) {
              reject(err);
            },
          },
          { model },
        )
        .catch(reject);
    });
  }

  /** Run one tool call, emit step status + entity, and append the tool result to context. */
  private async executeAndRecord(tc: ToolCall, cb: AgentCallbacks): Promise<void> {
    const module = moduleForTool(tc.name);
    const base: RunStep = { id: tc.id, toolName: tc.name, module, status: "running" };
    cb.onStepStart?.(base);

    const pendingId = module ? useAIPendingStore.getState().begin(module, tc.name) : null;
    let result: ToolResult;
    try {
      result = await this.execTool(tc, cb);
    } catch (e) {
      result = { ok: false, text: e instanceof Error ? e.message : "Tool failed." };
    } finally {
      if (pendingId) useAIPendingStore.getState().end(pendingId);
    }

    const entity = result.ok
      ? (entityFromTool(tc.name, tc.arguments, result.data) ?? undefined)
      : undefined;
    if (entity) {
      this.context.registerEntity(entity);
      cb.onEntity?.(entity);
    }

    const status: RunStepStatus = result.ok
      ? "success"
      : result.errorCode === "DECLINED"
        ? "declined"
        : "error";
    cb.onStepUpdate?.({ ...base, status, resultText: result.text, entity });
    this.context.addMessage(msg("tool", result.text, tc.id));
  }

  /** Look up + invoke the registry handler. (Confirm gate added in Task 6.) */
  private async execTool(tc: ToolCall, _cb: AgentCallbacks): Promise<ToolResult> {
    const entry = toolRegistry.find((t) => t.name === tc.name);
    if (!entry) return { ok: false, text: `Unknown tool: ${tc.name}` };
    return entry.handler(tc.arguments, this.ctx);
  }
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `pnpm --filter @formstr/app test -- agent`
Expected: PASS (5 tests). `provider.calls <= 8` confirms the cap.

- [ ] **Step 5: Typecheck the app**

Run: `pnpm --filter @formstr/app typecheck`
Expected: PASS. (`intentRouter.ts`/`tools.ts` still exist and compile; they're deleted in Task 10.)

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/ai/agent.ts packages/app/src/ai/agent.test.ts
git commit -m "feat(app): multi-step tool-use agent core (loop, entities, MAX_STEPS)"
```

---

## Task 6: Agent gated-action confirm gate

Intercept any `isGated` tool **before** executing: run a no-op confirm-preview (the handler's `requireConfirm` short-circuits and returns the effect text), surface it via `onConfirmRequired`, and only run for real (`confirm: true`) on Approve. On Cancel, return a declined result. A non-confirm failure from the preview (a real validation error, e.g. "no recipients") is surfaced as-is without prompting.

**Files:**

- Modify: `packages/app/src/ai/agent.ts` (`execTool`)
- Modify: `packages/app/src/ai/agent.test.ts` (add a `describe` block)

- [ ] **Step 1: Add the failing gated-flow tests**

Append to `packages/app/src/ai/agent.test.ts` (the mock from Task 5 already includes a gated `delete_poll` and `isGated`). First, extend the mock's `delete_poll` handler to mimic `requireConfirm` — update the `vi.mock("@formstr/agent", …)` registry entry for `delete_poll` to this handler:

```ts
// in the vi.mock factory, replace the delete_poll entry's handler:
handler: vi.fn(async (args: { confirm?: boolean }) => {
  if (args.confirm !== true) {
    return { ok: false, text: 'Confirmation required for "delete_poll". ... deletes poll p1.' };
  }
  return { ok: true, text: "Deleted poll p1." };
}),
```

Then append this block at the end of the test file:

```ts
describe("Agent (gated confirm gate)", () => {
  function provider() {
    return new FakeProvider([
      { toolCalls: [{ name: "delete_poll", arguments: { pollId: "p1" } }] },
      { text: "Okay." },
    ]);
  }

  it("requests confirmation and runs the tool with confirm:true on approve", async () => {
    const seen: string[] = [];
    const agent = new Agent(provider(), new ConversationContext());
    const c = collectCallbacks({
      onConfirmRequired: async (req) => {
        seen.push(req.toolName);
        expect(req.message).toMatch(/Confirmation required/);
        return true;
      },
    });
    await agent.run("delete it", "pk", c.cb);
    expect(seen).toEqual(["delete_poll"]);
    expect(c.steps.some((s) => s.toolName === "delete_poll" && s.status === "success")).toBe(true);
  });

  it("does not execute the tool when the user declines", async () => {
    const agent = new Agent(provider(), new ConversationContext());
    const c = collectCallbacks({ onConfirmRequired: async () => false });
    await agent.run("delete it", "pk", c.cb);
    expect(c.steps.some((s) => s.toolName === "delete_poll" && s.status === "declined")).toBe(true);
  });

  it("treats a missing confirm handler as a decline (safe default)", async () => {
    const agent = new Agent(provider(), new ConversationContext());
    const c = collectCallbacks(); // no onConfirmRequired
    await agent.run("delete it", "pk", c.cb);
    expect(c.steps.some((s) => s.toolName === "delete_poll" && s.status === "declined")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it; verify the new tests fail**

Run: `pnpm --filter @formstr/app test -- agent`
Expected: the 3 new tests FAIL (the current `execTool` calls `delete_poll` once without confirm → it returns the "Confirmation required" text as an `error` step, never prompting).

- [ ] **Step 3: Add the confirm gate to `execTool`**

First widen the `@formstr/agent` import (Task 5 imported only `toolRegistry` + types) and add the declined-result constant. Change the import line and add the const below `MAX_STEPS`:

```ts
import {
  toolRegistry,
  isGated,
  CONFIRM_REQUIRED_PREFIX,
  type ToolCtx,
  type ToolResult,
} from "@formstr/agent";
```

```ts
const DECLINED_TEXT = "User declined this action.";
```

Then replace the `execTool` method with:

```ts
  /** Look up + invoke the registry handler, gating irreversible tools behind a confirm. */
  private async execTool(tc: ToolCall, cb: AgentCallbacks): Promise<ToolResult> {
    const entry = toolRegistry.find((t) => t.name === tc.name);
    if (!entry) return { ok: false, text: `Unknown tool: ${tc.name}` };

    if (!isGated(tc.name)) return entry.handler(tc.arguments, this.ctx);

    // Preview: requireConfirm short-circuits before any side effect and returns
    // the effect text. A non-confirm failure here is a real validation error.
    const preview = await entry.handler(tc.arguments, this.ctx);
    if (preview.ok || !preview.text.startsWith(CONFIRM_REQUIRED_PREFIX)) return preview;

    const approved = cb.onConfirmRequired
      ? await cb.onConfirmRequired({
          id: tc.id,
          toolName: tc.name,
          module: moduleForTool(tc.name),
          message: preview.text,
        })
      : false;

    if (!approved) return { ok: false, text: DECLINED_TEXT, errorCode: "DECLINED" };
    return entry.handler({ ...tc.arguments, confirm: true }, this.ctx);
  }
```

- [ ] **Step 4: Run it; verify all agent tests pass**

Run: `pnpm --filter @formstr/app test -- agent`
Expected: PASS (all core + gated tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/ai/agent.ts packages/app/src/ai/agent.test.ts
git commit -m "feat(app): gated-action confirm gate in the agent loop"
```

---

## Task 7: Text-JSON tool-call fallback for local models

Small Ollama models often emit a tool call as plain-text JSON in `content` instead of structured `tool_calls`. Port the extractor from the old router and apply it when a round returns text but no structured calls.

**Files:**

- Modify: `packages/app/src/ai/agent.ts`
- Modify: `packages/app/src/ai/agent.test.ts`

- [ ] **Step 1: Add the failing fallback test**

Append to `packages/app/src/ai/agent.test.ts`:

```ts
describe("Agent (text-JSON tool-call fallback)", () => {
  it("parses a tool call embedded as plain-text JSON", async () => {
    const provider = new FakeProvider([
      { text: '{"name": "create_poll", "parameters": {"question": "Lunch?"}}' },
      { text: "Created your poll." },
    ]);
    const agent = new Agent(provider, new ConversationContext());
    const c = collectCallbacks();
    await agent.run("make a poll", "pk", c.cb);
    expect(handlerSpies.create_poll).toHaveBeenCalledOnce();
    expect(c.entities).toContain("p1");
  });

  it("ignores JSON that is not a known tool", async () => {
    const provider = new FakeProvider([{ text: 'Here is JSON: {"foo": 1} — not a tool.' }]);
    const agent = new Agent(provider, new ConversationContext());
    const c = collectCallbacks();
    await agent.run("hi", "pk", c.cb);
    expect(handlerSpies.create_poll).not.toHaveBeenCalled();
    expect(c.tokens.join("")).toContain("not a tool");
  });
});
```

- [ ] **Step 2: Run it; verify the first test fails**

Run: `pnpm --filter @formstr/app test -- agent`
Expected: the "parses a tool call embedded as plain-text JSON" test FAILS (no structured calls → treated as a final answer; `create_poll` not called).

- [ ] **Step 3: Add the extractor + wire it into `run`**

In `packages/app/src/ai/agent.ts`, add this helper near the top (below `msg`):

````ts
const VALID_TOOL_NAMES = new Set(toolRegistry.map((t) => t.name));

/** Detect tool calls a small model embedded as plain-text JSON in its content. */
function extractTextToolCalls(text: string): ToolCall[] {
  const cleaned = text
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        candidates.push(cleaned.slice(start, i + 1));
        start = -1;
      }
    }
  }

  const calls: ToolCall[] = [];
  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>;
      const fn = (obj.function ?? obj) as Record<string, unknown>;
      const name = typeof fn.name === "string" ? fn.name.toLowerCase() : "";
      const argsRaw = (fn.arguments ?? fn.parameters) as unknown;
      if (VALID_TOOL_NAMES.has(name) && typeof argsRaw === "object" && argsRaw !== null) {
        calls.push({
          id: crypto.randomUUID(),
          name,
          arguments: argsRaw as Record<string, unknown>,
        });
      }
    } catch {
      // not JSON — skip
    }
  }
  return calls;
}
````

Then in `run`, between `runStep` and the `if (toolCalls.length === 0)` check, insert the fallback:

```ts
const { text, toolCalls } = await this.runStep(messages, tools, model, cb.onToken);

let calls = toolCalls;
if (calls.length === 0 && text.includes("{")) {
  const extracted = extractTextToolCalls(text);
  if (extracted.length > 0) {
    calls = extracted;
    cb.onContentReset?.(); // the raw JSON will be replaced by the follow-up answer
  }
}

if (calls.length === 0) {
  if (text.trim()) this.context.addMessage(msg("assistant", text));
  cb.onDone();
  return;
}

const assistant = msg("assistant", text || "");
assistant.toolCalls = calls;
this.context.addMessage(assistant);
cb.onContentReset?.();

for (const tc of calls) {
  await this.executeAndRecord(tc, cb);
}
```

> This replaces the original block that used `toolCalls` directly. Make sure the loop body now references `calls`, not `toolCalls`, after the fallback.

- [ ] **Step 4: Run it; verify all agent tests pass**

Run: `pnpm --filter @formstr/app test -- agent`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/ai/agent.ts packages/app/src/ai/agent.test.ts
git commit -m "feat(app): text-JSON tool-call fallback for local models"
```

---

## Task 8: Rewire `aiStore` to the Agent (confirm state + run steps)

**Files:**

- Modify: `packages/app/src/stores/aiStore.ts`
- Create: `packages/app/src/stores/aiStore.test.ts`

- [ ] **Step 1: Write the failing store test (mock the AI barrel with a scriptable agent)**

Create `packages/app/src/stores/aiStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentCallbacks } from "../ai/types";

// A scriptable fake Agent whose run() drives the callbacks.
let scriptedRun: (cb: AgentCallbacks) => Promise<void>;

vi.mock("../ai", async () => {
  const actual = await vi.importActual<typeof import("../ai")>("../ai");
  class FakeAgent {
    setProvider() {}
    resetContext() {}
    async run(_msg: string, _pk: string | null, cb: AgentCallbacks) {
      await scriptedRun(cb);
    }
  }
  return {
    ...actual,
    Agent: FakeAgent,
    createLLMProvider: vi.fn(async () => ({
      getAvailableModels: async () => ["fake-model"],
      isAvailable: async () => true,
      generate: async () => ({ content: "" }),
      generateStream: async () => {},
    })),
  };
});

import { useAIStore } from "./aiStore";

describe("aiStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAIStore.getState().reset();
  });

  it("streams tokens then finalizes one assistant message", async () => {
    scriptedRun = async (cb) => {
      cb.onToken("Hello ");
      cb.onToken("world.");
      cb.onDone();
    };
    await useAIStore.getState().sendMessage("hi");
    const { messages, isProcessing } = useAIStore.getState();
    expect(isProcessing).toBe(false);
    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant?.content).toBe("Hello world.");
  });

  it("collects run steps onto the assistant message", async () => {
    scriptedRun = async (cb) => {
      cb.onStepStart?.({ id: "1", toolName: "create_poll", module: "polls", status: "running" });
      cb.onStepUpdate?.({
        id: "1",
        toolName: "create_poll",
        module: "polls",
        status: "success",
        resultText: "ok",
      });
      cb.onToken("Done.");
      cb.onDone();
    };
    await useAIStore.getState().sendMessage("make a poll");
    const assistant = useAIStore.getState().messages.find((m) => m.role === "assistant");
    expect(assistant?.run?.[0]).toMatchObject({ toolName: "create_poll", status: "success" });
  });

  it("exposes a pendingConfirm that resolveConfirm unblocks", async () => {
    let approved: boolean | null = null;
    scriptedRun = async (cb) => {
      approved =
        (await cb.onConfirmRequired?.({
          id: "1",
          toolName: "delete_poll",
          module: "polls",
          message: "Confirm?",
        })) ?? null;
      cb.onToken(approved ? "Deleted." : "Cancelled.");
      cb.onDone();
    };
    const send = useAIStore.getState().sendMessage("delete poll");
    // Wait for the agent to reach the confirm point (robust against the async init chain).
    await vi.waitFor(() =>
      expect(useAIStore.getState().pendingConfirm?.toolName).toBe("delete_poll"),
    );
    useAIStore.getState().resolveConfirm(true);
    await send;
    expect(approved).toBe(true);
    expect(useAIStore.getState().pendingConfirm).toBeNull();
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `pnpm --filter @formstr/app test -- aiStore`
Expected: FAIL — `pendingConfirm` / `resolveConfirm` / `run` don't exist yet.

- [ ] **Step 3: Rewrite `aiStore.ts` to drive the Agent**

Apply these changes to `packages/app/src/stores/aiStore.ts`:

1. Update imports:

```ts
import { createLLMProvider, ConversationContext, Agent } from "../ai";
import type { Message, LLMProvider, EntityRef, RunStep, ConfirmRequest } from "../ai/types";
```

2. Replace the `AIStore` interface's `_router` / add new fields:

```ts
interface AIStore {
  messages: Message[];
  entities: EntityRef[];
  isProcessing: boolean;
  streamingContent: string;
  streamingSteps: RunStep[];
  pendingConfirm: (ConfirmRequest & { resolve: (approved: boolean) => void }) | null;
  providerStatus: "disconnected" | "connecting" | "connected" | "error";
  availableModels: string[];
  errorMessage: string | null;

  _provider: LLMProvider | null;
  _context: ConversationContext;
  _agent: Agent | null;

  initProvider(): Promise<void>;
  sendMessage(content: string): Promise<void>;
  resolveConfirm(approved: boolean): void;
  setModel(model: string): void;
  reset(): void;
}
```

3. In the `create<AIStore>` initial state, add `streamingSteps: []`, `pendingConfirm: null`, and rename `_router: null` → `_agent: null`.

4. In `initProvider`, build an `Agent` instead of an `IntentRouter`:

```ts
const agent = new Agent(provider, context);
// ...
set({
  _provider: provider,
  _agent: agent,
  availableModels: models,
  providerStatus: "connected",
});
```

5. Replace `sendMessage` with the agent-driven version:

```ts
  async sendMessage(content: string) {
    if (get().isProcessing) return;

    if (!get()._agent) {
      await get().initProvider();
      if (!get()._agent) {
        set({ errorMessage: "AI provider not available. Check your settings." });
        return;
      }
    }

    const agent = get()._agent!;
    const { aiModel } = useSettingsStore.getState();
    const pubkey = useAuthStore.getState().pubkey;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    };

    set((state) => {
      const msgs = [...state.messages, userMsg];
      persistMessages(msgs);
      return {
        messages: msgs,
        isProcessing: true,
        streamingContent: "",
        streamingSteps: [],
        errorMessage: null,
      };
    });

    let fullContent = "";

    try {
      await agent.run(
        content,
        pubkey,
        {
          onToken(token) {
            fullContent += token;
            set({ streamingContent: fullContent });
          },
          onContentReset() {
            fullContent = "";
            set({ streamingContent: "" });
          },
          onStepStart(step) {
            set((state) => ({ streamingSteps: [...state.streamingSteps, step] }));
          },
          onStepUpdate(step) {
            set((state) => ({
              streamingSteps: state.streamingSteps.map((s) => (s.id === step.id ? step : s)),
            }));
          },
          onEntity(entity) {
            set((state) => {
              const ents = [...state.entities, entity];
              persistEntities(ents);
              return { entities: ents };
            });
          },
          onConfirmRequired(req) {
            return new Promise<boolean>((resolve) => {
              set({ pendingConfirm: { ...req, resolve } });
            });
          },
          onWarning(message) {
            fullContent += `${fullContent ? "\n\n" : ""}_${message}_`;
            set({ streamingContent: fullContent });
          },
          onDone() {
            const steps = get().streamingSteps;
            if (fullContent.trim() || steps.length > 0) {
              const assistantMsg: Message = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: fullContent,
                run: steps.length > 0 ? steps : undefined,
                timestamp: Date.now(),
              };
              set((state) => {
                const msgs = [...state.messages, assistantMsg];
                persistMessages(msgs);
                return {
                  messages: msgs,
                  isProcessing: false,
                  streamingContent: "",
                  streamingSteps: [],
                };
              });
            } else {
              set({ isProcessing: false, streamingContent: "", streamingSteps: [] });
            }
          },
          onError(error) {
            set({
              isProcessing: false,
              streamingContent: "",
              streamingSteps: [],
              pendingConfirm: null,
              errorMessage: error.message,
            });
          },
        },
        aiModel ?? undefined,
      );
    } catch (e) {
      set({
        isProcessing: false,
        streamingContent: "",
        streamingSteps: [],
        pendingConfirm: null,
        errorMessage: e instanceof Error ? e.message : "Failed to process message",
      });
    }
  },

  resolveConfirm(approved: boolean) {
    const pc = get().pendingConfirm;
    if (!pc) return;
    set({ pendingConfirm: null });
    pc.resolve(approved);
  },
```

6. In `reset`, clear the new state and call `get()._context.reset()` (unchanged) — add `streamingSteps: [], pendingConfirm: null` to the final `set({...})`.

7. Add `run?: RunStep[]` to the `Message` interface in `packages/app/src/ai/types.ts`:

```ts
export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  run?: RunStep[];
  timestamp: number;
}
```

> `RunStep` is declared later in the same file; TypeScript hoists interface types, so the forward reference is fine.

- [ ] **Step 4: Run the store test; verify it passes**

Run: `pnpm --filter @formstr/app test -- aiStore`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/stores/aiStore.ts packages/app/src/stores/aiStore.test.ts packages/app/src/ai/types.ts
git commit -m "feat(app): drive aiStore from the Agent (confirm state + run steps)"
```

---

## Task 9: UI — ConfirmActionCard, AgentRunBlock, panel wiring

Per the standing directive, **no new frontend component tests** — these are verified via the agent/store logic tests and a manual smoke at the green gate.

**Files:**

- Create: `packages/app/src/components/ai/ConfirmActionCard.tsx`
- Create: `packages/app/src/components/ai/AgentRunBlock.tsx`
- Modify: `packages/app/src/components/ai/MessageBubble.tsx`
- Modify: `packages/app/src/components/ai/AIChatPanel.tsx`

- [ ] **Step 1: Create `ConfirmActionCard.tsx`**

```tsx
import { Box, Button, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { AlertTriangle } from "lucide-react";

import type { ConfirmRequest } from "../../ai/types";

export function ConfirmActionCard({
  request,
  onApprove,
  onCancel,
}: {
  request: ConfirmRequest;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        my: 1,
        border: `1px solid ${theme.palette.warning.main}`,
        borderRadius: 1.5,
        bgcolor: "background.paper",
        p: 1.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
        <AlertTriangle size={15} color={theme.palette.warning.main} />
        <Typography variant="body2" fontWeight={600}>
          Confirm: {request.toolName.replace(/_/g, " ")}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ color: "text.secondary", fontSize: 12.5, mb: 1.25 }}>
        {request.message}
      </Typography>
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
        <Button size="small" variant="text" color="inherit" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="small" variant="contained" color="warning" onClick={onApprove}>
          Run action
        </Button>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Create `AgentRunBlock.tsx`**

```tsx
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Check, Loader2, Slash, X } from "lucide-react";

import type { RunStep } from "../../ai/types";

function StepIcon({ status }: { status: RunStep["status"] }) {
  const theme = useTheme();
  if (status === "running")
    return <Loader2 size={12} style={{ animation: "spin 0.6s linear infinite" }} />;
  if (status === "success") return <Check size={12} color="#22c55e" />;
  if (status === "declined") return <Slash size={12} color={theme.palette.text.secondary} />;
  return <X size={12} color={theme.palette.error.main} />;
}

export function AgentRunBlock({ steps }: { steps: RunStep[] }) {
  const theme = useTheme();
  if (steps.length === 0) return null;

  const modules = Array.from(new Set(steps.map((s) => s.module).filter(Boolean)));
  const doneCount = steps.filter((s) => s.status !== "running").length;

  return (
    <Box
      sx={{
        my: 0.75,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1.5,
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          px: 1.25,
          py: 0.75,
          borderBottom: `1px solid ${theme.palette.divider}`,
          fontSize: 11,
          color: "text.secondary",
        }}
      >
        Working across {modules.join(" · ") || "tools"} — {doneCount}/{steps.length} done
      </Box>
      {steps.map((s) => (
        <Box
          key={s.id}
          sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.6 }}
          title={s.resultText}
        >
          <StepIcon status={s.status} />
          <Typography
            component="span"
            sx={{ fontFamily: "monospace", fontSize: 11.5, textTransform: "lowercase" }}
          >
            {s.toolName.replace(/_/g, " ")}
          </Typography>
          {s.resultText && (
            <Typography
              component="span"
              noWrap
              sx={{ fontSize: 11, color: "text.secondary", flex: 1, minWidth: 0 }}
            >
              {s.resultText.split("\n")[0]}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 3: Render the run block in `MessageBubble.tsx`**

Add the import and render `AgentRunBlock` for assistant messages that carry `run` steps (in place of the raw chips). In `packages/app/src/components/ai/MessageBubble.tsx`:

```tsx
import { AgentRunBlock } from "./AgentRunBlock";
```

Replace the `toolCalls` chip block:

```tsx
{
  toolCalls.length > 0 && (
    <Box sx={{ mb: 1, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
      {toolCalls.map((tc) => (
        <ToolCallChip key={tc.id} toolCall={tc} />
      ))}
    </Box>
  );
}
```

with:

```tsx
{
  message.run && message.run.length > 0 ? (
    <AgentRunBlock steps={message.run} />
  ) : (
    toolCalls.length > 0 && (
      <Box sx={{ mb: 1, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        {toolCalls.map((tc) => (
          <ToolCallChip key={tc.id} toolCall={tc} />
        ))}
      </Box>
    )
  );
}
```

> Keep the existing `ToolCallChip` import — it's still used for older persisted messages without `run`.

- [ ] **Step 4: Render the live run block + confirm card in `AIChatPanel.tsx`**

In `packages/app/src/components/ai/AIChatPanel.tsx`:

1. Pull the new state from the store and add the imports:

```tsx
import { AgentRunBlock } from "./AgentRunBlock";
import { ConfirmActionCard } from "./ConfirmActionCard";
```

```tsx
const {
  messages,
  entities,
  isProcessing,
  streamingContent,
  streamingSteps,
  pendingConfirm,
  providerStatus,
  errorMessage,
  availableModels,
  sendMessage,
  initProvider,
  reset,
  setModel,
  resolveConfirm,
} = useAIStore();
```

2. In the messages area, render the live run block while processing (before the streaming bubble), and the confirm card when a confirmation is pending. Insert directly after the closing of the `messages.filter(...).map(...)` block and before the `{streamingContent && (` block:

```tsx
{
  isProcessing && streamingSteps.length > 0 && <AgentRunBlock steps={streamingSteps} />;
}

{
  pendingConfirm && (
    <ConfirmActionCard
      request={pendingConfirm}
      onApprove={() => resolveConfirm(true)}
      onCancel={() => resolveConfirm(false)}
    />
  );
}
```

3. Keep run-only assistant messages visible. The existing render filters assistant messages by non-empty content, which would hide a turn that finished with tool steps but no final text. Update that filter to also keep messages carrying `run` steps:

```tsx
{
  messages
    .filter((m) => m.role !== "assistant" || m.content.trim() || (m.run && m.run.length > 0))
    .map((msg) => <MessageBubble key={msg.id} message={msg} />);
}
```

- [ ] **Step 5: Typecheck + build the app**

Run: `pnpm --filter @formstr/app typecheck && pnpm --filter @formstr/app build`
Expected: PASS / built. (`intentRouter.ts`/`tools.ts`/`actionDispatcher.ts` still present; removed next task.)

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/components/ai/ConfirmActionCard.tsx packages/app/src/components/ai/AgentRunBlock.tsx packages/app/src/components/ai/MessageBubble.tsx packages/app/src/components/ai/AIChatPanel.tsx
git commit -m "feat(app): confirm card + grouped run block in the AI panel"
```

---

## Task 10: Delete the old router/tools/dispatcher + refresh barrel & system prompt

**Files:**

- Modify: `packages/app/src/ai/index.ts`
- Modify: `packages/app/src/ai/context.ts`
- Modify: `packages/app/tsconfig.json`
- Delete: `packages/app/src/ai/intentRouter.ts`, `packages/app/src/ai/tools.ts`, `packages/app/src/ai/actionDispatcher.ts`

- [ ] **Step 1: Rewrite the AI barrel `packages/app/src/ai/index.ts`**

```ts
export type {
  Message,
  ToolCall,
  ToolDefinition,
  ToolParameter,
  GenerateOptions,
  StreamCallbacks,
  LLMProvider,
  EntityRef,
  ActionResult,
  RunStep,
  RunStepStatus,
  ConfirmRequest,
  AgentCallbacks,
} from "./types";

export { OllamaProvider, CloudLLMProvider, createLLMProvider } from "./provider";
export { buildToolDefinitions } from "./toolSchemas";
export { entityFromTool } from "./entityMap";
export { ConversationContext } from "./context";
export { Agent } from "./agent";
```

- [ ] **Step 2: Delete the dead files**

```bash
git rm packages/app/src/ai/intentRouter.ts packages/app/src/ai/tools.ts packages/app/src/ai/actionDispatcher.ts
```

- [ ] **Step 3: Remove the `actionDispatcher` tsconfig exclude**

In `packages/app/tsconfig.json`, delete the `"exclude": ["src/ai/actionDispatcher.ts"]` line (the file no longer exists). If `exclude` becomes empty, remove the key entirely.

- [ ] **Step 4: Refresh the capability list in `context.ts`**

In `packages/app/src/ai/context.ts`, replace the "Available capabilities" paragraph and the line that follows it with a description that reflects the full registry + multi-step behavior:

```ts
return `You are the Formstr Super App assistant. You help users manage forms, calendar events & scheduling, documents/pages, files, and polls — all built on the Nostr protocol.

You have a full set of tools spanning every module. Use them to take real actions, and chain multiple tool calls across modules in a single turn when a request needs it (e.g. create a poll, add a calendar event, then update a page). Read tools (list/get/fetch) and constructive creates run immediately; irreversible actions (delete, share, submit, rsvp, rename, move) will ask the user to confirm before running — call them normally and the app handles the confirmation.

For dates and times: the current date is ${new Date().toISOString().split("T")[0]}. Convert natural-language dates/times to ISO 8601.

For form fields: use "shortText" for short answers, "paragraph" for long text, "radioButton" for single-choice, "checkboxes" for multi-choice, "dropdown" for select menus, and "number"/"date"/"time"/"datetime" for typed inputs.

For polls: default to "singlechoice" unless the user asks for multiple choice.

${pubkey ? `User pubkey: ${pubkey}` : "User is not logged in — some actions require authentication."}
${this._activeModule ? `Currently active module: ${this._activeModule}` : ""}${entityContext}

Be concise. After you act, confirm what happened in one or two sentences. Do not use emojis.`;
```

> Keep the surrounding `buildSystemPrompt` code (the `recentEntities`/`entityContext` computation above this `return`) unchanged.

- [ ] **Step 5: Typecheck, test, build the app**

Run: `pnpm --filter @formstr/app typecheck && pnpm --filter @formstr/app test && pnpm --filter @formstr/app build`
Expected: PASS. No references to `IntentRouter`/`toolDefinitions`/`dispatchAction` remain.

Run (sanity): `grep -rn "intentRouter\|actionDispatcher\|toolDefinitions\|IntentRouter" packages/app/src ; echo "exit:$?"`
Expected: no matches (the doc comment reference in `aiPendingStore.ts` may remain — update it to say "the agent" if present).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(app): remove IntentRouter/tools/actionDispatcher; agent is the AI runtime"
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

Expected: all PASS. New tests: agent `schema` (+`safety` additions); app `toolSchemas`, `entityMap`, `aiPendingStore`, `agent`, `aiStore`. `@formstr/mcp` unchanged and green (the `getToolSchemas`/`CONFIRM_REQUIRED_PREFIX` additions are additive; the adapter doesn't use them).

- [ ] **Step 2: Manual stdio MCP parity check (no regression from the agent additions)**

Run: `node packages/mcp/dist/index.js whoami`
Expected: prints the signed-in identity — the stdio server still boots and the registry/adapter are unaffected.

- [ ] **Step 3: Manual app smoke (Ollama or a cloud key configured)**

Run: `pnpm --filter @formstr/app dev`, open the AI panel, and verify:

- A plain question streams a text answer (no tools).
- "Create a poll about lunch with options pizza, sushi, salad" runs `create_poll`, shows a run block with a ✓ step, and an entity card.
- A multi-module ask ("make that poll and add a calendar event tomorrow at noon") shows two ✓ steps.
- "Delete that poll" surfaces a `ConfirmActionCard`; Cancel marks the step declined and runs nothing; re-asking and approving deletes it.

> Manual only — no frontend component tests per the standing directive.

- [ ] **Step 4: Final commit (if hooks reformatted anything)**

```bash
git add -A
git commit -m "chore: Stage 1 green gate (agent runtime complete)" --allow-empty
```

---

## Self-review checklist (run before handing off to execution)

- **Spec coverage:**
  - §4.3 agent runtime (multi-step loop, derive tools from registry, gated confirm intercept, register entities, MAX_STEPS, text-JSON fallback, drop `looksLikeAction`, `ctx={allowWrites:true}`) → Tasks 5, 6, 7 (loop/entities/cap, confirm gate, fallback); `looksLikeAction` is simply absent (tools always offered).
  - §4.3 "derive JSON-schema from registry zod via zod-to-json-schema (cached)" → Task 1 (`getToolSchemas`) + Task 2 (`buildToolDefinitions`).
  - §4.3 "Delete tools.ts + actionDispatcher.ts" (+ replace intentRouter) → Task 10.
  - §4.6 UI (ConfirmActionCard inline, grouped run block, panel wiring) → Task 9; header switcher pill + Settings page are **Stage 3** (out of scope here).
  - §5 data-flow (create_poll + create_calendar_event + gated delete in one message) → exercised by Task 5 (chain) + Task 6 (gated) tests and Task 11 manual smoke.
  - §6 Stage 1 "runs on the existing Ollama/OpenAI providers" → `provider.ts` untouched; Anthropic/Gemini/compat + BYOK are Stage 2.
  - §7 testing (agent-loop multi-step/approve/decline/MAX_STEPS with a mock provider; settingsStore migration is Stage 2) → Tasks 5–8; provider-adapter fetch tests are Stage 2.
- **No placeholders:** every code step shows full file or a concrete replacement block; no "TBD"/"add error handling".
- **Type consistency:** `ToolResult`/`ToolCtx`/`toolRegistry`/`isGated`/`CONFIRM_REQUIRED_PREFIX` come from `@formstr/agent` (frozen Stage 0 API + Task 1 additions); `AgentCallbacks`/`RunStep`/`ConfirmRequest`/`Message.run` defined in `types.ts` (Task 2/8) and consumed identically in `agent.ts`, `aiStore.ts`, `AgentRunBlock.tsx`, `ConfirmActionCard.tsx`; `buildToolDefinitions` returns `ToolDefinition[]` consumed by the unchanged providers; `entityFromTool` signature `(name, args, data)` matches its call site in `agent.ts`.
- **Decline detection:** the agent sets `errorCode: "DECLINED"` on a declined result and maps it to the `"declined"` step status (not a string-match on `text`).
- **Confirm preview safety:** gated tools are previewed by calling the handler without `confirm`; `requireConfirm` short-circuits before side effects, and a non-`CONFIRM_REQUIRED_PREFIX` failure is surfaced as-is (no prompt), so validation errors aren't mistaken for confirmations.
