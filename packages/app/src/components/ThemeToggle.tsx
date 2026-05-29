import { IconButton } from "@mui/material";
import { Moon, Sun } from "lucide-react";

import { useSettingsStore } from "@/stores";

export function ThemeToggle() {
  const { themeMode, toggleTheme } = useSettingsStore();
  return (
    <IconButton
      size="small"
      onClick={toggleTheme}
      aria-label={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      sx={{ color: "text.secondary" }}
    >
      {themeMode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </IconButton>
  );
}
