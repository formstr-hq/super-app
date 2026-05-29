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
  BarChart3,
  CheckCircle2,
  Clock,
  MessageSquare,
  Users,
} from "lucide-react";
import {
  AnswerType,
  type FormResponseEvent,
  type FormTemplate,
} from "../../services/forms/types";
import {
  computeFieldBreakdown,
  computeSummaryStats,
  formatDuration,
  formatPercent,
  type FieldBreakdown,
} from "../../lib/analytics";
import { cn } from "@/lib/utils";

// A small curated palette that adapts to theme via HSL vars
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
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <BarChart3 className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm font-medium">No data to analyse yet</p>
        <p className="text-xs text-muted-foreground">
          Charts will appear once responses start coming in.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<MessageSquare className="h-4 w-4" />}
          label="Total responses"
          value={stats.totalResponses.toString()}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Unique responders"
          value={stats.uniqueResponders.toString()}
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Completion rate"
          value={formatPercent(stats.completionRate)}
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Avg first response"
          value={formatDuration(stats.avgTimeToFirstResponseMs)}
        />
      </div>

      {/* Per-field breakdowns */}
      <div className="space-y-4">
        {breakdowns.map((b, i) => (
          <FieldPanel key={b.field.id} breakdown={b} accentIndex={i} />
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Stat card
// ═══════════════════════════════════════════════════════════

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Field panel
// ═══════════════════════════════════════════════════════════

function FieldPanel({
  breakdown,
  accentIndex,
}: {
  breakdown: FieldBreakdown;
  accentIndex: number;
}) {
  const accent = CHART_COLORS[accentIndex % CHART_COLORS.length];

  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {breakdown.field.label || "Untitled question"}
          </p>
          <p className="text-xs text-muted-foreground capitalize">
            {typeLabel(breakdown.field.type)}
          </p>
        </div>
      </div>
      <FieldBody breakdown={breakdown} accent={accent} />
    </div>
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

function FieldBody({
  breakdown,
  accent,
}: {
  breakdown: FieldBreakdown;
  accent: string;
}) {
  if (breakdown.kind === "choice") {
    const total = breakdown.rows.reduce((acc, r) => acc + r.count, 0);
    if (total === 0) {
      return <EmptyRow />;
    }
    return (
      <div className="space-y-2">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={breakdown.rows}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                horizontal={false}
              />
              <XAxis
                type="number"
                allowDecimals={false}
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
              />
              <YAxis
                type="category"
                dataKey="label"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                width={120}
                tickFormatter={(s: string) => (s.length > 18 ? `${s.slice(0, 16)}…` : s)}
              />
              <ChartTooltip
                cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" fill={accent} radius={[0, 4, 4, 0]}>
                {breakdown.rows.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-xs text-muted-foreground">
          {total} total {total === 1 ? "selection" : "selections"}
        </div>
      </div>
    );
  }

  if (breakdown.kind === "number") {
    if (breakdown.values.length === 0) return <EmptyRow />;
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <MiniStat label="Min" value={formatNumber(breakdown.min)} />
          <MiniStat label="Avg" value={formatNumber(breakdown.avg)} />
          <MiniStat label="Max" value={formatNumber(breakdown.max)} />
        </div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={breakdown.histogram}
              margin={{ top: 4, right: 8, bottom: 4, left: -16 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="bucket"
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={40}
              />
              <YAxis
                allowDecimals={false}
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
              />
              <ChartTooltip
                cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" fill={accent} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (breakdown.kind === "time") {
    if (breakdown.series.length === 0) return <EmptyRow />;
    return (
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={breakdown.series} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="label"
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              interval={0}
              angle={-20}
              textAnchor="end"
              height={40}
            />
            <YAxis
              allowDecimals={false}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
            />
            <ChartTooltip
              cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <Bar dataKey="count" fill={accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (breakdown.kind === "text") {
    if (breakdown.topTokens.length === 0) {
      return (
        <div className="py-2 text-xs text-muted-foreground">
          {breakdown.totalAnswered} response{breakdown.totalAnswered !== 1 ? "s" : ""} — no
          common words detected.
        </div>
      );
    }
    const maxCount = breakdown.topTokens[0]?.count ?? 1;
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          Top words across {breakdown.totalAnswered}{" "}
          response{breakdown.totalAnswered !== 1 ? "s" : ""}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {breakdown.topTokens.map((t) => {
            const weight = t.count / maxCount;
            return (
              <span
                key={t.token}
                className={cn(
                  "rounded-full border border-border px-2 py-0.5 text-xs",
                  weight > 0.7
                    ? "bg-primary/20 text-foreground font-medium"
                    : weight > 0.4
                      ? "bg-primary/10 text-foreground"
                      : "bg-muted/50 text-muted-foreground",
                )}
              >
                {t.token}
                <span className="ml-1 text-[10px] text-muted-foreground">{t.count}</span>
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function EmptyRow() {
  return <p className="py-2 text-xs text-muted-foreground">No answers yet.</p>;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
}
