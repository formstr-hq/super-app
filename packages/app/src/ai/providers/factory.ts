import type { LLMProvider } from "../types";

import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OllamaProvider } from "./ollama";
import { OpenAIProvider } from "./openai";
import { OpenAICompatibleProvider } from "./openaiCompatible";

export type AIProviderType = "anthropic" | "openai" | "gemini" | "ollama" | "openai-compat";

export interface ProviderSettings {
  aiProvider: AIProviderType;
  apiKeys: { anthropic?: string; openai?: string; gemini?: string };
  ollamaUrl: string;
  compatBaseUrl: string;
  compatKey: string | null;
}

export function createProvider(s: ProviderSettings): LLMProvider {
  switch (s.aiProvider) {
    case "anthropic":
      return new AnthropicProvider(s.apiKeys.anthropic ?? "");
    case "openai":
      return new OpenAIProvider(s.apiKeys.openai ?? "");
    case "gemini":
      return new GeminiProvider(s.apiKeys.gemini ?? "");
    case "openai-compat":
      return new OpenAICompatibleProvider({
        baseUrl: s.compatBaseUrl,
        apiKey: s.compatKey ?? undefined,
      });
    case "ollama":
    default:
      return new OllamaProvider(s.ollamaUrl);
  }
}
