import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAIPendingStore, type AIModule } from "../../stores/aiPendingStore";

interface AIPendingRowProps {
  module: AIModule;
  label?: string;
}

/**
 * Placeholder row rendered at the top of a module's list whenever the AI
 * assistant has a write in flight for that module. Lets the user see that
 * something is happening in the module even before the network round-trip
 * completes.
 */
export function AIPendingRow({ module, label }: AIPendingRowProps) {
  // Select the stable array reference; filter in a memo so the selector
  // does not return a new array every render (which would cause
  // useSyncExternalStore to loop indefinitely).
  const allPending = useAIPendingStore((s) => s.pending);
  const pending = useMemo(
    () => allPending.filter((p) => p.module === module),
    [allPending, module],
  );
  if (pending.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3">
      {pending.map((entry) => (
        <div key={entry.id} className="flex items-center gap-3">
          <Sparkles className="h-4 w-4 shrink-0 animate-pulse text-primary" />
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-primary">
              <span>AI is running</span>
              <span className="font-mono">{entry.toolName}</span>
              {label && <span className="text-muted-foreground">— {label}</span>}
            </div>
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
