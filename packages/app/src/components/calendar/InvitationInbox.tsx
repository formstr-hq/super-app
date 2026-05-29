import { Box, Button, CircularProgress, Chip, Paper, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Check, Inbox, X, CircleHelp } from "lucide-react";
import { useSnackbar } from "notistack";
import { useEffect, useState } from "react";

import { rsvpToEvent } from "../../services/calendar/rsvp";
import { useInvitationsStore, type InvitationEntry } from "../../stores/invitationsStore";

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

export function InvitationInbox() {
  const invitations = useInvitationsStore((s) => s.invitations);
  const start = useInvitationsStore((s) => s.start);
  const markRsvp = useInvitationsStore((s) => s.markRsvp);
  const dismiss = useInvitationsStore((s) => s.dismiss);
  const theme = useTheme();

  useEffect(() => {
    start();
  }, [start]);

  const pending = invitations.filter((i) => !i.rsvp);
  if (pending.length === 0) return null;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        borderRadius: 1.5,
        mb: 2,
        borderColor: "primary.light",
        bgcolor: (t) => (t.palette.mode === "dark" ? "primary.900" : "primary.50"),
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
          pb: 1,
        }}
      >
        <Inbox size={14} color={theme.palette.primary.main} />
        <Typography variant="caption" fontWeight={600} color="primary.main">
          Invitations ({pending.length})
        </Typography>
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, mt: 1 }}>
        {pending.map((inv) => (
          <InvitationRow
            key={inv.wrapId}
            inv={inv}
            onAccept={async () => {
              await rsvpToEvent(inv.eventCoordinate, "accepted", inv.kind !== 31923);
              markRsvp(inv.eventCoordinate, "accepted");
            }}
            onDecline={async () => {
              await rsvpToEvent(inv.eventCoordinate, "declined", inv.kind !== 31923);
              markRsvp(inv.eventCoordinate, "declined");
            }}
            onTentative={async () => {
              await rsvpToEvent(inv.eventCoordinate, "tentative", inv.kind !== 31923);
              markRsvp(inv.eventCoordinate, "tentative");
            }}
            onDismiss={() => dismiss(inv.wrapId)}
          />
        ))}
      </Box>
    </Paper>
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
        gap: 1,
        justifyContent: "space-between",
        py: 0.5,
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" fontWeight={500} noWrap>
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
          sx={{ fontSize: 11, px: 1, py: 0.25, minWidth: 0 }}
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
          sx={{ fontSize: 11, px: 1, py: 0.25, minWidth: 0 }}
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
          sx={{ fontSize: 11, px: 1, py: 0.25, color: "text.secondary", minWidth: 0 }}
        >
          Decline
        </Button>
        <Button
          size="small"
          variant="text"
          onClick={onDismiss}
          sx={{ fontSize: 11, minWidth: 0, px: 0.5, color: "text.disabled", ml: 0.5 }}
          aria-label="Dismiss"
        >
          <X size={12} />
        </Button>
      </Box>
    </Box>
  );
}
