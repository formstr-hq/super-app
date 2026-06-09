# AI Orchestration Layer — Design Spec

> Date: 2026-06-07 · Status: approved design, pre-implementation · Supersedes the bespoke `IntentRouter`.

## 1. Goal

Replace the super-app's hand-rolled, single-round "intent router" with a real **MCP-driven agent**:

1. Drive the in-app AI from the **already-complete MCP tool set** (one source of truth, no parallel app-side tools).
2. Let users **bring their own API keys** for Anthropic, OpenAI, Gemini, and run **local LLMs** (Ollama / OpenAI-compatible), managed in the app.
3. Let the AI **perform actions across multiple modules in a single message** (a true multi-step tool-use loop).
4. Keep the **standalone stdio MCP server publishable to npm** and working for external clients (Claude Desktop).

## 2. Current state ("before")

- `packages/app/src/ai/`: `IntentRouter` — one tool-call round gated by a `looksLikeAction` regex heuristic, plus a small-model text-JSON tool-call fallback; `tools.ts` = **19 hand-written** JSON-schema tools; `actionDispatcher.ts` = a big `switch` calling services; `provider.ts` = `OllamaProvider` + a `CloudLLMProvider` whose **"anthropic" path is broken** (uses OpenAI's `/chat/completions` shape, not the Messages API); `context.ts` = system prompt + entity registry.
- `packages/mcp/`: the canonical tool surface — **51 tools** (forms 9, calendar 19, pages 10, polls 8, drive 5), write-gated via `safety.ts` (`GATED_TOOLS` + `requireConfirm`); handlers call `@formstr/app/services`. Node **stdio** server (`McpServer` + `StdioServerTransport`). Already `2.0.0` with `bin`/`prepublishOnly` (meant for npm) but **depends on `@formstr/app` (`private:true`) → not cleanly publishable**.
- `settingsStore`: a **single** `aiApiKey` + `aiProvider` (ollama|openai|anthropic) + endpoint/model.
- The 7 services (`packages/app/src/services/{forms,calendar,pages,polls,drive}`, incl. calendar `rsvp`/`booking`) import **only** `@formstr/core` + `nostr-tools` (one guarded `window` use) → already framework-agnostic / Node-safe.
- AI panel = a 380px right drawer (`AIChatPanel`); the avatar menu has a **dead "Settings" item** (no handler); there is **no global Settings page**.

## 3. Locked decisions

1. **Keep the stdio MCP** working for external clients → tools must be a single source of truth shared by mcp + the in-app agent.
2. **Client-side BYOK** — keys in `localStorage`, browser → provider direct calls, no backend.
3. **One design, staged build.**
4. **In-browser agent calls the registry handlers directly** (no MCP SDK in the browser bundle).
5. **New `@formstr/agent` package** holds the shared layer (Option A package layout). Layering:
   `@formstr/core` (nostr primitives) ← **`@formstr/agent`** (7 services + 51-tool registry + neutral `result`/`safety`) ← { `@formstr/mcp` (thin stdio CLI, publishable), `@formstr/app` (UI + agent) }.
   - Rejected Option B (mcp owns tools, app imports mcp): the browser would bundle mcp's native/Node deps (`@napi-rs/keyring` `.node` addon, `ws`, stdio, `child_process`/`fs`); stripping those via tree-shaking is fragile. Option A keeps the browser importing pure TS only.
6. **UI (via mockups):** (C) provider/model **switcher in the panel header** + key management on a **new global Settings page**; (B) Settings → AI uses **provider tabs**; (B) the chat surface renders a multi-module run as a **grouped "steps" block**.
7. **Publishing strategy: DEFERRED** (bundle mcp standalone via tsup `noExternal` vs publish core+agent+mcp as a versioned set).

## 4. Architecture

### 4.1 `@formstr/agent` (new, framework-agnostic, depends on `@formstr/core`)

Owns the domain + tool layer so both transports (stdio CLI, in-browser agent) share it.

- **Services:** move `packages/app/src/services/{forms,calendar,pages,polls,drive}` (incl. calendar `rsvp`/`booking` + all `types`) here. Handler bodies are unchanged — they already import only `@formstr/core` + `nostr-tools`.
- **Neutral result type** (so the package stays MCP-SDK-free):
  ```ts
  export interface ToolResult {
    ok: boolean;
    text: string;
    data?: unknown;
    errorCode?: string;
  }
  export const ok = (text: string, data?: unknown): ToolResult => ({ ok: true, text, data });
  export const fail = (text: string, errorCode?: string): ToolResult => ({
    ok: false,
    text,
    errorCode,
  });
  // table() helper retained for text rendering
  ```
- **Tool registry** — convert the 5 `registerXxx(server, ctx)` modules into plain entries:
  ```ts
  export interface ToolEntry {
    name: string;
    description: string;
    inputSchema: z.ZodRawShape; // same shape MCP's registerTool takes
    handler: (args, ctx: ToolCtx) => Promise<ToolResult>;
    write?: boolean; // mutating/outward — see "two gates" below
  }
  export const toolRegistry: ToolEntry[]; // all 51
  ```
  **Two independent gates are preserved** (matching today's mcp behavior exactly):
  - **Registration gate** — the stdio adapter registers `write` tools only when `allowWrites` (mirrors today's `if (!ctx.allowWrites) return` boundary). Constructive creates (`create_form`, `create_poll`, …) and reads are **not** `write`, so they're always available.
  - **Confirmation gate** — the irreversible subset listed in `GATED_TOOLS` (delete/share/submit/rsvp/rename/move…, a subset of the `write` tools) requires `confirm:true` at execution. Handlers keep their `confirm` arg + `requireConfirm(...)` (now returning a neutral `ToolResult`). `safety.ts` (`GATED_TOOLS`, `isGated`) moves here.
- **No MCP SDK dependency.** zod is a dependency (input schemas).

### 4.2 `@formstr/mcp` becomes a thin adapter

- Depends on `@formstr/agent` (+ `@formstr/core`, MCP SDK, keyring, ws, qrcode). **Drops `@formstr/app`.**
- `buildServer(ctx)` iterates `toolRegistry`: `if (t.write && !ctx.allowWrites) continue;` else `server.registerTool(t.name, { description, inputSchema: t.inputSchema }, adapt(t.handler))`, where `adapt` maps `ToolResult → CallToolResult` (`{ content: [{type:'text', text}], structuredContent: data, isError: !ok }`).
- stdio/auth/CLI code unchanged. **External-client behavior identical.**
- Now publishable (clean dep tree; tsup can bundle on publish — strategy deferred).

### 4.3 Agent runtime (`packages/app/src/ai/agent.ts`, replaces `intentRouter.ts`)

Provider-agnostic multi-step tool-use loop:

1. Build messages: `[system, ...history, userMessage]`. System prompt from `ConversationContext` (kept; capability list refreshed — tool schemas now carry the detail).
2. Tool list for the LLM is derived from `toolRegistry` zod shapes via `zod-to-json-schema` (cached).
3. `provider.generateStream(messages, tools, callbacks)` → stream assistant text tokens to the UI; collect `toolCalls`.
4. If no tool calls → final answer; stop.
5. For each tool call:
   - If `isGated(name)` → emit a **confirm-required** UI event and await the user's Approve/Cancel.
     - Approve → run `handler(args + { confirm: true }, ctx)`.
     - Cancel → synthesize a tool result `"User declined this action."` (no execution).
   - Else → run `handler(args, ctx)` directly.
   - Register any `data.entity` in `ConversationContext`; emit a step-status + (optional) entity event to the UI.
6. Append the assistant message (with its `toolCalls`) and each `tool` result to `messages`; **loop to step 3** so the model can chain further cross-module calls.
7. Stop at a final text answer or a **`MAX_STEPS = 8`** safety cap (then emit a "stopped after N steps" notice).

Keep the **text-JSON tool-call fallback** for local models without native tool calling. **Drop** the `looksLikeAction` heuristic (always offer tools). **Delete** `tools.ts` + `actionDispatcher.ts`.

`ToolCtx` for the app = `{ allowWrites: true }` (the user's own session); safety is enforced by the **UI confirm gate**, not by withholding tools.

### 4.4 Provider layer (`packages/app/src/ai/providers/`)

Keep the `LLMProvider` interface; every provider implements **normalized tool-calling** (translates the registry tool list + neutral `Message[]` to/from its wire format, emits streamed text + normalized `ToolCall`s, accepts tool results).

- **AnthropicProvider** — `POST https://api.anthropic.com/v1/messages`; headers `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`; `tools` + `tool_use`/`tool_result` blocks; SSE streaming (`content_block_delta`). Replaces the broken path.
- **OpenAIProvider** — `/v1/chat/completions` + `tools` + streamed `tool_calls` deltas (refine existing).
- **GeminiProvider** — `generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent`, header `x-goog-api-key`; `tools.functionDeclarations` + `functionCall`/`functionResponse` parts.
- **OllamaProvider** — existing (local, native `tool_calls` + text-JSON fallback).
- **OpenAICompatibleProvider** — OpenAI wire format against a configurable base URL (+ optional key); covers LM Studio / llama.cpp / vLLM / OpenRouter.
- `createProvider(settings): LLMProvider` selects the active provider.

### 4.5 Settings / BYOK (`settingsStore`)

Replace the single `aiApiKey` with:

```ts
aiProvider: "anthropic" | "openai" | "gemini" | "ollama" | "openai-compat"
apiKeys:   { anthropic?: string; openai?: string; gemini?: string }   // localStorage
aiModels:  Partial<Record<AIProviderType, string>>                    // selected model per provider
ollamaUrl: string
compatBaseUrl: string; compatKey?: string
```

One-time migration: existing `formstr:ai-apikey` → `apiKeys[currentProvider]`; `formstr:ai-model` → `aiModels[currentProvider]`.

**Security:** keys live in `localStorage` — readable by any script on the origin, scoped to the device. Accepted trade-off for a no-backend BYOK setup; labeled plainly in the Settings UI.

### 4.6 UI

- **Header switcher (Option C)** — in `AIChatPanel`'s header, replace the bare model `Select` with a **provider · model pill** that opens a small menu to switch provider (only those with a usable key/endpoint) and model. A "Manage keys in Settings" link; no key entry here.
- **Settings page (new)** — add route `/settings` → `SettingsPage` (centered/contained, **not** full-bleed) with a slim left section nav (`General`, `AI & Models`, `Relays`/future, `About`). Wire the avatar-menu "Settings" item to `navigate("/settings")`. The **AI & Models** section uses **provider tabs (Option B)**: a tab per provider; the selected tab shows a masked **API key** field (show/clear), a **model** picker (with list/refresh where the provider supports it), a **local endpoint** field on the Local tab, a connection **status** dot + **Test**, and **Set as active**. A plain "stored locally on this device" note.
- **Chat surface (grouped steps, Option B)** — a multi-module run renders as one compact **run block** (`AgentRunBlock`): a header ("Working across Polls · Calendar · N done"), then one row per tool step with status (running / ✓ / ✗) + module + short result; **entity cards** (reuse `EntityCard`) and the final summary follow. Gated steps surface a **`ConfirmActionCard`** inline (titled by the effect, `Cancel` / destructive action). Replaces ad-hoc `ToolCallChip` rendering for runs.

## 5. Data flow — one multi-module message

```
User: "Make a lunch-spot poll, add a Fri 1pm event, delete last week's poll."
 → agent: messages=[system, user]; tools=registry→jsonschema
 → provider stream: assistant text + toolCalls[create_poll, create_calendar_event, delete_poll]
 → create_poll (not gated)            → handler → ok → entity(poll) → step ✓
 → create_calendar_event (not gated)  → handler → ok → entity(event) → step ✓
 → delete_poll (GATED)                → UI ConfirmActionCard → Approve
                                       → handler(confirm:true) → ok → step ✓
 → append assistant + 3 tool results → loop
 → provider stream: final text, no toolCalls → done
 → run block shows 3 steps + 2 entity cards + summary
```

## 6. Staged build

- **Stage 0 — foundation (no behavior change):** create `@formstr/agent`; move services + tool registry (+ `result`/`safety`); make `@formstr/mcp` a thin adapter and drop its `@formstr/app` dep; point `@formstr/app` at `@formstr/agent` (a `@formstr/app/services` re-export shim is acceptable to limit churn). Green gate: all tests, `pnpm -r typecheck`, all builds, and **mcp stdio still serves the 51 tools**.
- **Stage 1 — agent runtime:** the multi-step loop + confirmation flow; delete `tools.ts` + `actionDispatcher.ts`; wire `AIChatPanel` to the agent; add `AgentRunBlock` + `ConfirmActionCard` (grouped-steps). Runs on the **existing** Ollama/OpenAI providers until Stage 2 lands the full set.
- **Stage 2 — providers + BYOK:** Anthropic/OpenAI/Gemini/Ollama/compat providers with normalized tool-calling; expand `settingsStore` + migration + `createProvider`.
- **Stage 3 — settings + header UI:** `/settings` route + `SettingsPage` with the provider-tabs AI section; wire the avatar menu; header provider/model switcher pill. (Stages 2–3 are coupled — the header/Settings consume the provider/key state.)

## 7. Testing

- **`@formstr/agent`:** port the existing mcp tool tests (now against the registry); unit-test `result`/`safety` and the zod→json-schema derivation.
- **`@formstr/app`:** agent-loop tests with a mock provider (multi-step chaining, gated→confirm approve path, decline path, `MAX_STEPS` cap); provider adapters with mocked `fetch` (Anthropic/Gemini/OpenAI/Ollama tool round-trips); `settingsStore` migration.
- **`@formstr/mcp`:** existing tool tests stay green (imports shift to `@formstr/agent`); a `buildServer` smoke test (tool count + gating).
- Per standing directive: backend/logic tests only — **no new frontend component tests** for `SettingsPage`, `AgentRunBlock`, `ConfirmActionCard`, the header pill.

## 8. Out of scope / non-goals

- In-browser MCP **client** to external/third-party MCP servers (Approach A path) — revisit if/when wanted.
- Any backend/proxy; server-side key storage or encryption.
- The npm publish pipeline/CI itself (the layout makes mcp publishable; the publish flow + strategy are deferred — §3.7).
- Voice/multimodal, RAG, long-term memory beyond `ConversationContext`.

## 9. Deferred / open

- **Publishing strategy:** bundle mcp standalone (tsup `noExternal`, only `@formstr/mcp` on npm) vs publish `core`+`agent`+`mcp` as a versioned set. Decide before Stage 0 finalizes the `@formstr/mcp` build config.
- Whether to keep a `@formstr/app/services` re-export shim long-term or update all import sites in Stage 0.
