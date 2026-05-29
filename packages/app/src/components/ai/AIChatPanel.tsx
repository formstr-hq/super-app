import { useRef, useEffect, useState, useCallback, type KeyboardEvent } from "react";
import { X, Send, Trash2, Sparkles, Loader2, AlertCircle } from "lucide-react";
import { useAIStore, useSettingsStore } from "../../stores";
import { MessageBubble } from "./MessageBubble";
import { EntityCard } from "./EntityCard";

export function AIChatPanel() {
  const {
    messages,
    entities,
    isProcessing,
    streamingContent,
    providerStatus,
    errorMessage,
    availableModels,
    sendMessage,
    initProvider,
    reset,
    setModel,
  } = useAIStore();
  const { aiPanelOpen, setAIPanelOpen, aiModel } = useSettingsStore();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (aiPanelOpen && providerStatus === "disconnected") {
      initProvider();
    }
  }, [aiPanelOpen, providerStatus, initProvider]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;
    setInput("");
    sendMessage(trimmed);
  }, [input, isProcessing, sendMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  if (!aiPanelOpen) return null;

  const recentEntities = entities.slice(-5);

  const suggestions =
    messages.length === 0
      ? [
          "Create a feedback form",
          "Schedule a meeting for tomorrow at 3pm",
          "Create a poll about lunch options",
          "Write a project update page",
        ]
      : [];

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">AI Assistant</span>
          <StatusDot status={providerStatus} />
        </div>
        <div className="flex items-center gap-1">
          {availableModels.length > 0 && (
            <select
              value={aiModel ?? availableModels[0] ?? ""}
              onChange={(e) => setModel(e.target.value)}
              className="h-6 rounded border border-border bg-background px-1 text-[10px] text-muted-foreground outline-none max-w-[120px]"
              title="Select AI model"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/:latest$/, "")}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={reset}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Clear conversation"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setAIPanelOpen(false)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !streamingContent && (
          <div className="flex flex-col items-center justify-center gap-3 pt-12 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Ask me to create forms, schedule events, write pages, create polls, or browse your
              files.
            </p>
          </div>
        )}

        {messages
          .filter((m) => m.role !== "assistant" || m.content.trim())
          .map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

        {streamingContent && (
          <MessageBubble
            message={{
              id: "streaming",
              role: "assistant",
              content: streamingContent,
              timestamp: Date.now(),
            }}
            isStreaming
          />
        )}

        {isProcessing && !streamingContent && (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Thinking...</span>
          </div>
        )}

        {errorMessage && (
          <div className="my-2 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Recent Entities */}
      {recentEntities.length > 0 && (
        <div className="border-t border-border px-4 py-2">
          <p className="mb-1 text-xs text-muted-foreground">Recent</p>
          <div className="flex gap-2 overflow-x-auto">
            {recentEntities.map((entity, i) => (
              <EntityCard key={`${entity.ref}-${i}`} entity={entity} />
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => {
                setInput(s);
                textareaRef.current?.focus();
              }}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask something..."
            rows={1}
            className="max-h-24 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            className="rounded-md p-1 text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500 animate-pulse"
        : status === "error"
          ? "bg-red-500"
          : "bg-gray-400";

  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} title={status} />;
}
