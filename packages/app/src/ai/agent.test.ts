import { describe, it, expect, vi, beforeEach } from "vitest";

import type {
  AgentCallbacks,
  GenerateOptions,
  LLMProvider,
  Message,
  StreamCallbacks,
  ToolDefinition,
} from "./types";

// ── Mock the shared registry so tools are deterministic ──────────────────
// vi.hoisted so the spies exist when the hoisted vi.mock factory runs.
const handlerSpies = vi.hoisted(() => ({
  create_poll: vi.fn(async () => ({ ok: true, text: "Created poll.", data: { id: "p1" } })),
  create_calendar_event: vi.fn(async () => ({
    ok: true,
    text: "Created event.",
    data: { eventId: "e1" },
  })),
  list_polls: vi.fn(async () => ({ ok: true, text: "0 polls.", data: { polls: [] } })),
  delete_poll: vi.fn(async (args: { confirm?: boolean }) => {
    if (args.confirm !== true) {
      return { ok: false, text: 'Confirmation required for "delete_poll". ... deletes poll p1.' };
    }
    return { ok: true, text: "Deleted poll p1." };
  }),
}));

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
      handler: handlerSpies.delete_poll,
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

describe("Agent (gated confirm gate)", () => {
  beforeEach(() => {
    Object.values(handlerSpies).forEach((s) => s.mockClear());
  });

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
    expect(handlerSpies.delete_poll).toHaveBeenLastCalledWith(
      expect.objectContaining({ confirm: true }),
      expect.anything(),
    );
    expect(c.steps.some((s) => s.toolName === "delete_poll" && s.status === "success")).toBe(true);
  });

  it("does not execute the tool when the user declines", async () => {
    const agent = new Agent(provider(), new ConversationContext());
    const c = collectCallbacks({ onConfirmRequired: async () => false });
    await agent.run("delete it", "pk", c.cb);
    expect(c.steps.some((s) => s.toolName === "delete_poll" && s.status === "declined")).toBe(true);
    // only the no-confirm preview call ran; never with confirm:true
    expect(handlerSpies.delete_poll).not.toHaveBeenCalledWith(
      expect.objectContaining({ confirm: true }),
      expect.anything(),
    );
  });

  it("treats a missing confirm handler as a decline (safe default)", async () => {
    const agent = new Agent(provider(), new ConversationContext());
    const c = collectCallbacks(); // no onConfirmRequired
    await agent.run("delete it", "pk", c.cb);
    expect(c.steps.some((s) => s.toolName === "delete_poll" && s.status === "declined")).toBe(true);
  });
});
