import { Box, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { LayoutGrid, List, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

import { useSettingsStore } from "../../stores/settingsStore";

function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        py: 1.5,
      }}
    >
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {hint}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

export function GeneralSettings() {
  const { themeMode, toggleTheme, formsView, setFormsView } = useSettingsStore();

  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
        General
      </Typography>
      <Box sx={{ maxWidth: 560 }}>
        <Row title="Theme" hint="Light or dark appearance">
          <ToggleButtonGroup
            size="small"
            exclusive
            value={themeMode}
            onChange={(_, v) => {
              if (v && v !== themeMode) toggleTheme();
            }}
          >
            <ToggleButton value="light" sx={{ textTransform: "none", gap: 0.75 }}>
              <Sun size={15} /> Light
            </ToggleButton>
            <ToggleButton value="dark" sx={{ textTransform: "none", gap: 0.75 }}>
              <Moon size={15} /> Dark
            </ToggleButton>
          </ToggleButtonGroup>
        </Row>

        <Row title="Forms layout" hint="Default view for the forms list">
          <ToggleButtonGroup
            size="small"
            exclusive
            value={formsView}
            onChange={(_, v) => {
              if (v) setFormsView(v);
            }}
          >
            <ToggleButton value="grid" sx={{ textTransform: "none", gap: 0.75 }}>
              <LayoutGrid size={15} /> Grid
            </ToggleButton>
            <ToggleButton value="list" sx={{ textTransform: "none", gap: 0.75 }}>
              <List size={15} /> List
            </ToggleButton>
          </ToggleButtonGroup>
        </Row>
      </Box>
    </Box>
  );
}
