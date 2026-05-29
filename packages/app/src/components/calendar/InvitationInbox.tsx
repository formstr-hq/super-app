import { Check, Inbox, Loader2, X, CircleHelp } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { rsvpToEvent } from "../../services/calendar/rsvp";
import { useInvitationsStore, type InvitationEntry } from "../../stores/invitationsStore";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

  useEffect(() => {
    start();
  }, [start]);

  const pending = invitations.filter((i) => !i.rsvp);
  if (pending.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5">
      <div className="flex items-center gap-2 border-b border-primary/20 px-3 py-2">
        <Inbox className="h-4 w-4 text-primary" />
        <p className="text-xs font-semibold text-foreground">Invitations ({pending.length})</p>
      </div>

      <div className="divide-y divide-primary/10">
        {pending.map((inv) => (
          <InvitationRow
            key={inv.wrapId}
            inv={inv}
            onAccept={async () => {
              try {
                await rsvpToEvent(inv.eventCoordinate, "accepted", inv.kind !== 31923);
                markRsvp(inv.eventCoordinate, "accepted");
                toast.success(`Accepted "${inv.event?.title ?? "event"}"`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "RSVP failed");
              }
            }}
            onDecline={async () => {
              try {
                await rsvpToEvent(inv.eventCoordinate, "declined", inv.kind !== 31923);
                markRsvp(inv.eventCoordinate, "declined");
                toast.success("Declined");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "RSVP failed");
              }
            }}
            onTentative={async () => {
              try {
                await rsvpToEvent(inv.eventCoordinate, "tentative", inv.kind !== 31923);
                markRsvp(inv.eventCoordinate, "tentative");
                toast.success("Marked tentative");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "RSVP failed");
              }
            }}
            onDismiss={() => dismiss(inv.wrapId)}
          />
        ))}
      </div>
    </div>
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

  const run = async (kind: "accept" | "decline" | "tentative", fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const title = inv.event?.title ?? "Event (not yet resolved)";
  const when = formatDate(inv.event?.begin);

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground truncate">{title}</p>
          {!inv.event && (
            <Badge variant="secondary" className="text-[10px] h-4 py-0">
              resolving…
            </Badge>
          )}
        </div>
        {when && <p className="text-xs text-muted-foreground truncate">{when}</p>}
      </div>

      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1 px-2 text-xs"
          disabled={!inv.event || busy !== null}
          onClick={() => run("accept", onAccept)}
        >
          {busy === "accept" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          disabled={!inv.event || busy !== null}
          onClick={() => run("tentative", onTentative)}
        >
          {busy === "tentative" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <CircleHelp className="h-3 w-3" />
          )}
          Maybe
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          disabled={!inv.event || busy !== null}
          onClick={() => run("decline", onDecline)}
        >
          {busy === "decline" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
          Decline
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground ml-1"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
