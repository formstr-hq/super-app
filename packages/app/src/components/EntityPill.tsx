import { parseRef, resolveRef, type ModuleType } from "@formstr/core";
import { Box, Chip, CircularProgress, Tooltip, Typography } from "@mui/material";
import { Calendar, ClipboardList, FileText, FolderOpen, Vote, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCalendarStore } from "../stores/calendarStore";
import { useFormsStore } from "../stores/formsStore";
import { usePagesStore } from "../stores/pagesStore";
import { usePollsStore } from "../stores/pollsStore";

const MODULE_META: Record<
  ModuleType,
  {
    icon: typeof FileText;
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
  pages: {
    icon: FileText,
    label: "Page",
    color: "success",
  },
  drive: {
    icon: FolderOpen,
    label: "File",
    color: "secondary",
  },
  polls: {
    icon: Vote,
    label: "Poll",
    color: "primary",
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
