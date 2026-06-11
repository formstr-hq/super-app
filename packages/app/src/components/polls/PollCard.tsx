import type { Poll } from "@formstr/agent/services/polls";
import { Box, Card, CardActionArea, CardContent, Chip, Typography } from "@mui/material";
import { BarChart3 } from "lucide-react";

interface PollCardProps {
  poll: Poll;
  onSelect: () => void;
}

export function PollCard({ poll, onSelect }: PollCardProps) {
  const ended = poll.endsAt ? poll.endsAt * 1000 < Date.now() : false;
  const date = new Date(poll.createdAt * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <Card
      variant="outlined"
      sx={{ borderRadius: 2, height: "100%", display: "flex", flexDirection: "column" }}
    >
      <CardActionArea
        onClick={onSelect}
        sx={{ flex: 1, alignItems: "flex-start", display: "flex" }}
      >
        <CardContent sx={{ flex: 1, width: "100%", pb: "16px !important" }}>
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 1 }}>
            <BarChart3 size={15} style={{ flexShrink: 0, marginTop: 2, opacity: 0.5 }} />
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{
                flex: 1,
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {poll.content || "Untitled poll"}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1.5 }}>
            {poll.pollType === "multiplechoice" && (
              <Chip label="Multiple" size="small" sx={{ height: 18, fontSize: 10 }} />
            )}
            <Chip
              label={ended ? "Ended" : date}
              size="small"
              color={ended ? "default" : "default"}
              sx={{ height: 18, fontSize: 10 }}
            />
            <Chip
              label={`${poll.options.length} options`}
              size="small"
              variant="outlined"
              sx={{ height: 18, fontSize: 10 }}
            />
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
