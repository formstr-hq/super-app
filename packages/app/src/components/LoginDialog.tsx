import { Key, Puzzle, UserRound, Eye, EyeOff, Radio } from "lucide-react";
import { useState } from "react";

import { useAuthStore } from "../stores";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

export function LoginDialog({ open, onClose }: LoginDialogProps) {
  const { loginWithNsec, loginWithNip07, loginAsGuest } = useAuthStore();
  const [nsecExpanded, setNsecExpanded] = useState(false);
  const [nsec, setNsec] = useState("");
  const [showNsec, setShowNsec] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const wrap = async (key: string, fn: () => Promise<void>) => {
    setLoading(key);
    setError(null);
    try {
      await fn();
      setNsec("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="bg-primary/5 border-b border-border px-6 py-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Radio className="h-4 w-4 text-primary-foreground" />
            </div>
            <DialogTitle className="text-base font-semibold">Welcome to Formstr</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground ml-11">
            A decentralized workspace powered by Nostr
          </DialogDescription>
        </div>

        <div className="px-6 py-5 space-y-3">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* NIP-07 Extension — Primary */}
          <button
            onClick={() => wrap("nip07", loginWithNip07)}
            disabled={!!loading}
            className={cn(
              "w-full flex items-center gap-3 rounded-lg border-2 border-primary bg-primary/5 px-4 py-3",
              "hover:bg-primary/10 transition-colors duration-150 cursor-pointer disabled:opacity-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Puzzle className="h-5 w-5 text-primary shrink-0" />
            <div className="text-left flex-1">
              <div className="text-sm font-medium text-foreground">
                {loading === "nip07" ? "Connecting…" : "Browser Extension"}
              </div>
              <div className="text-xs text-muted-foreground">NIP-07 (Alby, nos2x, …)</div>
            </div>
            {loading === "nip07" && (
              <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
            )}
          </button>

          <Separator className="my-1" />

          {/* nsec — Expandable */}
          <div>
            <button
              onClick={() => setNsecExpanded((v) => !v)}
              className={cn(
                "w-full flex items-center gap-3 rounded-lg border border-border px-4 py-3",
                "hover:bg-accent transition-colors duration-150 cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                nsecExpanded && "rounded-b-none border-b-0",
              )}
            >
              <Key className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="text-left flex-1">
                <div className="text-sm font-medium text-foreground">Private Key</div>
                <div className="text-xs text-muted-foreground">nsec… or hex key</div>
              </div>
            </button>

            {nsecExpanded && (
              <div className="border border-t-0 border-border rounded-b-lg px-4 pb-4 pt-3 space-y-3 bg-accent/30">
                <div className="space-y-1.5">
                  <Label htmlFor="nsec-input" className="text-xs font-medium">
                    Private Key
                  </Label>
                  <div className="relative">
                    <Input
                      id="nsec-input"
                      type={showNsec ? "text" : "password"}
                      placeholder="nsec1…"
                      value={nsec}
                      onChange={(e) => setNsec(e.target.value)}
                      className="pr-9 text-sm font-mono h-9"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNsec((v) => !v)}
                      aria-label={showNsec ? "Hide key" : "Show key"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showNsec ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full h-8"
                  onClick={() => wrap("nsec", () => loginWithNsec(nsec))}
                  disabled={!nsec.trim() || !!loading}
                >
                  {loading === "nsec" ? "Signing in…" : "Sign in"}
                </Button>
              </div>
            )}
          </div>

          {/* Guest */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-9 gap-2 text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-border"
            onClick={() => wrap("guest", loginAsGuest)}
            disabled={!!loading}
          >
            <UserRound className="h-4 w-4" />
            {loading === "guest" ? "Creating account…" : "Continue as Guest"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
