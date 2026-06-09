import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { migrateAISettings, readAISettings } from "./settingsStore";

describe("AI settings migration", () => {
  beforeEach(() => localStorage.clear());

  it("migrates a legacy single anthropic key + model + endpoint", () => {
    localStorage.setItem("formstr:ai-provider", "anthropic");
    localStorage.setItem("formstr:ai-apikey", "sk-ant-legacy");
    localStorage.setItem("formstr:ai-model", "claude-3-5-sonnet");
    localStorage.setItem("formstr:ai-endpoint", "http://host:11434");

    migrateAISettings();
    const s = readAISettings();

    expect(s.aiProvider).toBe("anthropic");
    expect(s.apiKeys.anthropic).toBe("sk-ant-legacy");
    expect(s.aiModels.anthropic).toBe("claude-3-5-sonnet");
    expect(s.ollamaUrl).toBe("http://host:11434");
    // migration marker written
    expect(localStorage.getItem("formstr:ai-keys")).not.toBeNull();
  });

  it("migrates a legacy ollama model into aiModels.ollama and is idempotent", () => {
    localStorage.setItem("formstr:ai-provider", "ollama");
    localStorage.setItem("formstr:ai-model", "qwen2.5:7b");

    migrateAISettings();
    // a second run must not clobber
    localStorage.setItem("formstr:ai-keys", JSON.stringify({ openai: "added-later" }));
    migrateAISettings();

    const s = readAISettings();
    expect(s.aiModels.ollama).toBe("qwen2.5:7b");
    expect(s.apiKeys.openai).toBe("added-later");
  });

  it("defaults cleanly when nothing is stored", () => {
    migrateAISettings();
    const s = readAISettings();
    expect(s.aiProvider).toBe("ollama");
    expect(s.apiKeys).toEqual({});
    expect(s.aiModels).toEqual({});
    expect(s.ollamaUrl).toBe("http://localhost:11434");
    expect(s.compatBaseUrl).toBe("http://localhost:1234/v1");
    expect(s.compatKey).toBeNull();
  });
});

describe("settings setters", () => {
  beforeEach(() => localStorage.clear());

  it("setApiKey / setProviderModel / setActiveProvider persist to localStorage and state", async () => {
    const { useSettingsStore } = await import("./settingsStore");
    useSettingsStore.getState().setApiKey("openai", "sk-openai");
    useSettingsStore.getState().setProviderModel("openai", "gpt-4o");
    useSettingsStore.getState().setActiveProvider("openai");

    expect(useSettingsStore.getState().apiKeys.openai).toBe("sk-openai");
    expect(useSettingsStore.getState().aiModels.openai).toBe("gpt-4o");
    expect(useSettingsStore.getState().aiProvider).toBe("openai");
    expect(JSON.parse(localStorage.getItem("formstr:ai-keys")!).openai).toBe("sk-openai");
    expect(JSON.parse(localStorage.getItem("formstr:ai-models")!).openai).toBe("gpt-4o");
    expect(localStorage.getItem("formstr:ai-provider")).toBe("openai");
  });
});
