import { createRef as createNostrRef, type ModuleType } from "@formstr/core";
import { Calendar, ClipboardList, FileText, FolderOpen, Vote } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";


import { CALENDAR_KINDS } from "../services/calendar/types";
import { FORM_KINDS } from "../services/forms/types";
import { PAGES_KINDS } from "../services/pages/types";
import { POLLS_KINDS } from "../services/polls/types";
import { useCalendarStore } from "../stores/calendarStore";
import { useFormsStore } from "../stores/formsStore";
import { usePagesStore } from "../stores/pagesStore";
import { usePollsStore } from "../stores/pollsStore";

import { cn } from "@/lib/utils";

export interface MentionItem {
  module: ModuleType;
  kind: number;
  pubkey: string;
  identifier: string;
  label: string;
  createdAt: number;
  /** Pre-computed naddr for insertion */
  naddr: string;
}

interface MentionPickerProps {
  /** Search query entered by the user (without the `@` prefix) */
  query: string;
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
  /** When true, the picker auto-loads each store's list on mount */
  autoFetch?: boolean;
  /** Which module kinds to show. Defaults to all. */
  modules?: ModuleType[];
  /** Max items shown in the list */
  limit?: number;
}

const MODULE_ICON: Record<ModuleType, typeof FileText> = {
  forms: ClipboardList,
  calendar: Calendar,
  pages: FileText,
  drive: FolderOpen,
  polls: Vote,
};

const MODULE_TINT: Record<ModuleType, string> = {
  forms: "text-blue-600 dark:text-blue-400",
  calendar: "text-orange-600 dark:text-orange-400",
  pages: "text-green-600 dark:text-green-400",
  drive: "text-purple-600 dark:text-purple-400",
  polls: "text-pink-600 dark:text-pink-400",
};

export function MentionPicker({
  query,
  onSelect,
  onClose,
  autoFetch = true,
  modules = ["forms", "calendar", "pages", "polls"],
  limit = 8,
}: MentionPickerProps) {
  const formsStore = useFormsStore();
  const calendarStore = useCalendarStore();
  const pagesStore = usePagesStore();
  const pollsStore = usePollsStore();

  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // One-time auto-fetch of each store so picker is useful immediately
  useEffect(() => {
    if (!autoFetch) return;
    if (modules.includes("forms") && formsStore.myForms.length === 0) {
      formsStore.fetchMyForms().catch(() => {});
    }
    if (modules.includes("calendar") && calendarStore.events.length === 0) {
      calendarStore.fetchEvents().catch(() => {});
    }
    if (modules.includes("pages") && pagesStore.pages.length === 0) {
      pagesStore.fetchMyPages().catch(() => {});
    }
    if (modules.includes("polls") && pollsStore.myPolls.length === 0) {
      pollsStore.fetchMyPolls().catch(() => {});
    }
    // We intentionally run this once; stores themselves manage memoized state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo<MentionItem[]>(() => {
    const all: MentionItem[] = [];

    if (modules.includes("forms")) {
      for (const f of formsStore.myForms) {
        all.push({
          module: "forms",
          kind: FORM_KINDS.template,
          pubkey: f.pubkey,
          identifier: f.id,
          label: f.name || "Untitled form",
          createdAt: f.createdAt,
          naddr: createNostrRef("forms", FORM_KINDS.template, f.pubkey, f.id),
        });
      }
    }

    if (modules.includes("calendar")) {
      for (const e of calendarStore.events) {
        const kind =
          e.kind === CALENDAR_KINDS.privateEvent || e.kind === CALENDAR_KINDS.publicEvent
            ? e.kind
            : CALENDAR_KINDS.publicEvent;
        all.push({
          module: "calendar",
          kind,
          pubkey: e.user,
          identifier: e.eventId,
          label: e.title || "Untitled event",
          createdAt: e.createdAt,
          naddr: createNostrRef("calendar", kind, e.user, e.eventId),
        });
      }
    }

    if (modules.includes("pages")) {
      for (const p of pagesStore.pages) {
        all.push({
          module: "pages",
          kind: PAGES_KINDS.document,
          pubkey: p.pubkey,
          identifier: p.id,
          label: p.title || "Untitled page",
          createdAt: p.createdAt,
          naddr: createNostrRef("pages", PAGES_KINDS.document, p.pubkey, p.id),
        });
      }
    }

    if (modules.includes("polls")) {
      for (const poll of pollsStore.myPolls) {
        const firstLine = (poll.content || "").split("\n")[0]?.trim() ?? "";
        all.push({
          module: "polls",
          kind: POLLS_KINDS.poll,
          pubkey: poll.pubkey,
          identifier: poll.id,
          label: firstLine.slice(0, 60) || "Untitled poll",
          createdAt: poll.createdAt,
          naddr: createNostrRef("polls", POLLS_KINDS.poll, poll.pubkey, poll.id),
        });
      }
    }

    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter((i) => i.label.toLowerCase().includes(q) || i.module.includes(q))
      : all;

    return filtered.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }, [
    query,
    modules,
    limit,
    formsStore.myForms,
    calendarStore.events,
    pagesStore.pages,
    pollsStore.myPolls,
  ]);

  // Keep highlight in range when filter changes
  useEffect(() => {
    if (highlight >= items.length) setHighlight(0);
  }, [items.length, highlight]);

  // Global keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (items.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + items.length) % items.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        onSelect(items[highlight]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [items, highlight, onSelect, onClose]);

  if (items.length === 0) {
    return (
      <div
        ref={containerRef}
        className="z-50 w-64 overflow-hidden rounded-md border border-border bg-popover shadow-lg"
      >
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {query
            ? `No entities match “${query}”`
            : "Nothing to mention yet — create a form, event, page, or poll first."}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="listbox"
      className="z-50 w-72 overflow-hidden rounded-md border border-border bg-popover shadow-lg"
    >
      <div className="max-h-64 overflow-y-auto py-1">
        {items.map((item, i) => {
          const Icon = MODULE_ICON[item.module];
          return (
            <button
              key={`${item.module}-${item.identifier}`}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                // onMouseDown to pre-empt blur when used inside contentEditable
                e.preventDefault();
                onSelect(item);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              )}
            >
              <Icon className={cn("h-3.5 w-3.5 shrink-0", MODULE_TINT[item.module])} />
              <span className="flex-1 truncate">{item.label}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {item.module}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
