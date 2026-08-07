import { CALENDAR_KINDS } from "@formstr/agent/services/calendar/types";
import { FORM_KINDS } from "@formstr/agent/services/forms/types";
import { createRef as createNostrRef, type ModuleType } from "@formstr/core";
import { KANBAN_KINDS } from "@formstr/kanban-sdk";
import { Box, Typography, Paper } from "@mui/material";
import { Calendar, ClipboardList, FolderOpen, SquareKanban } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCalendarStore } from "../stores/calendarStore";
import { useFormsStore } from "../stores/formsStore";
import { useKanbanStore } from "../stores/kanbanStore";

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

const MODULE_ICON: Record<ModuleType, LucideIcon> = {
  forms: ClipboardList,
  calendar: Calendar,
  kanban: SquareKanban,
  drive: FolderOpen,
};

const MODULE_TINT: Record<ModuleType, string> = {
  forms: "info.main",
  calendar: "warning.main",
  kanban: "success.main",
  drive: "secondary.main",
};

export function MentionPicker({
  query,
  onSelect,
  onClose,
  autoFetch = true,
  modules = ["forms", "calendar", "kanban"],
  limit = 8,
}: MentionPickerProps) {
  const formsStore = useFormsStore();
  const calendarStore = useCalendarStore();
  const kanbanStore = useKanbanStore();

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
    if (modules.includes("kanban") && kanbanStore.boards.length === 0) {
      kanbanStore.fetchBoards().catch(() => {});
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

    if (modules.includes("kanban")) {
      for (const b of kanbanStore.boards) {
        const kind = b.isPrivate ? KANBAN_KINDS.privateBoard : KANBAN_KINDS.publicBoard;
        all.push({
          module: "kanban",
          kind,
          pubkey: b.pubkey,
          identifier: b.id,
          label: b.title || "Untitled board",
          createdAt: b.createdAt,
          naddr: createNostrRef("kanban", kind, b.pubkey, b.id),
        });
      }
    }

    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter((i) => i.label.toLowerCase().includes(q) || i.module.includes(q))
      : all;

    return filtered.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }, [query, modules, limit, formsStore.myForms, calendarStore.events, kanbanStore.boards]);

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
      <Paper
        ref={containerRef}
        elevation={4}
        sx={{ width: 280, borderRadius: 1.5, overflow: "hidden", zIndex: 1300 }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", px: 2, py: 1.5 }}
        >
          {query
            ? `No entities match “${query}”`
            : "Nothing to mention yet — create a form, event, or board first."}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper
      ref={containerRef}
      role="listbox"
      elevation={4}
      sx={{ width: 300, borderRadius: 1.5, overflow: "hidden", zIndex: 1300 }}
    >
      <Box sx={{ maxHeight: 260, overflowY: "auto", py: 0.5 }}>
        {items.map((item, i) => {
          const Icon = MODULE_ICON[item.module];
          const selected = i === highlight;
          return (
            <Box
              key={`${item.module}-${item.identifier}`}
              component="button"
              role="option"
              aria-selected={selected}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
              sx={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                gap: 1.5,
                px: 2,
                py: 1,
                textAlign: "left",
                border: "none",
                cursor: "pointer",
                bgcolor: selected ? "action.selected" : "transparent",
                color: "text.primary",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Box sx={{ color: MODULE_TINT[item.module], display: "flex", alignItems: "center" }}>
                <Icon size={14} />
              </Box>
              <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                {item.label}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textTransform: "uppercase", fontSize: 10, letterSpacing: "0.05em" }}
              >
                {item.module}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
