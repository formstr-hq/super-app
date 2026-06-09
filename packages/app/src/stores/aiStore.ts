import { create } from "zustand";

import { createProvider, ConversationContext, Agent } from "../ai";
import type { Message, LLMProvider, EntityRef, RunStep, ConfirmRequest } from "../ai/types";

import { useAuthStore } from "./authStore";
import { useSettingsStore } from "./settingsStore";

// ── LocalStorage persistence helpers ────────────────────

const STORAGE_KEY_MESSAGES = "formstr:ai-messages";
const STORAGE_KEY_ENTITIES = "formstr:ai-entities";
const MAX_PERSISTED_MESSAGES = 100;

function loadPersistedMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MESSAGES);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Basic validation — each item must have id, role, content
    return (parsed as Message[])
      .filter(
        (m) =>
          m &&
          typeof m.id === "string" &&
          typeof m.role === "string" &&
          typeof m.content === "string",
      )
      .slice(-MAX_PERSISTED_MESSAGES);
  } catch {
    return [];
  }
}

function loadPersistedEntities(): EntityRef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ENTITIES);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as EntityRef[])
      .filter((e) => e && typeof e.module === "string" && typeof e.ref === "string")
      .slice(-50);
  } catch {
    return [];
  }
}

function persistMessages(messages: Message[]): void {
  try {
    // Only persist user + assistant messages (not system/tool)
    const toSave = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-MAX_PERSISTED_MESSAGES);
    localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(toSave));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function persistEntities(entities: EntityRef[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_ENTITIES, JSON.stringify(entities.slice(-50)));
  } catch {
    // silently skip
  }
}

function unavailableMessage(provider: string): string {
  if (provider === "ollama")
    return "Ollama is not reachable. Start it or pick a cloud provider in Settings.";
  if (provider === "openai-compat")
    return "No local endpoint configured. Set a base URL in Settings.";
  return "No API key configured for this provider. Add one in Settings.";
}

// ── Load persisted state and hydrate context ────────────

const _persistedMessages = loadPersistedMessages();
const _persistedEntities = loadPersistedEntities();
const _initialContext = new ConversationContext();
_initialContext.hydrateFromMessages(_persistedMessages, _persistedEntities);

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

  // Internal refs (not reactive state)
  _provider: LLMProvider | null;
  _context: ConversationContext;
  _agent: Agent | null;

  initProvider(): Promise<void>;
  sendMessage(content: string): Promise<void>;
  resolveConfirm(approved: boolean): void;
  setModel(model: string): void;
  reset(): void;
}

export const useAIStore = create<AIStore>((set, get) => ({
  messages: _persistedMessages,
  entities: _persistedEntities,
  isProcessing: false,
  streamingContent: "",
  streamingSteps: [],
  pendingConfirm: null,
  providerStatus: "disconnected",
  availableModels: [],
  errorMessage: null,

  _provider: null,
  _context: _initialContext,
  _agent: null,

  async initProvider() {
    const settings = useSettingsStore.getState();
    set({ providerStatus: "connecting", errorMessage: null });

    try {
      const provider = createProvider({
        aiProvider: settings.aiProvider,
        apiKeys: settings.apiKeys,
        ollamaUrl: settings.ollamaUrl,
        compatBaseUrl: settings.compatBaseUrl,
        compatKey: settings.compatKey,
      });

      if (!(await provider.isAvailable())) {
        set({ providerStatus: "error", errorMessage: unavailableMessage(settings.aiProvider) });
        return;
      }

      const models = await provider.getAvailableModels();
      const context = get()._context;
      const agent = new Agent(provider, context);

      // Auto-select the first model when none is chosen for this provider.
      if (!settings.aiModels[settings.aiProvider] && models.length > 0) {
        useSettingsStore.getState().setProviderModel(settings.aiProvider, models[0]);
      }

      set({
        _provider: provider,
        _agent: agent,
        availableModels: models,
        providerStatus: "connected",
      });
    } catch (e) {
      set({
        providerStatus: "error",
        errorMessage: e instanceof Error ? e.message : "Failed to connect to AI provider",
      });
    }
  },

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
    const { aiProvider, aiModels } = useSettingsStore.getState();
    const aiModel = aiModels[aiProvider] ?? undefined;
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
        aiModel,
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

  setModel(model: string) {
    const { aiProvider } = useSettingsStore.getState();
    useSettingsStore.getState().setProviderModel(aiProvider, model);
  },

  reset() {
    get()._context.reset();
    try {
      localStorage.removeItem(STORAGE_KEY_MESSAGES);
      localStorage.removeItem(STORAGE_KEY_ENTITIES);
    } catch {
      /* ignore */
    }
    set({
      messages: [],
      entities: [],
      streamingContent: "",
      streamingSteps: [],
      pendingConfirm: null,
      isProcessing: false,
      errorMessage: null,
    });
  },
}));
