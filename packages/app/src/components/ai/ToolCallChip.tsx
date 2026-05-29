import {
  Loader2,
  Check,
  X,
  ClipboardList,
  Calendar,
  FileText,
  FolderOpen,
  Vote,
  Wrench,
} from "lucide-react";
import type { ToolCall } from "../../ai/types";
import { moduleForTool } from "../../stores/aiPendingStore";

const moduleIcons = {
  forms: ClipboardList,
  calendar: Calendar,
  pages: FileText,
  drive: FolderOpen,
  polls: Vote,
} as const;

const moduleColors = {
  forms: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  calendar: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  pages: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  drive: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  polls: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300",
} as const;

function humanize(toolName: string): string {
  return toolName.replace(/_/g, " ");
}

interface ToolCallChipProps {
  toolCall: ToolCall;
}

export function ToolCallChip({ toolCall }: ToolCallChipProps) {
  const status = toolCall.status ?? "pending";
  const module = moduleForTool(toolCall.name);
  const Icon = module ? moduleIcons[module] : Wrench;
  const color = module ? moduleColors[module] : "border-border bg-muted text-foreground";

  const StatusIcon =
    status === "pending" ? Loader2 : status === "success" ? Check : X;
  const statusClass =
    status === "pending"
      ? "animate-spin opacity-80"
      : status === "success"
      ? "text-emerald-500"
      : "text-destructive";

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}
      title={toolCall.resultMessage ?? humanize(toolCall.name)}
    >
      <Icon className="h-3 w-3" />
      <span className="font-mono lowercase">{humanize(toolCall.name)}</span>
      <StatusIcon className={`h-3 w-3 ${statusClass}`} />
    </div>
  );
}
