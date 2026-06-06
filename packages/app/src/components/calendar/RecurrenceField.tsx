import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";

import {
  buildRRuleString,
  describeRRule,
  partsToPreset,
  presetToParts,
  type RecurrencePreset,
  type RRuleParts,
} from "../../lib/rrule";

/**
 * Recurrence selector matching the standalone nostr-calendar exactly: a single
 * dropdown of presets (Does not repeat → Yearly) plus a "Custom Rule" entry that
 * opens a builder dialog. Non-custom repeats expose an "Ends" control
 * (Never / After N / On date).
 */

const PRESET_LABELS: Array<{ value: RecurrencePreset; label: string }> = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "weekdays", label: "Weekdays (Mon–Fri)" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom Rule" },
];

const WEEKDAY_OPTIONS = [
  { code: "SU", label: "S" },
  { code: "MO", label: "M" },
  { code: "TU", label: "T" },
  { code: "WE", label: "W" },
  { code: "TH", label: "T" },
  { code: "FR", label: "F" },
  { code: "SA", label: "S" },
] as const;

type EndMode = "never" | "count" | "until";

function endModeOf(parts: RRuleParts | null): EndMode {
  if (parts?.count) return "count";
  if (parts?.until) return "until";
  return "never";
}

interface RecurrenceFieldProps {
  value: RRuleParts | null;
  onChange: (value: RRuleParts | null) => void;
}

