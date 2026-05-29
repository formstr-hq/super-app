import { createTheme, type Theme } from "@mui/material/styles";

export function getTheme(mode: "light" | "dark"): Theme {
  const isLight = mode === "light";
  return createTheme({
    palette: {
      mode,
      background: {
        default: isLight ? "#FFFFFF" : "#141414",
        paper: isLight ? "#F5F5F5" : "#1E1E1E",
      },
      text: {
        primary: isLight ? "#111111" : "#E5E5E5",
        secondary: isLight ? "#888888" : "#666666",
      },
      divider: isLight ? "#EBEBEB" : "#2A2A2A",
      primary: {
        main: isLight ? "#111111" : "#E5E5E5",
        contrastText: isLight ? "#FFFFFF" : "#111111",
      },
      error: { main: "#DC2626" },
    },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: 14,
      h1: { fontWeight: 700, letterSpacing: "-0.02em" },
      h2: { fontWeight: 700, letterSpacing: "-0.02em" },
      h3: { fontWeight: 700, letterSpacing: "-0.02em" },
      h4: { fontWeight: 700, letterSpacing: "-0.02em" },
      h5: { fontWeight: 700, letterSpacing: "-0.02em" },
      h6: { fontWeight: 700, letterSpacing: "-0.02em" },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { textTransform: "none", fontWeight: 500 } },
      },
      MuiPaper: {
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiAppBar: {
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiTooltip: {
        defaultProps: { arrow: false },
        styleOverrides: {
          tooltip: {
            fontSize: 12,
            backgroundColor: isLight ? "#111111" : "#E5E5E5",
            color: isLight ? "#FFFFFF" : "#111111",
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 5,
            "&.Mui-selected": {
              backgroundColor: isLight ? "#E8E8E8" : "#2A2A2A",
              "&:hover": { backgroundColor: isLight ? "#E0E0E0" : "#333333" },
            },
          },
        },
      },
    },
  });
}
