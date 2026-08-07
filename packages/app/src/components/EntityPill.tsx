import { parseRef, resolveRef, type ModuleType } from "@formstr/core";
import { Box, Chip, CircularProgress, Tooltip, Typography } from "@mui/material";
import { Calendar, ClipboardList, FolderOpen, SquareKanban, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCalendarStore } from "../stores/calendarStore";
import { useFormsStore } from "../stores/formsStore";
import { useKanbanStore } from "../stores/kanbanStore";

const MODULE_META: Record<
  ModuleType,
  {
    icon: LucideIcon;
    label: string;
    color: "primary" | "secondary" | "info" | "success" | "warning";
  }
> = {
  forms: {
    icon: ClipboardList,
    label: "Form",
    color: "info",
  },
  calendar: {
    icon: Calendar,
    label: "Event",
    color: "warning",
  },
  kanban: {
    icon: SquareKanban,
    label: "Board",
    color: "success",
  },
  drive: {
    icon: FolderOpen,
    label: "File",
    color: "secondary",
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
      <Chip
        size="small"
        label={`${naddr.slice(0, 10)}…`}
        variant="outlined"
        sx={{ verticalAlign: "baseline", cursor: "default" }}
      />
    );
  }

  const meta = MODULE_META[ref.module];
  const Icon = meta.icon;
  const route = resolveRef(naddr) ?? `/${ref.module}`;

  const content = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Icon size={size === "sm" ? 12 : 14} />
      {resolving && !label ? (
        <CircularProgress size={12} color="inherit" />
      ) : (
        <Typography variant={size === "sm" ? "caption" : "body2"} sx={{ maxWidth: 180 }} noWrap>
          {label ?? meta.label}
        </Typography>
      )}
    </Box>
  );

  return (
    <Tooltip title={`${meta.label}: ${label ?? naddr}`}>
      <Chip
        size={size === "sm" ? "small" : "medium"}
        label={content}
        color={meta.color}
        onClick={readOnly ? undefined : () => navigate(route)}
        onDelete={onRemove ? () => onRemove() : undefined}
        deleteIcon={onRemove ? <X size={12} /> : undefined}
        sx={{
          verticalAlign: "baseline",
          cursor: readOnly ? "default" : "pointer",
          fontWeight: 500,
          "& .MuiChip-label": { px: 1 },
        }}
      />
    </Tooltip>
  );
}

// ── Resolve label from existing stores (no extra fetches) ────────

function useResolveLabel(
  module: ModuleType | undefined,
  params: Record<string, string> | undefined,
): [string | null, boolean] {
  const formsStore = useFormsStore();
  const calendarStore = useCalendarStore();
  const kanbanStore = useKanbanStore();

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
      case "kanban": {
        const match = kanbanStore.boards.find(
          (b) => b.id === identifier && (!pubkey || b.pubkey === pubkey),
        );
        found = match?.title ?? null;
        break;
      }
      case "drive":
        // Drive files are addressed differently; just leave label null for now
        found = null;
        break;
    }
    setLabel(found);
    setResolving(false);
  }, [module, params, formsStore.myForms, calendarStore.events, kanbanStore.boards]);

  return [label, resolving];
}
