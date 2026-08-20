import { Typography, type TypographyProps } from "@mui/material";

import { MONO_FONT } from "../theme";

/**
 * The data role: npubs, event ids, coordinates, relay URLs, view keys.
 *
 * Use it only where the value is *always* an identifier. Somewhere like
 * `displayNameFor`, which returns a profile name and falls back to an npub,
 * must not use it — that would set real names in the mono face.
 */
export function DataText({ sx, ...props }: TypographyProps) {
  return (
    <Typography
      {...props}
      sx={{
        fontFamily: MONO_FONT,
        fontFeatureSettings: '"zero" 1',
        letterSpacing: "-0.01em",
        ...sx,
      }}
    />
  );
}
