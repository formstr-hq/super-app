import { create } from "zustand";

type ThemeMode = "light" | "dark";
export type AIProviderType = "ollama" | "openai" | "anthropic";

function applyTheme(mode: ThemeMode) {
  if (mode === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

const storedTheme = (localStorage.getItem("formstr:theme") as ThemeMode) ?? "light";
applyTheme(storedTheme);

interface SettingsStore {
  themeMode: ThemeMode;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean; // desktop: collapsed to icon-only

  // AI settings
  aiProvider: AIProviderType;
  aiEndpoint: string;
  aiModel: string | null;
  aiApiKey: string | null;
  aiPanelOpen: boolean;

  toggleTheme(): void;
  toggleSidebar(): void;
  setSidebarOpen(open: boolean): void;
  toggleSidebarCollapsed(): void;
  setAIConfig(config: Partial<Pick<SettingsStore, "aiProvider" | "aiEndpoint" | "aiModel" | "aiApiKey">>): void;
  setAIPanelOpen(open: boolean): void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  themeMode: storedTheme,
  sidebarOpen: true,
  sidebarCollapsed: false,

  aiProvider: (localStorage.getItem("formstr:ai-provider") as AIProviderType) ?? "ollama",
  aiEndpoint: localStorage.getItem("formstr:ai-endpoint") ?? "http://localhost:11434",
  // Default to qwen2.5:7b — reliably supports native tool_calls in Ollama
  // and emits strict JSON when it has to, which is what our intent router
  // needs. Still overridable via settings or the first-available fallback
  // in initProvider when the model isn't installed.
  aiModel: localStorage.getItem("formstr:ai-model") ?? "qwen2.5:7b",
  aiApiKey: localStorage.getItem("formstr:ai-apikey") ?? null,
  aiPanelOpen: false,

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

  setAIConfig(config) {
    set((state) => {
      if (config.aiProvider !== undefined) localStorage.setItem("formstr:ai-provider", config.aiProvider);
      if (config.aiEndpoint !== undefined) localStorage.setItem("formstr:ai-endpoint", config.aiEndpoint);
      if (config.aiModel !== undefined) {
        if (config.aiModel) localStorage.setItem("formstr:ai-model", config.aiModel);
        else localStorage.removeItem("formstr:ai-model");
      }
      if (config.aiApiKey !== undefined) {
        if (config.aiApiKey) localStorage.setItem("formstr:ai-apikey", config.aiApiKey);
        else localStorage.removeItem("formstr:ai-apikey");
      }
      return { ...state, ...config };
    });
  },

  setAIPanelOpen(open: boolean) {
    set({ aiPanelOpen: open });
  },
}));
