import { createTheme, type Theme } from "@mui/material/styles";

/**
 * "Asterisk" — the app's visual identity.
 *
 * Neutrals carry a slight green bias so the four module inks
 * (see lib/moduleAccent.ts) sit on them as chosen colour rather than as pops
 * against a dead grey. Module hues never appear here: this theme is
 * route-agnostic and reads them through the `--fs-accent*` variables that
 * AppShell writes to the document root.
 *
 * Three type roles, deliberately distinct:
 *   display — Bricolage Grotesque, headings only
 *   body    — Geist, everything you read as prose
 *   data    — Geist Mono, anything cryptographic (npubs, coordinates, relays,
 *             view keys, event ids) so identifiers stop masquerading as text
 */

export const DISPLAY_FONT = "'Bricolage Grotesque', 'Geist', system-ui, sans-serif";
export const BODY_FONT = "'Geist', system-ui, -apple-system, sans-serif";
export const MONO_FONT = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const LIGHT = {
  bg: "#FAFAF8",
  surface: "#F1F2EE",
  chrome: "#FFFFFF",
  ink: "#101211",
  dim: "#6C7370",
  line: "#E0E2DC",
  error: "#C4462F",
  selected: "#E6E7E1",
  hover: "#EDEEE9",
};

const DARK = {
  bg: "#101211",
  surface: "#171A18",
  chrome: "#0C0E0D",
  ink: "#E4E7E2",
  dim: "#8A918C",
  line: "#252927",
  error: "#E8705C",
  selected: "#22261F",
  hover: "#1C201D",
};

export function getTheme(mode: "light" | "dark"): Theme {
  const isLight = mode === "light";
  const c = isLight ? LIGHT : DARK;

  return createTheme({
    palette: {
      mode,
      background: { default: c.bg, paper: c.surface },
      text: { primary: c.ink, secondary: c.dim },
      divider: c.line,
      primary: { main: c.ink, contrastText: c.bg },
      error: { main: c.error },
      action: { selected: c.selected, hover: c.hover },
    },
    shape: { borderRadius: 7 },
    typography: {
      fontFamily: BODY_FONT,
      fontSize: 14,
      h1: { fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: "-0.035em" },
      h2: { fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: "-0.035em" },
      h3: { fontFamily: DISPLAY_FONT, fontWeight: 800, letterSpacing: "-0.03em" },
      h4: { fontFamily: DISPLAY_FONT, fontWeight: 700, letterSpacing: "-0.03em" },
      h5: { fontFamily: DISPLAY_FONT, fontWeight: 700, letterSpacing: "-0.025em" },
      h6: { fontFamily: DISPLAY_FONT, fontWeight: 700, letterSpacing: "-0.025em" },
      button: { letterSpacing: 0 },
      overline: { fontFamily: MONO_FONT, fontWeight: 500, letterSpacing: "0.14em" },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ":root": {
            "--fs-relay-down": c.error,
            "--fs-line": c.line,
            "--fs-surface": c.surface,
          },
          // The module ink owns focus everywhere, so keyboard position is always
          // legible and always says which module you are in.
          "*:focus-visible": {
            outline: "2px solid var(--fs-accent)",
            outlineOffset: "2px",
          },
          "::selection": { background: "var(--fs-accent-tint)" },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { textTransform: "none", fontWeight: 500 },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiAppBar: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiTooltip: {
        defaultProps: { arrow: false },
        styleOverrides: {
          tooltip: {
            fontSize: 12,
            backgroundColor: c.ink,
            color: c.bg,
            border: `1px solid ${c.line}`,
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            "&.Mui-selected": {
              backgroundColor: "var(--fs-accent-tint)",
              color: "var(--fs-accent)",
              "&:hover": { backgroundColor: "var(--fs-accent-tint)" },
            },
            "&:hover": { backgroundColor: "var(--fs-accent-wash)" },
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 500,
            "&.Mui-selected": { color: "var(--fs-accent)" },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: { backgroundColor: "var(--fs-accent)" },
        },
      },
      MuiCheckbox: { styleOverrides: { root: { "&.Mui-checked": { color: "var(--fs-accent)" } } } },
      MuiRadio: { styleOverrides: { root: { "&.Mui-checked": { color: "var(--fs-accent)" } } } },
      MuiSwitch: {
        styleOverrides: {
          switchBase: {
            "&.Mui-checked": { color: "var(--fs-accent)" },
            "&.Mui-checked + .MuiSwitch-track": { backgroundColor: "var(--fs-accent)" },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: "var(--fs-accent)",
              borderWidth: 1,
            },
          },
        },
      },
      MuiLink: { styleOverrides: { root: { color: "var(--fs-accent)" } } },
      // Dialogs, menus and cards are surfaces, not shadows — they read as
      // sheets sitting on the page rather than floating panels.
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 12,
            border: `1px solid ${c.line}`,
            backgroundImage: "none",
            boxShadow: isLight
              ? "0 24px 48px -32px rgba(16, 18, 17, 0.45)"
              : "0 24px 48px -28px rgba(0, 0, 0, 0.8)",
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            fontFamily: DISPLAY_FONT,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            fontSize: "1.0625rem",
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 10,
            border: `1px solid ${c.line}`,
            backgroundImage: "none",
            boxShadow: isLight
              ? "0 12px 28px -20px rgba(16, 18, 17, 0.5)"
              : "0 12px 28px -18px rgba(0, 0, 0, 0.85)",
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            "&&.Mui-selected": {
              backgroundColor: "var(--fs-accent-tint)",
              color: "var(--fs-accent)",
              "&:hover": { backgroundColor: "var(--fs-accent-tint)" },
            },
          },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { border: `1px solid ${c.line}`, backgroundImage: "none", borderRadius: 10 },
        },
      },
    },
  });
}
