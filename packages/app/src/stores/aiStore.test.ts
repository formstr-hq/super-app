import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AiModule from "../ai";
import type { AgentCallbacks } from "../ai/types";

// jsdom in this config doesn't expose a global localStorage; shim it. vi.hoisted
// runs before the (hoisted) imports, so it's set before settingsStore reads it at load.
vi.hoisted(() => {
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  }
});

// A scriptable fake Agent whose run() drives the callbacks.
let scriptedRun: (cb: AgentCallbacks) => Promise<void>;

vi.mock("../ai", async () => {
  const actual = await vi.importActual<typeof AiModule>("../ai");
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
    createProvider: vi.fn(() => ({
      getAvailableModels: async () => ["fake-model"],
      isAvailable: async () => true,
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
