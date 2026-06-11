import {
  addBusyRange,
  busyListMonthKey,
  fetchBusyListsForUser,
  removeBusyRange,
  type BusyRange,
} from "@formstr/agent/services/calendar/busyList";
import {
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Paper,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ArrowLeft,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  PlusCircle,
  Trash2,
} from "lucide-react";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useState } from "react";

import { useAuthStore } from "../../stores";
import { useSettingsStore } from "../../stores/settingsStore";
import { EmptyState } from "../EmptyState";

function formatRange(r: BusyRange) {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  return `${new Date(r.start).toLocaleString(undefined, opts)} → ${new Date(r.end).toLocaleString(
    undefined,
    opts,
  )}`;
}

/** datetime-local input value for a ms timestamp (local time, minute precision). */
function toInputValue(ms: number) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

interface AvailabilityViewProps {
  onBack: () => void;
}

/**
 * Manage the public free/busy list (kind 31926) that booking pages use to grey
 * out unavailable slots. Events created in the calendar publish their slots
 * automatically; this view shows the published ranges per month and lets the
 * user block extra time (or unblock) by hand.
 */
export function AvailabilityView({ onBack }: AvailabilityViewProps) {
  const pubkey = useAuthStore((s) => s.pubkey);
  const publishBusyTimes = useSettingsStore((s) => s.publishBusyTimes);
  const setPublishBusyTimes = useSettingsStore((s) => s.setPublishBusyTimes);
  const { enqueueSnackbar } = useSnackbar();

  const [monthOffset, setMonthOffset] = useState(0);
  const [ranges, setRanges] = useState<BusyRange[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
  const monthKey = busyListMonthKey(monthDate);
  const monthLabel = monthDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const defaultStart = Date.now() + 60 * 60_000;
  const [newStart, setNewStart] = useState(toInputValue(defaultStart));
  const [newEnd, setNewEnd] = useState(toInputValue(defaultStart + 60 * 60_000));

  const load = useCallback(async () => {
    if (!pubkey) return;
    setLoading(true);
    try {
      const lists = await fetchBusyListsForUser(pubkey, [monthKey]);
      setRanges(lists[0]?.ranges ?? []);
    } finally {
      setLoading(false);
    }
  }, [pubkey, monthKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
    const start = new Date(newStart).getTime();
    const end = new Date(newEnd).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      enqueueSnackbar("End must be after start", { variant: "error" });
      return;
    }
    setBusy(true);
    try {
      await addBusyRange({ start, end });
      enqueueSnackbar("Busy time published", { variant: "success" });
      await load();
    } catch {
      enqueueSnackbar("Could not publish busy time", { variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (range: BusyRange) => {
    setBusy(true);
    try {
      await removeBusyRange(range);
      enqueueSnackbar("Busy time removed", { variant: "success" });
      await load();
    } catch {
      enqueueSnackbar("Could not remove busy time", { variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography variant="h6" fontWeight={600}>
          Availability
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

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 640 }}>
        Times listed here are published as a public free/busy list — only the time ranges, never
        event titles — so your booking pages can grey out slots you&apos;re not available. Calendar
        events you create are added automatically; block extra time below.
      </Typography>

      {!pubkey ? (
        <Typography variant="body2" color="text.secondary">
          Log in to manage your availability.
        </Typography>
      ) : (
        <>
          <FormControlLabel
            sx={{ mb: 1, mr: 0, alignSelf: "flex-start" }}
            control={
              <Switch
                size="small"
                checked={publishBusyTimes}
                onChange={(e) => setPublishBusyTimes(e.target.checked)}
              />
            }
            label={
              <Typography variant="body2">
                Publish busy time automatically from my calendar events
              </Typography>
            }
          />

          {/* Month switcher */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1.5 }}>
            <IconButton size="small" onClick={() => setMonthOffset((m) => m - 1)}>
              <ChevronLeft size={16} />
            </IconButton>
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{ minWidth: 140, textAlign: "center" }}
            >
              {monthLabel}
            </Typography>
            <IconButton size="small" onClick={() => setMonthOffset((m) => m + 1)}>
              <ChevronRight size={16} />
            </IconButton>
            {loading && <CircularProgress size={14} sx={{ ml: 1 }} />}
          </Box>

          {/* Ranges */}
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", pr: 0.5 }}>
            {!loading && ranges.length === 0 ? (
              <EmptyState
                icon={CalendarRange}
                title="No busy time published"
                description="Calendar events publish busy slots automatically — or block extra time below."
                compact
              />
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, maxWidth: 560 }}>
                {ranges.map((r) => (
                  <Paper
                    key={`${r.start}-${r.end}`}
                    variant="outlined"
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      px: 1.5,
                      py: 0.75,
                      borderRadius: 1.5,
                    }}
                  >
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {formatRange(r)}
                    </Typography>
                    <Tooltip title="Remove (frees the slot on booking pages)">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={busy}
                          onClick={() => void handleRemove(r)}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Paper>
                ))}
              </Box>
            )}
          </Box>

          {/* Add range */}
          <Paper variant="outlined" sx={{ p: 1.5, mt: 1.5, borderRadius: 1.5, maxWidth: 560 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Block time
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
              <TextField
                size="small"
                type="datetime-local"
                label="From"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                size="small"
                type="datetime-local"
                label="To"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <Button
                size="small"
                variant="contained"
                startIcon={<PlusCircle size={14} />}
                disabled={busy}
                onClick={() => void handleAdd()}
              >
                Block
              </Button>
            </Box>
          </Paper>
        </>
      )}
    </Box>
  );
}
