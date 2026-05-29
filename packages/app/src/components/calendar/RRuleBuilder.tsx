import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  Grid2 as Grid,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useMemo } from "react";

import { buildRRuleString, type RRuleFreq, type RRuleParts } from "../../lib/rrule";

const DAYS: Array<RRuleParts["byDay"] extends (infer U)[] | undefined ? U : never> = [
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
  "SU",
];

interface RRuleBuilderProps {
  value: RRuleParts | null;
  onChange: (value: RRuleParts | null) => void;
}

export function RRuleBuilder({ value, onChange }: RRuleBuilderProps) {
  const enabled = value !== null;
  const parts: RRuleParts = value ?? { freq: "WEEKLY", interval: 1 };

  const update = useCallback(
    (patch: Partial<RRuleParts>) => {
      onChange({ ...parts, ...patch });
    },
    [parts, onChange],
  );

  const toggleDay = useCallback(
    (day: (typeof DAYS)[number]) => {
      const current = parts.byDay ?? [];
      const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
      update({ byDay: next.length ? next : undefined });
    },
    [parts.byDay, update],
  );

  const preview = useMemo(() => buildRRuleString(enabled ? parts : null), [enabled, parts]);

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, borderRadius: 1.5, display: "flex", flexDirection: "column", gap: 2 }}
    >
      <FormControlLabel
        control={
          <Checkbox
            checked={enabled}
            onChange={(e) => onChange(e.target.checked ? { freq: "WEEKLY", interval: 1 } : null)}
            size="small"
          />
        }
        label={
          <Typography variant="body2" fontWeight={500}>
            Repeats
          </Typography>
        }
      />

      {enabled && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 0.5 }}>
                Frequency
              </Typography>
              <FormControl size="small" fullWidth>
                <Select
                  value={parts.freq}
                  onChange={(e) => update({ freq: e.target.value as RRuleFreq })}
                >
                  <MenuItem value="DAILY">Daily</MenuItem>
                  <MenuItem value="WEEKLY">Weekly</MenuItem>
                  <MenuItem value="MONTHLY">Monthly</MenuItem>
                  <MenuItem value="YEARLY">Yearly</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 0.5 }}>
                Every
              </Typography>
              <TextField
                size="small"
                fullWidth
                type="number"
                inputProps={{ min: 1 }}
                value={parts.interval}
                onChange={(e) => update({ interval: Math.max(1, Number(e.target.value) || 1) })}
              />
            </Grid>
          </Grid>

          {parts.freq === "WEEKLY" && (
            <Box>
              <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 0.5 }}>
                On days
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                {DAYS.map((d) => {
                  const selected = parts.byDay?.includes(d) ?? false;
                  return (
                    <Button
                      key={d}
                      onClick={() => toggleDay(d)}
                      variant={selected ? "contained" : "outlined"}
                      size="small"
                      sx={{ minWidth: 40, px: 1, py: 0.25, fontSize: 11 }}
                    >
                      {d}
                    </Button>
                  );
                })}
              </Box>
            </Box>
          )}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 0.5 }}>
                Until (optional)
              </Typography>
              <TextField
                size="small"
                fullWidth
                type="date"
                value={parts.until ?? ""}
                onChange={(e) => update({ until: e.target.value || undefined })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 0.5 }}>
                Or count
              </Typography>
              <TextField
                size="small"
                fullWidth
                type="number"
                inputProps={{ min: 1 }}
                placeholder="Never ends"
                value={parts.count ?? ""}
                onChange={(e) =>
                  update({ count: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </Grid>
          </Grid>

          {preview && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
              RRULE: {preview}
            </Typography>
          )}
        </Box>
      )}
    </Paper>
  );
}
