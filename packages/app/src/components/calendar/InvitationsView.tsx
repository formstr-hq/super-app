import { rsvpToEvent } from "@formstr/agent/services/calendar/rsvp";
import { Box, Button, Chip, CircularProgress, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ArrowLeft, Check, CircleHelp, Inbox, X } from "lucide-react";
import { useSnackbar } from "notistack";
import { useState } from "react";

import { useInvitationsStore, type InvitationEntry } from "../../stores/invitationsStore";
import { EmptyState } from "../EmptyState";

function formatDate(ms?: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface InvitationsViewProps {
  onBack: () => void;
}

/**
 * Full-panel invitations list, opened on demand from the calendar rail (it is no
 * longer rendered inline above the grid). Each pending invitation can be
 * answered with Accept / Maybe / Decline right here.
 */
export function InvitationsView({ onBack }: InvitationsViewProps) {
  const invitations = useInvitationsStore((s) => s.invitations);
  const markRsvp = useInvitationsStore((s) => s.markRsvp);
  const dismiss = useInvitationsStore((s) => s.dismiss);

  const pending = invitations.filter((i) => !i.rsvp);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5 }}>
        <Typography variant="h6" fontWeight={600}>
          Invitations · {pending.length}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<ArrowLeft size={15} />}
          onClick={onBack}
        >
          Back to calendar
        </Button>
      </Box>

      {pending.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No pending invitations"
          description="Invitations sent to your relays appear here — accept to add the event to your calendar."
          compact
        />
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {pending.map((inv) => (
            <InvitationRow
              key={inv.wrapId}
              inv={inv}
              onAccept={async () => {
                await rsvpToEvent(
                  inv.eventCoordinate,
                  "accepted",
                  inv.kind !== 31923,
                  undefined,
                  inv.viewKey,
                );
                markRsvp(inv.eventCoordinate, "accepted");
              }}
              onDecline={async () => {
                await rsvpToEvent(
                  inv.eventCoordinate,
                  "declined",
                  inv.kind !== 31923,
                  undefined,
                  inv.viewKey,
                );
                markRsvp(inv.eventCoordinate, "declined");
              }}
              onTentative={async () => {
                await rsvpToEvent(
                  inv.eventCoordinate,
                  "tentative",
                  inv.kind !== 31923,
                  undefined,
                  inv.viewKey,
                );
                markRsvp(inv.eventCoordinate, "tentative");
              }}
              onDismiss={() => dismiss(inv.wrapId)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

interface InvitationRowProps {
  inv: InvitationEntry;
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
  onTentative: () => Promise<void>;
  onDismiss: () => void;
}

function InvitationRow({ inv, onAccept, onDecline, onTentative, onDismiss }: InvitationRowProps) {
  const [busy, setBusy] = useState<"accept" | "decline" | "tentative" | null>(null);
  const { enqueueSnackbar } = useSnackbar();
  const theme = useTheme();

  const run = async (kind: "accept" | "decline" | "tentative", fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
      enqueueSnackbar(
        kind === "accept"
          ? "Accepted invitation"
          : kind === "decline"
            ? "Declined invitation"
            : "Marked tentative",
        { variant: "success" },
      );
    } catch {
      enqueueSnackbar("Failed to RSVP", { variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  const title = inv.event?.title ?? "Event (not yet resolved)";
  const when = formatDate(inv.event?.begin);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        py: 1.5,
        borderBottom: `1px solid ${theme.palette.divider}`,
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {title}
          </Typography>
          {!inv.event && <Chip label="resolving…" size="small" sx={{ height: 16, fontSize: 10 }} />}
        </Box>
        {when && (
          <Typography variant="caption" color="text.secondary" noWrap display="block">
            {when}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
        <Button
          size="small"
          variant="contained"
          startIcon={
            busy === "accept" ? <CircularProgress size={10} color="inherit" /> : <Check size={12} />
          }
          disabled={!inv.event || busy !== null}
          onClick={() => run("accept", onAccept)}
          sx={{ fontSize: 11.5, px: 1.25, py: 0.4, minWidth: 0 }}
        >
          Accept
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={
            busy === "tentative" ? (
              <CircularProgress size={10} color="inherit" />
            ) : (
              <CircleHelp size={12} />
            )
          }
          disabled={!inv.event || busy !== null}
          onClick={() => run("tentative", onTentative)}
          sx={{ fontSize: 11.5, px: 1.25, py: 0.4, minWidth: 0 }}
        >
          Maybe
        </Button>
        <Button
          size="small"
          variant="text"
          startIcon={
            busy === "decline" ? <CircularProgress size={10} color="inherit" /> : <X size={12} />
          }
          disabled={!inv.event || busy !== null}
          onClick={() => run("decline", onDecline)}
          sx={{ fontSize: 11.5, px: 1.25, py: 0.4, color: "text.secondary", minWidth: 0 }}
        >
          Decline
        </Button>
        <Button
          size="small"
          variant="text"
          onClick={onDismiss}
          sx={{ fontSize: 11.5, minWidth: 0, px: 0.5, color: "text.disabled", ml: 0.5 }}
          aria-label="Dismiss"
        >
          <X size={12} />
        </Button>
      </Box>
    </Box>
  );
}
