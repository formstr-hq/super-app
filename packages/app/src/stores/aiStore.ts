import { create } from "zustand";
import type { Message, LLMProvider, ActionResult, EntityRef } from "../ai/types";
import { createLLMProvider, ConversationContext, IntentRouter } from "../ai";
import { useSettingsStore } from "./settingsStore";
import { useAuthStore } from "./authStore";

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
      .filter((m) => m && typeof m.id === "string" && typeof m.role === "string" && typeof m.content === "string")
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
  providerStatus: "disconnected" | "connecting" | "connected" | "error";
  availableModels: string[];
  errorMessage: string | null;

  // Internal refs (not reactive state)
  _provider: LLMProvider | null;
  _context: ConversationContext;
  _router: IntentRouter | null;

  initProvider(): Promise<void>;
  sendMessage(content: string): Promise<void>;
  setModel(model: string): void;
  reset(): void;
}

export const useAIStore = create<AIStore>((set, get) => ({
  messages: _persistedMessages,
  entities: _persistedEntities,
  isProcessing: false,
  streamingContent: "",
  providerStatus: "disconnected",
  availableModels: [],
  errorMessage: null,

  _provider: null,
  _context: _initialContext,
  _router: null,

  async initProvider() {
    const { aiProvider, aiEndpoint, aiModel, aiApiKey } = useSettingsStore.getState();
    set({ providerStatus: "connecting", errorMessage: null });

    try {
      const provider = await createLLMProvider({ aiProvider, aiEndpoint, aiModel, aiApiKey });
      const models = await provider.getAvailableModels();
      const context = get()._context;
      const router = new IntentRouter(provider, context);

      // Auto-select first model if none is configured
      if (!aiModel && models.length > 0) {
        useSettingsStore.getState().setAIConfig({ aiModel: models[0] });
      }

      set({
        _provider: provider,
        _router: router,
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
    const { _router, isProcessing } = get();
    if (isProcessing) return;

    if (!_router) {
      await get().initProvider();
      const router = get()._router;
      if (!router) {
        set({ errorMessage: "AI provider not available. Check your settings." });
        return;
      }
    }

    const router = get()._router!;
    const { aiModel } = useSettingsStore.getState();
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
      return { messages: msgs, isProcessing: true, streamingContent: "", errorMessage: null };
    });

    const assistantId = crypto.randomUUID();
    let fullContent = "";

    try {
      await router.routeStream(
        content,
        pubkey,
        {
          onToken(token: string) {
            fullContent += token;
            set({ streamingContent: fullContent });
          },
          onContentReset() {
            fullContent = "";
            set({ streamingContent: "" });
          },
          onToolCall() {
            // Tool call indicator is handled via action results
          },
          onActionResult(result: ActionResult) {
            if (result.entity) {
              set((state) => {
                const ents = [...state.entities, result.entity!];
                persistEntities(ents);
                return { entities: ents };
              });
            }
          },
          onDone: () => {
            // Don't save empty assistant messages (can happen when small
            // models return nothing, even after retry)
            if (fullContent.trim()) {
              const assistantMsg: Message = {
                id: assistantId,
                role: "assistant",
                content: fullContent,
                timestamp: Date.now(),
              };
              set((state) => {
                const msgs = [...state.messages, assistantMsg];
                persistMessages(msgs);
                return { messages: msgs, isProcessing: false, streamingContent: "" };
              });
            } else {
              set({ isProcessing: false, streamingContent: "" });
            }
          },
          onError: (error: Error) => {
            set({
              isProcessing: false,
              streamingContent: "",
              errorMessage: error.message,
            });
          },
        },
        aiModel ?? undefined,
      );
    } catch (e) {
      set({
        isProcessing: false,
        streamingContent: "",
        errorMessage: e instanceof Error ? e.message : "Failed to process message",
      });
    }
  },

  setModel(model: string) {
    useSettingsStore.getState().setAIConfig({ aiModel: model });
  },

  reset() {
    get()._context.reset();
    try {
      localStorage.removeItem(STORAGE_KEY_MESSAGES);
      localStorage.removeItem(STORAGE_KEY_ENTITIES);
    } catch { /* ignore */ }
    set({
      messages: [],
      entities: [],
      streamingContent: "",
      isProcessing: false,
      errorMessage: null,
    });
  },
}));
