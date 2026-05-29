import { parseRef, resolveRef, type ModuleType } from "@formstr/core";
import { Calendar, ClipboardList, FileText, FolderOpen, Loader2, Vote, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";


import { useCalendarStore } from "../stores/calendarStore";
import { useFormsStore } from "../stores/formsStore";
import { usePagesStore } from "../stores/pagesStore";
import { usePollsStore } from "../stores/pollsStore";

import { cn } from "@/lib/utils";

const MODULE_META: Record<
  ModuleType,
  {
    icon: typeof FileText;
    label: string;
    className: string;
  }
> = {
  forms: {
    icon: ClipboardList,
    label: "Form",
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
  },
  calendar: {
    icon: Calendar,
    label: "Event",
    className: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20",
  },
  pages: {
    icon: FileText,
    label: "Page",
    className: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20",
  },
  drive: {
    icon: FolderOpen,
    label: "File",
    className: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20",
  },
  polls: {
    icon: Vote,
    label: "Poll",
    className: "bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20",
  },
};

interface EntityPillProps {
  naddr: string;
  onRemove?: () => void;
  size?: "sm" | "md";
  /** When true, no click navigation (used inside editable content) */
  readOnly?: boolean;
}

/**
 * Lightweight cross-module reference chip. Takes an naddr / nevent and
 * renders icon + resolved name + deep link. Resolves labels from the
 * matching module's store without a new network request when possible.
 */
export function EntityPill({ naddr, onRemove, size = "sm", readOnly = false }: EntityPillProps) {
  const navigate = useNavigate();
  const ref = useMemo(() => parseRef(naddr), [naddr]);
  const [label, resolving] = useResolveLabel(ref?.module, ref?.params);

  if (!ref) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
        {naddr.slice(0, 10)}…
      </span>
    );
  }

  const meta = MODULE_META[ref.module];
  const Icon = meta.icon;
  const route = resolveRef(naddr) ?? `/${ref.module}`;

  return (
    <span
      role={readOnly ? undefined : "button"}
      tabIndex={readOnly ? -1 : 0}
      onClick={(e) => {
        if (readOnly) return;
        e.stopPropagation();
        navigate(route);
      }}
      onKeyDown={(e) => {
        if (readOnly) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(route);
        }
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-medium align-baseline transition-colors",
        meta.className,
        readOnly ? "cursor-default" : "cursor-pointer hover:brightness-110",
        size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm",
      )}
      title={`${meta.label}: ${label ?? naddr}`}
    >
      <Icon className={size === "sm" ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"} />
      {resolving && !label ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <span className="max-w-[180px] truncate">{label ?? meta.label}</span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm hover:bg-current/10"
          aria-label="Remove link"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

// ── Resolve label from existing stores (no extra fetches) ────────

function useResolveLabel(
  module: ModuleType | undefined,
  params: Record<string, string> | undefined,
): [string | null, boolean] {
  const formsStore = useFormsStore();
  const calendarStore = useCalendarStore();
  const pagesStore = usePagesStore();
  const pollsStore = usePollsStore();

  const [label, setLabel] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!module || !params) {
      setLabel(null);
      return;
    }
    setResolving(true);

    const identifier = params.identifier ?? params.id;
    const pubkey = params.pubkey;

    let found: string | null = null;
    switch (module) {
      case "forms": {
        const match = formsStore.myForms.find(
          (f) => f.id === identifier && (!pubkey || f.pubkey === pubkey),
        );
        found = match?.name ?? null;
        break;
      }
      case "calendar": {
        const match = calendarStore.events.find(
          (e) => e.eventId === identifier || e.id === identifier,
        );
        found = match?.title ?? null;
        break;
      }
      case "pages": {
        const match = pagesStore.pages.find(
          (p) => p.id === identifier && (!pubkey || p.pubkey === pubkey),
        );
        found = match?.title ?? null;
        break;
      }
      case "polls": {
        const match = pollsStore.myPolls.find(
          (p) => p.id === identifier && (!pubkey || p.pubkey === pubkey),
        );
        // Show first line of question as label
        if (match?.content) {
          const firstLine = match.content.split("\n")[0]?.trim() ?? "";
          found = firstLine.slice(0, 60) || null;
        }
        break;
      }
      case "drive":
        // Drive files are addressed differently; just leave label null for now
        found = null;
        break;
    }
    setLabel(found);
    setResolving(false);
  }, [
    module,
    params,
    formsStore.myForms,
    calendarStore.events,
    pagesStore.pages,
    pollsStore.myPolls,
  ]);

  return [label, resolving];
}
