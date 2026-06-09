import type { AIProviderType } from "../stores/settingsStore";

export const AI_PROVIDERS: AIProviderType[] = [
  "anthropic",
  "openai",
  "gemini",
  "ollama",
  "openai-compat",
];
export const CLOUD_PROVIDERS = ["anthropic", "openai", "gemini"] as const;

export const PROVIDER_LABELS: Record<AIProviderType, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  ollama: "Ollama",
  "openai-compat": "Local",
};

/** Default model shown when a provider has no model chosen yet. */
export const PROVIDER_DEFAULT_MODEL: Record<AIProviderType, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  ollama: "qwen2.5:7b",
  "openai-compat": "local-model",
};

export function isCloudProvider(p: AIProviderType): p is (typeof CLOUD_PROVIDERS)[number] {
  return (CLOUD_PROVIDERS as readonly string[]).includes(p);
}

export interface ConfiguredCheck {
  apiKeys: Partial<Record<"anthropic" | "openai" | "gemini", string>>;
  compatBaseUrl: string;
}

/** A provider is "configured" (usable in the switcher) when it has a key/endpoint. */
export function isProviderConfigured(s: ConfiguredCheck, p: AIProviderType): boolean {
  if (p === "ollama") return true; // local — always offered
  if (p === "openai-compat") return Boolean(s.compatBaseUrl);
  return Boolean(s.apiKeys[p]);
}
