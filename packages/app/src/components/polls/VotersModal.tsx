import type { OptionResult, PollOption } from "@formstr/agent/services/polls";
import { Box, Dialog, DialogContent, DialogTitle, Divider, Typography } from "@mui/material";
import { nip19 } from "nostr-tools";

interface VotersModalProps {
  open: boolean;
  onClose: () => void;
  options: PollOption[];
  results: Map<string, OptionResult>;
  totalVotes: number;
}

function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

export function VotersModal({ open, onClose, options, results, totalVotes }: VotersModalProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 0.5 }}>
        Voters
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {totalVotes} voter{totalVotes !== 1 ? "s" : ""}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {options.map((opt) => {
          const responders = results.get(opt.id)?.responders ?? [];
          return (
            <Box key={opt.id}>
              <Box
                sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
              >
                <Typography variant="body2" fontWeight={500}>
                  {opt.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {responders.length}
                </Typography>
              </Box>
              <Divider sx={{ my: 0.5 }} />
              {responders.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  No votes
                </Typography>
              ) : (
                responders.map((pk) => (
                  <Typography
                    key={pk}
                    variant="caption"
                    sx={{ display: "block", fontFamily: "monospace" }}
                  >
                    {shortNpub(pk)}
                  </Typography>
                ))
              )}
            </Box>
          );
        })}
      </DialogContent>
    </Dialog>
  );
}
