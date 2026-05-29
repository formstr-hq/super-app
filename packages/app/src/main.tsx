import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { SnackbarProvider } from "notistack";
import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import "./index.css";
import { router } from "./router";
import { useAuthStore, useSettingsStore } from "./stores";
import { getTheme } from "./theme";

useAuthStore.getState().init();

function ThemedApp() {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const theme = useMemo(() => getTheme(themeMode), [themeMode]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        <RouterProvider router={router} />
      </SnackbarProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemedApp />
  </StrictMode>,
);
