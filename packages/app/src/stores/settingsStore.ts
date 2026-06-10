import { create } from "zustand";

type ThemeMode = "light" | "dark";
export type AIProviderType = "anthropic" | "openai" | "gemini" | "ollama" | "openai-compat";
export type CloudProvider = "anthropic" | "openai" | "gemini";
export type ApiKeys = { anthropic?: string; openai?: string; gemini?: string };
export type FormsView = "grid" | "list";

/** A reusable AI-panel prompt, inserted by typing `/keyword` in the chat input. */
export interface SavedPrompt {
  id: string;
  /** Lowercase, no spaces, no leading slash — what the user types after "/". */
  keyword: string;
  prompt: string;
}

/** Normalize user input into a slash keyword: strip "/", lowercase, spaces → dashes. */
export function normalizePromptKeyword(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_COMPAT_URL = "http://localhost:1234/v1";

function applyTheme(mode: ThemeMode) {
  if (mode === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

interface AISettingsState {
  aiProvider: AIProviderType;
  apiKeys: ApiKeys;
  aiModels: Partial<Record<AIProviderType, string>>;
  ollamaUrl: string;
  compatBaseUrl: string;
  compatKey: string | null;
}

/** One-time migration from the legacy single-key shape. Idempotent: gated on the
 *  presence of "formstr:ai-keys". Safe to call on every module load. */
export function migrateAISettings(): void {
  if (localStorage.getItem("formstr:ai-keys") !== null) return; // already migrated

  const legacyProvider = localStorage.getItem("formstr:ai-provider");
  const legacyKey = localStorage.getItem("formstr:ai-apikey");
  const legacyModel = localStorage.getItem("formstr:ai-model");
  const legacyEndpoint = localStorage.getItem("formstr:ai-endpoint");

  const apiKeys: ApiKeys = {};
  if (legacyKey && (legacyProvider === "openai" || legacyProvider === "anthropic")) {
    apiKeys[legacyProvider] = legacyKey;
  }
  const aiModels: Partial<Record<AIProviderType, string>> = {};
  if (legacyModel && legacyProvider && isAIProvider(legacyProvider)) {
    aiModels[legacyProvider] = legacyModel;
  }

  localStorage.setItem("formstr:ai-keys", JSON.stringify(apiKeys));
  localStorage.setItem("formstr:ai-models", JSON.stringify(aiModels));
  if (legacyEndpoint) localStorage.setItem("formstr:ai-ollama-url", legacyEndpoint);
}

/** Read the (already-migrated) AI settings out of localStorage. */
export function readAISettings(): AISettingsState {
  return {
    aiProvider: (localStorage.getItem("formstr:ai-provider") as AIProviderType) ?? "ollama",
    apiKeys: parseJson<ApiKeys>(localStorage.getItem("formstr:ai-keys"), {}),
    aiModels: parseJson<Partial<Record<AIProviderType, string>>>(
      localStorage.getItem("formstr:ai-models"),
      {},
    ),
    ollamaUrl: localStorage.getItem("formstr:ai-ollama-url") ?? DEFAULT_OLLAMA_URL,
    compatBaseUrl: localStorage.getItem("formstr:ai-compat-base-url") ?? DEFAULT_COMPAT_URL,
    compatKey: localStorage.getItem("formstr:ai-compat-key"),
  };
}

function isAIProvider(v: string): v is AIProviderType {
  return ["anthropic", "openai", "gemini", "ollama", "openai-compat"].includes(v);
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const storedTheme = (localStorage.getItem("formstr:theme") as ThemeMode) ?? "light";
applyTheme(storedTheme);

migrateAISettings();
const _ai = readAISettings();

interface SettingsStore {
  themeMode: ThemeMode;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean; // desktop: collapsed to icon-only
  formsView: FormsView; // forms list layout: card grid vs dense list

  // AI settings
  aiProvider: AIProviderType;
  apiKeys: ApiKeys;
  aiModels: Partial<Record<AIProviderType, string>>;
  ollamaUrl: string;
  compatBaseUrl: string;
  compatKey: string | null;
  aiPanelOpen: boolean;
  savedPrompts: SavedPrompt[];

  toggleTheme(): void;
  toggleSidebar(): void;
  setSidebarOpen(open: boolean): void;
  toggleSidebarCollapsed(): void;
  setFormsView(view: FormsView): void;
  setActiveProvider(provider: AIProviderType): void;
  setApiKey(provider: CloudProvider, key: string | null): void;
  setProviderModel(provider: AIProviderType, model: string | null): void;
  setOllamaUrl(url: string): void;
  setCompatConfig(config: { baseUrl?: string; key?: string | null }): void;
  setAIPanelOpen(open: boolean): void;
  /** Returns false (and does nothing) when the normalized keyword is empty or taken. */
  addSavedPrompt(keyword: string, prompt: string): boolean;
  updateSavedPrompt(id: string, patch: Partial<Pick<SavedPrompt, "keyword" | "prompt">>): void;
  removeSavedPrompt(id: string): void;
}

function persistSavedPrompts(prompts: SavedPrompt[]) {
  localStorage.setItem("formstr:saved-prompts", JSON.stringify(prompts));
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  themeMode: storedTheme,
  sidebarOpen: true,
  sidebarCollapsed: false,
  formsView: (localStorage.getItem("formstr:forms-view") as FormsView) ?? "grid",

  aiProvider: _ai.aiProvider,
  apiKeys: _ai.apiKeys,
  aiModels: _ai.aiModels,
  ollamaUrl: _ai.ollamaUrl,
  compatBaseUrl: _ai.compatBaseUrl,
  compatKey: _ai.compatKey,
  aiPanelOpen: false,
  savedPrompts: parseJson<SavedPrompt[]>(localStorage.getItem("formstr:saved-prompts"), []),

  toggleTheme() {
    set((state) => {
      const next = state.themeMode === "dark" ? "light" : "dark";
      localStorage.setItem("formstr:theme", next);
      applyTheme(next);
      return { themeMode: next };
    });
  },

  toggleSidebar() {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },

  setSidebarOpen(open: boolean) {
    set({ sidebarOpen: open });
  },

  toggleSidebarCollapsed() {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
  },

  setFormsView(view: FormsView) {
    localStorage.setItem("formstr:forms-view", view);
    set({ formsView: view });
  },

  setActiveProvider(provider) {
    localStorage.setItem("formstr:ai-provider", provider);
    set({ aiProvider: provider });
  },

  setApiKey(provider, key) {
    set((state) => {
      const apiKeys = { ...state.apiKeys };
      if (key) apiKeys[provider] = key;
      else delete apiKeys[provider];
      localStorage.setItem("formstr:ai-keys", JSON.stringify(apiKeys));
      return { apiKeys };
    });
  },

  setProviderModel(provider, model) {
    set((state) => {
      const aiModels = { ...state.aiModels };
      if (model) aiModels[provider] = model;
      else delete aiModels[provider];
      localStorage.setItem("formstr:ai-models", JSON.stringify(aiModels));
      return { aiModels };
    });
  },

  setOllamaUrl(url) {
    localStorage.setItem("formstr:ai-ollama-url", url);
    set({ ollamaUrl: url });
  },

  setCompatConfig(config) {
    set((state) => {
      const next: Partial<Pick<SettingsStore, "compatBaseUrl" | "compatKey">> = {};
      if (config.baseUrl !== undefined) {
        localStorage.setItem("formstr:ai-compat-base-url", config.baseUrl);
        next.compatBaseUrl = config.baseUrl;
      }
      if (config.key !== undefined) {
        if (config.key) localStorage.setItem("formstr:ai-compat-key", config.key);
        else localStorage.removeItem("formstr:ai-compat-key");
        next.compatKey = config.key;
      }
      return { ...state, ...next };
    });
  },

  setAIPanelOpen(open: boolean) {
    set({ aiPanelOpen: open });
  },

  addSavedPrompt(keyword, prompt) {
    const normalized = normalizePromptKeyword(keyword);
    if (!normalized) return false;
    let added = false;
    set((state) => {
      if (state.savedPrompts.some((p) => p.keyword === normalized)) return state;
      added = true;
      const savedPrompts = [
        ...state.savedPrompts,
        { id: crypto.randomUUID(), keyword: normalized, prompt },
      ];
      persistSavedPrompts(savedPrompts);
      return { savedPrompts };
    });
    return added;
  },

  updateSavedPrompt(id, patch) {
    set((state) => {
      const savedPrompts = state.savedPrompts.map((p) =>
        p.id === id
          ? {
              ...p,
              ...patch,
              keyword:
                patch.keyword !== undefined ? normalizePromptKeyword(patch.keyword) : p.keyword,
            }
          : p,
      );
      persistSavedPrompts(savedPrompts);
      return { savedPrompts };
    });
  },

  removeSavedPrompt(id) {
    set((state) => {
      const savedPrompts = state.savedPrompts.filter((p) => p.id !== id);
      persistSavedPrompts(savedPrompts);
      return { savedPrompts };
    });
  },
}));
