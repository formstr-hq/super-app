import { Box, Chip, Grid2 as Grid, Paper, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { BarChart3, CheckCircle2, Clock, MessageSquare, Users } from "lucide-react";
import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from "recharts";

import {
  computeFieldBreakdown,
  computeSummaryStats,
  formatDuration,
  formatPercent,
  type FieldBreakdown,
} from "../../lib/analytics";
import { AnswerType, type FormResponseEvent, type FormTemplate } from "../../services/forms/types";

const CHART_COLORS = [
  "hsl(222 83% 58%)",
  "hsl(262 83% 65%)",
  "hsl(160 70% 45%)",
  "hsl(24 90% 58%)",
  "hsl(340 82% 60%)",
  "hsl(200 80% 50%)",
  "hsl(45 90% 55%)",
  "hsl(290 70% 60%)",
];

interface FormAnalyticsProps {
  form: FormTemplate;
  responses: FormResponseEvent[];
}

export function FormAnalytics({ form, responses }: FormAnalyticsProps) {
  const theme = useTheme();
  const stats = useMemo(() => computeSummaryStats(form, responses), [form, responses]);
  const breakdowns = useMemo(
    () =>
      form.fields
        .filter((f) => f.type !== AnswerType.label)
        .map((f) => computeFieldBreakdown(f, responses)),
    [form.fields, responses],
  );

  if (responses.length === 0) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          py: 8,
          gap: 1,
          textAlign: "center",
        }}
      >
        <BarChart3 size={40} color={theme.palette.text.secondary} />
        <Typography variant="body2" fontWeight={500}>
          No data to analyse yet
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Charts will appear once responses start coming in.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* Summary stat cards */}
      <Grid container spacing={1.5}>
        {[
          {
            icon: <MessageSquare size={16} />,
            label: "Total responses",
            value: stats.totalResponses.toString(),
          },
          {
            icon: <Users size={16} />,
            label: "Unique responders",
            value: stats.uniqueResponders.toString(),
          },
          {
            icon: <CheckCircle2 size={16} />,
            label: "Completion rate",
            value: formatPercent(stats.completionRate),
          },
          {
            icon: <Clock size={16} />,
            label: "Avg first response",
            value: formatDuration(stats.avgTimeToFirstResponseMs),
          },
        ].map((card) => (
          <Grid key={card.label} size={{ xs: 6, sm: 3 }}>
            <StatCard {...card} />
          </Grid>
        ))}
      </Grid>

      {/* Per-field breakdowns */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {breakdowns.map((b, i) => (
          <FieldPanel key={b.field.id} breakdown={b} accentIndex={i} />
        ))}
      </Box>
    </Box>
  );
}

// ── Stat card ────────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "text.secondary" }}>
        {icon}
        <Typography variant="caption">{label}</Typography>
      </Box>
      <Typography
        variant="h5"
        sx={{ mt: 0.75, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </Typography>
    </Paper>
  );
}

// ── Field panel ───────────────────────────────────────────

function FieldPanel({
  breakdown,
  accentIndex,
}: {
  breakdown: FieldBreakdown;
  accentIndex: number;
}) {
  const accent = CHART_COLORS[accentIndex % CHART_COLORS.length];
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 1,
          mb: 2,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={500} noWrap>
            {breakdown.field.label || "Untitled question"}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: "capitalize" }}>
            {typeLabel(breakdown.field.type)}
          </Typography>
        </Box>
      </Box>
      <FieldBody breakdown={breakdown} accent={accent} />
    </Paper>
  );
}

function typeLabel(t: AnswerType): string {
  switch (t) {
    case AnswerType.shortText:
      return "Short answer";
    case AnswerType.paragraph:
      return "Paragraph";
    case AnswerType.radioButton:
      return "Multiple choice";
    case AnswerType.checkboxes:
      return "Checkboxes";
    case AnswerType.dropdown:
      return "Dropdown";
    case AnswerType.number:
      return "Number";
    case AnswerType.date:
      return "Date";
    case AnswerType.time:
      return "Time";
    case AnswerType.datetime:
      return "Date & time";
    case AnswerType.fileUpload:
      return "File upload";
    default:
      return t;
  }
}

