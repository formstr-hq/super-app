import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";

import type { Message } from "../../ai/types";
import { renderRefs } from "../../lib/renderRefs";

import { AgentRunBlock } from "./AgentRunBlock";
import { ToolCallChip } from "./ToolCallChip";

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const theme = useTheme();

  const body =
    !isUser && !isStreaming && message.content ? renderRefs(message.content) : [message.content];
  const toolCalls = !isUser ? (message.toolCalls ?? []) : [];

  return (
    <Box
      sx={{
        mb: 1.5,
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <Box
        sx={{
          maxWidth: "85%",
          borderRadius: "10px",
          px: 1.5,
          py: 1,
          fontSize: 13,
          lineHeight: 1.6,
          bgcolor: isUser ? "text.primary" : "background.paper",
          color: isUser ? "background.default" : "text.primary",
          border: isUser ? "none" : `1px solid ${theme.palette.divider}`,
        }}
      >
        {message.run && message.run.length > 0 ? (
          <AgentRunBlock steps={message.run} />
        ) : (
          toolCalls.length > 0 && (
            <Box sx={{ mb: 1, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
              {toolCalls.map((tc) => (
                <ToolCallChip key={tc.id} toolCall={tc} />
              ))}
            </Box>
          )
        )}
        <Box sx={{ whiteSpace: "pre-wrap", wordBreak: "break-words" }}>
          {body.map((part, i) =>
            typeof part === "string" ? (
              <span key={i}>{part}</span>
            ) : (
              <Box component="span" key={i} sx={{ mx: 0.25 }}>
                {part}
              </Box>
            ),
          )}
          {isStreaming && (
            <Box
              component="span"
              sx={{
                display: "inline-block",
                width: 4,
                height: 14,
                bgcolor: "currentColor",
                ml: 0.25,
                verticalAlign: "text-bottom",
                animation: "blink 1s step-end infinite",
                "@keyframes blink": { "50%": { opacity: 0 } },
              }}
            />
          )}
        </Box>
        {!isStreaming && (
          <Typography
            variant="caption"
            sx={{ display: "block", mt: 0.5, opacity: 0.4, fontSize: 10 }}
          >
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
