import { Box, Link, Typography } from "@mui/material";

export function AboutSection() {
  return (
    <Box sx={{ maxWidth: 560 }}>
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
        About
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
        Formstr is a suite of Nostr-native apps — forms, calendar, pages, polls, and drive — with an
        AI assistant that can act across every module. Your data lives on Nostr relays and (for
        files) Blossom servers; your AI keys stay on this device.
      </Typography>
      <Typography variant="body2">
        <Link
          href="https://formstr.app"
          target="_blank"
          rel="noopener noreferrer"
          underline="hover"
        >
          formstr.app
        </Link>
      </Typography>
    </Box>
  );
}
