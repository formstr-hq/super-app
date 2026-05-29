import { useNavigate } from "react-router-dom";
import { FileText, Calendar, Vote, FolderOpen, ClipboardList } from "lucide-react";
import { resolveRef } from "@formstr/core";
import type { EntityRef } from "../../ai/types";

const moduleIcons: Record<string, typeof FileText> = {
  forms: ClipboardList,
  calendar: Calendar,
  pages: FileText,
  drive: FolderOpen,
  polls: Vote,
};

const moduleColors: Record<string, string> = {
  forms: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  calendar: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  pages: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  drive: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  polls: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
};

interface EntityCardProps {
  entity: EntityRef;
}

export function EntityCard({ entity }: EntityCardProps) {
  const navigate = useNavigate();
  const Icon = moduleIcons[entity.module] ?? FileText;
  const colorClass = moduleColors[entity.module] ?? "bg-muted text-muted-foreground";

  const route = entity.route ?? (entity.ref ? resolveRef(entity.ref) : null);

  return (
    <button
      type="button"
      onClick={() => {
        if (route) navigate(route);
      }}
      disabled={!route}
      className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${colorClass} ${route ? "cursor-pointer hover:brightness-110" : "cursor-default opacity-80"}`}
      title={`${entity.module}: ${entity.label}`}
    >
      <Icon className="h-3 w-3" />
      <span className="max-w-[120px] truncate">{entity.label}</span>
    </button>
  );
}
