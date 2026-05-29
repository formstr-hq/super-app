import { useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      const next = current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day];
      update({ byDay: next.length ? next : undefined });
    },
    [parts.byDay, update],
  );

  const preview = useMemo(() => buildRRuleString(enabled ? parts : null), [enabled, parts]);

  return (
    <div className="rounded-md border border-border p-3 space-y-3 text-xs">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onChange(e.target.checked ? { freq: "WEEKLY", interval: 1 } : null)
          }
        />
        <span className="text-sm font-medium">Repeats</span>
      </label>

      {enabled && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Frequency</Label>
              <Select
                value={parts.freq}
                onValueChange={(v: RRuleFreq) => update({ freq: v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">Daily</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="YEARLY">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Every</Label>
              <Input
                type="number"
                min={1}
                value={parts.interval}
                onChange={(e) =>
                  update({ interval: Math.max(1, Number(e.target.value) || 1) })
                }
                className="h-8 text-xs"
              />
            </div>
          </div>

          {parts.freq === "WEEKLY" && (
            <div className="space-y-1">
              <Label>On days</Label>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d) => {
                  const selected = parts.byDay?.includes(d) ?? false;
                  return (
                    <button
                      type="button"
                      key={d}
                      onClick={() => toggleDay(d)}
                      className={`h-7 w-10 rounded border text-[11px] font-medium transition-colors ${
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Until (optional)</Label>
              <Input
                type="date"
                value={parts.until ?? ""}
                onChange={(e) => update({ until: e.target.value || undefined })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label>Or count</Label>
              <Input
                type="number"
                min={1}
                placeholder="Never ends"
                value={parts.count ?? ""}
                onChange={(e) =>
                  update({ count: e.target.value ? Number(e.target.value) : undefined })
                }
                className="h-8 text-xs"
              />
            </div>
          </div>

          {preview && (
            <p className="text-[11px] text-muted-foreground">
              RRULE: <span className="font-mono">{preview}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
