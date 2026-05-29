import type { Message } from "../../ai/types";
import { renderRefs } from "../../lib/renderRefs";
import { ToolCallChip } from "./ToolCallChip";

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === "user";

  // Assistant messages are scanned for cross-module refs and rendered as pills.
  // User messages stay plain (they may be in-flight and contain pasted naddrs).
  const body =
    !isUser && !isStreaming && message.content ? renderRefs(message.content) : [message.content];

  const toolCalls = !isUser ? (message.toolCalls ?? []) : [];

  return (
    <div className={`mb-3 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        }`}
      >
        {toolCalls.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {toolCalls.map((tc) => (
              <ToolCallChip key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">
          {body.map((part, i) =>
            typeof part === "string" ? (
              <span key={i}>{part}</span>
            ) : (
              <span key={i} className="mx-0.5">
                {part}
              </span>
            ),
          )}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-current align-text-bottom" />
          )}
        </div>
        {!isStreaming && (
          <div className="mt-1 text-[10px] opacity-50">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        )}
      </div>
    </div>
  );
}