export function RecurrenceField({ value, onChange }: RecurrenceFieldProps) {
  const preset = partsToPreset(value);
  const isCustom = preset === "custom";
  const repeats = preset !== "none";
  const endMode = endModeOf(value);

  const [customOpen, setCustomOpen] = useState(false);

  const handlePreset = (next: RecurrencePreset) => {
    if (next === "custom") {
      // Seed the dialog from the current value (or a sensible default).
      if (!value) onChange({ freq: "WEEKLY", interval: 1 });
      setCustomOpen(true);
      return;
    }
    onChange(presetToParts(next, value));
  };

  const setEndMode = (mode: EndMode) => {
    if (!value) return;
    if (mode === "never") onChange({ ...value, count: undefined, until: undefined });
    else if (mode === "count") onChange({ ...value, count: value.count ?? 1, until: undefined });
    else {
      const def = new Date();
      def.setMonth(def.getMonth() + 1);
      onChange({
        ...value,
        until: value.until ?? def.toISOString().slice(0, 10),
        count: undefined,
      });
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <FormControl size="small" fullWidth>
        <InputLabel id="recurrence-label">Repeat</InputLabel>
        <Select
          labelId="recurrence-label"
          label="Repeat"
          value={preset}
          onChange={(e) => handlePreset(e.target.value as RecurrencePreset)}
          renderValue={(selected) => {
            if (selected === "custom") {
              const rrule = buildRRuleString(value);
              return rrule ? describeRRule(rrule) : "Custom Rule";
            }
            return PRESET_LABELS.find((p) => p.value === selected)?.label ?? "Does not repeat";
          }}
        >
          {PRESET_LABELS.map((p) => (
            <MenuItem key={p.value} value={p.value}>
              {p.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {isCustom && (
        <Box
          sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}
        >
          <Typography variant="caption" color="text.secondary">
            {describeRRule(buildRRuleString(value))}
          </Typography>
          <Button size="small" onClick={() => setCustomOpen(true)}>
            Edit rule
          </Button>
        </Box>
      )}

      {repeats && !isCustom && (
        <Box sx={{ display: "flex", gap: 1.5, flexDirection: { xs: "column", sm: "row" } }}>
          <FormControl size="small" sx={{ minWidth: { sm: 160 } }}>
            <InputLabel id="ends-label">Ends</InputLabel>
            <Select
              labelId="ends-label"
              label="Ends"
              value={endMode}
              onChange={(e) => setEndMode(e.target.value as EndMode)}
            >
              <MenuItem value="never">Never</MenuItem>
              <MenuItem value="count">After…</MenuItem>
              <MenuItem value="until">On date</MenuItem>
            </Select>
          </FormControl>

          {endMode === "count" && (
            <TextField
              size="small"
              type="number"
              label="Occurrences"
              inputProps={{ min: 1 }}
              value={value?.count ?? 1}
              onChange={(e) =>
                value && onChange({ ...value, count: Math.max(1, Number(e.target.value) || 1) })
              }
              sx={{ flex: 1 }}
            />
          )}
          {endMode === "until" && (
            <TextField
              size="small"
              type="date"
              label="End date"
              InputLabelProps={{ shrink: true }}
              value={value?.until ?? ""}
              onChange={(e) => value && onChange({ ...value, until: e.target.value || undefined })}
              sx={{ flex: 1 }}
            />
          )}
        </Box>
      )}

      <CustomRecurrenceDialog
        open={customOpen}
        value={value}
        onClose={() => setCustomOpen(false)}
        onSave={(parts) => {
          onChange(parts);
          setCustomOpen(false);
        }}
      />
    </Box>
  );
}

interface CustomDialogProps {
  open: boolean;
  value: RRuleParts | null;
  onClose: () => void;
  onSave: (parts: RRuleParts) => void;
}

function CustomRecurrenceDialog({ open, value, onClose, onSave }: CustomDialogProps) {
  const initialUnit = value?.freq === "DAILY" ? "day" : "week";
  const [unit, setUnit] = useState<"day" | "week">(initialUnit);
  const [interval, setInterval] = useState<number>(value?.interval ?? 1);
  const [days, setDays] = useState<string[]>(value?.byDay ?? []);
  const [endMode, setEndMode] = useState<EndMode>(endModeOf(value));
  const [count, setCount] = useState<number>(value?.count ?? 1);
  const [until, setUntil] = useState<string>(value?.until ?? "");

  // Re-seed when (re)opened with a fresh value.
  const [seenOpen, setSeenOpen] = useState(false);
  if (open && !seenOpen) {
    setSeenOpen(true);
    setUnit(value?.freq === "DAILY" ? "day" : "week");
    setInterval(value?.interval ?? 1);
    setDays(value?.byDay ?? []);
    setEndMode(endModeOf(value));
    setCount(value?.count ?? 1);
    setUntil(value?.until ?? "");
  }
  if (!open && seenOpen) setSeenOpen(false);

  const toggleDay = (code: string) =>
    setDays((prev) => (prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]));

  const save = () => {
    const parts: RRuleParts = {
      freq: unit === "day" ? "DAILY" : "WEEKLY",
      interval: Math.max(1, interval || 1),
      byDay: unit === "week" && days.length ? (days as RRuleParts["byDay"]) : undefined,
      count: endMode === "count" ? Math.max(1, count || 1) : undefined,
      until: endMode === "until" ? until || undefined : undefined,
    };
    onSave(parts);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Custom recurrence</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2">Repeat every</Typography>
          <TextField
            size="small"
            type="number"
            inputProps={{ min: 1 }}
            value={interval}
            onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))}
            sx={{ width: 80 }}
          />
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <Select value={unit} onChange={(e) => setUnit(e.target.value as "day" | "week")}>
              <MenuItem value="day">{interval > 1 ? "days" : "day"}</MenuItem>
              <MenuItem value="week">{interval > 1 ? "weeks" : "week"}</MenuItem>
            </Select>
          </FormControl>
        </Box>

        {unit === "week" && (
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Repeat on
            </Typography>
            <Box sx={{ display: "flex", gap: 0.5 }}>
              {WEEKDAY_OPTIONS.map((d, i) => {
                const selected = days.includes(d.code);
                return (
                  <Button
                    key={`${d.code}-${i}`}
                    onClick={() => toggleDay(d.code)}
                    variant={selected ? "contained" : "outlined"}
                    sx={{ minWidth: 36, px: 0, py: 0.25, fontSize: 12 }}
                  >
                    {d.label}
                  </Button>
                );
              })}
            </Box>
          </Box>
        )}

        <FormControl size="small" fullWidth>
          <InputLabel id="custom-ends">Ends</InputLabel>
          <Select
            labelId="custom-ends"
            label="Ends"
            value={endMode}
            onChange={(e) => setEndMode(e.target.value as EndMode)}
          >
            <MenuItem value="never">Never</MenuItem>
            <MenuItem value="count">After…</MenuItem>
            <MenuItem value="until">On date</MenuItem>
          </Select>
        </FormControl>
        {endMode === "count" && (
          <TextField
            size="small"
            type="number"
            label="Occurrences"
            inputProps={{ min: 1 }}
            value={count}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
          />
        )}
        {endMode === "until" && (
          <TextField
            size="small"
            type="date"
            label="End date"
            InputLabelProps={{ shrink: true }}
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
