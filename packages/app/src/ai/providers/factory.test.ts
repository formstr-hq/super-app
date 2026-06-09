import { describe, expect, it } from "vitest";

import { AnthropicProvider } from "./anthropic";
import { createProvider } from "./factory";
import { GeminiProvider } from "./gemini";
import { OllamaProvider } from "./ollama";
import { OpenAIProvider } from "./openai";
import { OpenAICompatibleProvider } from "./openaiCompatible";

const base = {
  apiKeys: { anthropic: "a", openai: "o", gemini: "g" },
  ollamaUrl: "http://localhost:11434",
  compatBaseUrl: "http://localhost:1234/v1",
  compatKey: null,
};

describe("createProvider", () => {
  it("selects the active provider", () => {
    expect(createProvider({ ...base, aiProvider: "anthropic" })).toBeInstanceOf(AnthropicProvider);
    expect(createProvider({ ...base, aiProvider: "openai" })).toBeInstanceOf(OpenAIProvider);
    expect(createProvider({ ...base, aiProvider: "gemini" })).toBeInstanceOf(GeminiProvider);
    expect(createProvider({ ...base, aiProvider: "ollama" })).toBeInstanceOf(OllamaProvider);
    const compat = createProvider({ ...base, aiProvider: "openai-compat" });
    expect(compat).toBeInstanceOf(OpenAICompatibleProvider);
    expect(compat).not.toBeInstanceOf(OpenAIProvider);
  });

  it("tolerates missing keys without throwing (availability gates later)", () => {
    expect(() => createProvider({ ...base, apiKeys: {}, aiProvider: "anthropic" })).not.toThrow();
  });
});
