import { Box, Divider, IconButton, Paper, TextField, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { AlertCircle, BookMarked, Loader2, Send, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useAIStore, useSettingsStore } from "../../stores";

import { AgentRunBlock } from "./AgentRunBlock";
import { ConfirmActionCard } from "./ConfirmActionCard";
import { EntityCard } from "./EntityCard";
import { MessageBubble } from "./MessageBubble";
import { ProviderModelPill } from "./ProviderModelPill";

function StatusDot({ status }: { status: string }) {
  const color =
    status === "connected"
      ? "#22c55e"
      : status === "connecting"
        ? "#eab308"
        : status === "error"
          ? "#ef4444"
          : "#9ca3af";
  return (
    <Box
      component="span"
      title={status}
      sx={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        bgcolor: color,
        animation: status === "connecting" ? "pulse 1.5s ease-in-out infinite" : undefined,
      }}
    />
  );
}

export function AIChatPanel() {
  const {
    messages,
    entities,
    isProcessing,
    streamingContent,
    streamingSteps,
    pendingConfirm,
    providerStatus,
    errorMessage,
    sendMessage,
    initProvider,
    reset,
    resolveConfirm,
  } = useAIStore();
  const { aiPanelOpen, setAIPanelOpen } = useSettingsStore();
  const savedPrompts = useSettingsStore((s) => s.savedPrompts);
  const [input, setInput] = useState("");
  const [promptIndex, setPromptIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  // "/keyword" autosuggest: active while the input is a single slash-token.
  const slashQuery = useMemo(() => {
    const m = /^\/(\S*)$/.exec(input);
    return m ? m[1].toLowerCase() : null;
  }, [input]);
  const promptMatches = useMemo(
    () =>
      slashQuery === null
        ? []
        : savedPrompts.filter((p) => p.keyword.startsWith(slashQuery)).slice(0, 6),
    [slashQuery, savedPrompts],
  );

  useEffect(() => {
    setPromptIndex(0);
  }, [slashQuery]);

  const acceptPrompt = useCallback((prompt: string) => {
    setInput(prompt);
  }, []);

  useEffect(() => {
    if (aiPanelOpen && providerStatus === "disconnected") initProvider();
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
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (promptMatches.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPromptIndex((i) => (i + 1) % promptMatches.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setPromptIndex((i) => (i - 1 + promptMatches.length) % promptMatches.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          acceptPrompt(promptMatches[Math.min(promptIndex, promptMatches.length - 1)].prompt);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setInput("");
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, promptMatches, promptIndex, acceptPrompt],
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
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: 380,
        flexShrink: 0,
        borderLeft: `1px solid ${theme.palette.divider}`,
        bgcolor: "background.default",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.5,
          borderBottom: `1px solid ${theme.palette.divider}`,
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Sparkles size={16} />
          <Typography variant="body2" fontWeight={600}>
            AI Assistant
          </Typography>
          <StatusDot status={providerStatus} />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <ProviderModelPill />
          <IconButton
            size="small"
            onClick={reset}
            title="Clear conversation"
            sx={{ color: "text.secondary" }}
          >
            <Trash2 size={15} />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => setAIPanelOpen(false)}
            sx={{ color: "text.secondary" }}
          >
            <X size={15} />
          </IconButton>
        </Box>
      </Box>

      {/* Messages */}
      <Box sx={{ flex: 1, overflowY: "auto", px: 2, py: 1.5 }}>
        {messages.length === 0 && !streamingContent && (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1.5,
              pt: 6,
              textAlign: "center",
            }}
          >
            <Sparkles size={32} style={{ color: theme.palette.text.secondary, opacity: 0.4 }} />
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Ask me to create forms, schedule events, write pages, create polls, or browse your
              files.
            </Typography>
          </Box>
        )}

        {messages
          .filter((m) => m.role !== "assistant" || m.content.trim() || (m.run && m.run.length > 0))
          .map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

        {isProcessing && streamingSteps.length > 0 && <AgentRunBlock steps={streamingSteps} />}

        {pendingConfirm && (
          <ConfirmActionCard
            request={pendingConfirm}
            onApprove={() => resolveConfirm(true)}
            onCancel={() => resolveConfirm(false)}
          />
        )}

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
          <Box
            sx={{ display: "flex", alignItems: "center", gap: 1, py: 1, color: "text.secondary" }}
          >
            <Loader2 size={14} style={{ animation: "spin 0.6s linear infinite" }} />
            <Typography variant="body2">Thinking...</Typography>
          </Box>
        )}

        {errorMessage && (
          <Box
            sx={{
              my: 1,
              display: "flex",
              alignItems: "flex-start",
              gap: 1,
              borderRadius: 1,
              bgcolor: "error.main",
              color: "error.contrastText",
              px: 1.5,
              py: 1,
              fontSize: 13,
              opacity: 0.9,
            }}
          >
            <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </Box>
        )}
        <div ref={messagesEndRef} />
      </Box>

      {/* Recent entities */}
      {recentEntities.length > 0 && (
        <Box sx={{ px: 2, py: 1, borderTop: `1px solid ${theme.palette.divider}` }}>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 0.5 }}>
            Recent
          </Typography>
          <Box sx={{ display: "flex", gap: 0.75, overflowX: "auto" }}>
            {recentEntities.map((entity, i) => (
              <EntityCard key={`${entity.ref}-${i}`} entity={entity} />
            ))}
          </Box>
        </Box>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            gap: 0.75,
            px: 2,
            py: 1,
            borderTop: `1px solid ${theme.palette.divider}`,
          }}
        >
          {suggestions.map((s) => (
            <Box
              key={s}
              component="button"
              onClick={() => setInput(s)}
              sx={{
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: "20px",
                px: 1.25,
                py: 0.5,
                fontSize: 12,
                color: "text.secondary",
                bgcolor: "transparent",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "background 150ms",
                "&:hover": { bgcolor: "action.hover", color: "text.primary" },
              }}
            >
              {s}
            </Box>
          ))}
        </Box>
      )}

      <Divider />

      {/* Input */}
      <Box sx={{ p: 1.5, position: "relative" }}>
        {promptMatches.length > 0 && (
          <Paper
            elevation={4}
            sx={{
              position: "absolute",
              bottom: "100%",
              left: 12,
              right: 12,
              mb: 0.5,
              borderRadius: 1.5,
              overflow: "hidden",
              zIndex: 10,
            }}
          >
            {promptMatches.map((p, i) => (
              <Box
                key={p.id}
                component="button"
                onMouseDown={(e: React.MouseEvent) => {
                  e.preventDefault();
                  acceptPrompt(p.prompt);
                }}
                onMouseEnter={() => setPromptIndex(i)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  px: 1.25,
                  py: 0.75,
                  bgcolor: i === promptIndex ? "action.selected" : "background.paper",
                }}
              >
                <BookMarked size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
                <Typography variant="caption" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                  /{p.keyword}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ flex: 1, minWidth: 0 }}
                >
                  {p.prompt}
                </Typography>
              </Box>
            ))}
            <Box sx={{ px: 1.25, py: 0.5, bgcolor: "action.hover" }}>
              <Typography variant="caption" color="text.secondary">
                ↑↓ to navigate · Enter to insert · Esc to dismiss
              </Typography>
            </Box>
          </Paper>
        )}
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-end",
            gap: 1,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 1.5,
            bgcolor: "background.paper",
            px: 1.5,
            py: 1,
          }}
        >
          <TextField
            multiline
            maxRows={4}
            variant="standard"
            fullWidth
            placeholder="Ask something… ( / for saved prompts)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            InputProps={{ disableUnderline: true, sx: { fontSize: 13 } }}
          />
          <IconButton
            size="small"
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            sx={{ color: "text.primary", mb: 0.25, "&:disabled": { opacity: 0.3 } }}
          >
            <Send size={16} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}
