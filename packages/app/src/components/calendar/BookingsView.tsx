import type { BookingRequest } from "@formstr/agent/services/calendar/booking";
import {
  Box,
  Button,
  CircularProgress,
  FormControl,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ArrowLeft, Check, X } from "lucide-react";
import { useSnackbar } from "notistack";
import { useEffect, useState } from "react";

import { formatNpub } from "../../lib/npub";
import { useBookingStore, useCalendarStore } from "../../stores";

function formatWhen(startMs: number, endMs: number) {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const date = start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${t(start)}–${t(end)}`;
}

interface BookingsViewProps {
  onBack: () => void;
}

/**
 * Bookings panel — incoming appointment requests (from the user's booking links)
 * with Approve / Decline, plus the list of already-accepted bookings. Opened on
 * demand from the calendar rail, mirroring the Invitations view.
 */
export function BookingsView({ onBack }: BookingsViewProps) {
  const { requests, isLoading, fetchAll, approve, decline } = useBookingStore();
  const calendars = useCalendarStore((s) => s.calendars);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const pending = requests.filter((r) => r.status === "pending");
  const accepted = requests.filter((r) => r.status === "approved");

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5 }}>
        <Typography variant="h6" fontWeight={600}>
          Bookings · {pending.length}
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

      {isLoading && requests.length === 0 ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={20} />
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Typography
            variant="caption"
            fontWeight={700}
            color="text.secondary"
            sx={{ letterSpacing: "0.06em", textTransform: "uppercase" }}
          >
            Pending requests
          </Typography>
          {pending.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              No pending booking requests.
            </Typography>
          ) : (
            pending.map((req) => (
              <BookingRow
                key={req.id}
                request={req}
                calendars={calendars}
                onApprove={approve}
                onDecline={decline}
              />
            ))
          )}

          {accepted.length > 0 && (
            <>
              <Typography
                variant="caption"
                fontWeight={700}
                color="text.secondary"
                sx={{
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  mt: 3,
                  display: "block",
                }}
              >
                Accepted · {accepted.length}
              </Typography>
              {accepted.map((req) => (
                <Box key={req.id} sx={{ py: 1 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {req.title || "Appointment"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {formatWhen(req.start, req.end)} · {formatNpub(req.bookerPubkey)}
                  </Typography>
                </Box>
              ))}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

interface BookingRowProps {
  request: BookingRequest;
  calendars: ReturnType<typeof useCalendarStore.getState>["calendars"];
  onApprove: (id: string, calendar: BookingRowProps["calendars"][number]) => Promise<void>;
  onDecline: (id: string, reason?: string) => Promise<void>;
}

function BookingRow({ request, calendars, onApprove, onDecline }: BookingRowProps) {
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();
  const [calendarId, setCalendarId] = useState(calendars[0]?.id ?? "");
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);

  const approve = async () => {
    const calendar = calendars.find((c) => c.id === calendarId);
    if (!calendar) {
      enqueueSnackbar("Create a calendar first to approve into.", { variant: "warning" });
      return;
    }
    setBusy("approve");
    try {
      await onApprove(request.id, calendar);
      enqueueSnackbar("Booking approved", { variant: "success" });
    } catch {
      enqueueSnackbar("Failed to approve booking", { variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    setBusy("decline");
    try {
      await onDecline(request.id);
      enqueueSnackbar("Booking declined", { variant: "success" });
    } catch {
      enqueueSnackbar("Failed to decline booking", { variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box sx={{ py: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
      <Typography variant="body2" fontWeight={600} noWrap>
        {request.title || "Appointment"}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block">
        {formatWhen(request.start, request.end)} · {formatNpub(request.bookerPubkey)}
      </Typography>
      {request.note && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
          "{request.note}"
        </Typography>
      )}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1, flexWrap: "wrap" }}>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <Select
            value={calendarId}
            displayEmpty
            onChange={(e) => setCalendarId(e.target.value)}
            renderValue={(v) =>
              calendars.find((c) => c.id === v)?.title ||
              (calendars.length ? "Calendar" : "No calendar")
            }
          >
            {calendars.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.title || "Untitled"}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          size="small"
          variant="contained"
          startIcon={
            busy === "approve" ? (
              <CircularProgress size={10} color="inherit" />
            ) : (
              <Check size={12} />
            )
          }
          disabled={busy !== null}
          onClick={approve}
          sx={{ fontSize: 11.5, px: 1.25, py: 0.4 }}
        >
          Approve
        </Button>
        <Button
          size="small"
          variant="text"
          startIcon={
            busy === "decline" ? <CircularProgress size={10} color="inherit" /> : <X size={12} />
          }
          disabled={busy !== null}
          onClick={decline}
          sx={{ fontSize: 11.5, px: 1.25, py: 0.4, color: "text.secondary" }}
        >
          Decline
        </Button>
      </Box>
    </Box>
  );
}