function FieldBody({ breakdown, accent }: { breakdown: FieldBreakdown; accent: string }) {
  const theme = useTheme();
  const chartTooltipStyle = {
    background: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 6,
    fontSize: 12,
    color: theme.palette.text.primary,
  };

  if (breakdown.kind === "choice") {
    const total = breakdown.rows.reduce((acc, r) => acc + r.count, 0);
    if (total === 0) return <EmptyRow />;
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ height: 192 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={breakdown.rows}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={theme.palette.divider}
                horizontal={false}
              />
              <XAxis
                type="number"
                allowDecimals={false}
                stroke={theme.palette.text.secondary}
                fontSize={11}
              />
              <YAxis
                type="category"
                dataKey="label"
                stroke={theme.palette.text.secondary}
                fontSize={11}
                width={120}
                tickFormatter={(s: string) => (s.length > 18 ? `${s.slice(0, 16)}…` : s)}
              />
              <ChartTooltip
                cursor={{ fill: theme.palette.action.hover }}
                contentStyle={chartTooltipStyle}
              />
              <Bar dataKey="count" fill={accent} radius={[0, 4, 4, 0]}>
                {breakdown.rows.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
        <Typography variant="caption" color="text.secondary">
          {total} total {total === 1 ? "selection" : "selections"}
        </Typography>
      </Box>
    );
  }

  if (breakdown.kind === "number") {
    if (breakdown.values.length === 0) return <EmptyRow />;
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Grid container spacing={1}>
          {[
            { label: "Min", value: formatNumber(breakdown.min) },
            { label: "Avg", value: formatNumber(breakdown.avg) },
            { label: "Max", value: formatNumber(breakdown.max) },
          ].map((s) => (
            <Grid key={s.label} size={{ xs: 4 }}>
              <MiniStat {...s} />
            </Grid>
          ))}
        </Grid>
        <Box sx={{ height: 176 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={breakdown.histogram}
              margin={{ top: 4, right: 8, bottom: 4, left: -16 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
              <XAxis
                dataKey="bucket"
                stroke={theme.palette.text.secondary}
                fontSize={10}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={40}
              />
              <YAxis allowDecimals={false} stroke={theme.palette.text.secondary} fontSize={11} />
              <ChartTooltip
                cursor={{ fill: theme.palette.action.hover }}
                contentStyle={chartTooltipStyle}
              />
              <Bar dataKey="count" fill={accent} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Box>
    );
  }

  if (breakdown.kind === "time") {
    if (breakdown.series.length === 0) return <EmptyRow />;
    return (
      <Box sx={{ height: 176 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={breakdown.series} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
            <XAxis
              dataKey="label"
              stroke={theme.palette.text.secondary}
              fontSize={10}
              interval={0}
              angle={-20}
              textAnchor="end"
              height={40}
            />
            <YAxis allowDecimals={false} stroke={theme.palette.text.secondary} fontSize={11} />
            <ChartTooltip
              cursor={{ fill: theme.palette.action.hover }}
              contentStyle={chartTooltipStyle}
            />
            <Bar dataKey="count" fill={accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (breakdown.kind === "text") {
    if (breakdown.topTokens.length === 0) {
      return (
        <Typography variant="caption" color="text.secondary">
          {breakdown.totalAnswered} response{breakdown.totalAnswered !== 1 ? "s" : ""} — no common
          words detected.
        </Typography>
      );
    }
    const maxCount = breakdown.topTokens[0]?.count ?? 1;
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Top words across {breakdown.totalAnswered} response
          {breakdown.totalAnswered !== 1 ? "s" : ""}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
          {breakdown.topTokens.map((t) => {
            const weight = t.count / maxCount;
            return (
              <Chip
                key={t.token}
                size="small"
                label={`${t.token} ${t.count}`}
                variant={weight > 0.7 ? "filled" : "outlined"}
                sx={{
                  fontWeight: weight > 0.7 ? 600 : 400,
                  opacity: weight > 0.4 ? 1 : 0.6,
                  fontSize: 11,
                }}
              />
            );
          })}
        </Box>
      </Box>
    );
  }

  return null;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ bgcolor: "action.hover", borderRadius: 1, px: 1, py: 0.75, textAlign: "center" }}>
      <Typography
        variant="caption"
        sx={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "text.secondary",
        }}
      >
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
    </Box>
  );
}

function EmptyRow() {
  return (
    <Typography variant="caption" color="text.secondary">
      No answers yet.
    </Typography>
  );
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
}
