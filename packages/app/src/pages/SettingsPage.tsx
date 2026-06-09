import { Box, List, ListItemButton, ListItemText, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Info, Settings2, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";

import { AboutSection } from "../components/settings/AboutSection";
import { AISettingsSection } from "../components/settings/AISettingsSection";
import { GeneralSettings } from "../components/settings/GeneralSettings";

type Section = "general" | "ai" | "about";

const NAV: { id: Section; label: string; icon: ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings2 size={16} /> },
  { id: "ai", label: "AI & Models", icon: <Sparkles size={16} /> },
  { id: "about", label: "About", icon: <Info size={16} /> },
];

export function SettingsPage() {
  const [section, setSection] = useState<Section>("ai");
  const theme = useTheme();

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>
        Settings
      </Typography>

      <Box sx={{ display: "flex", gap: 4, flexDirection: { xs: "column", sm: "row" } }}>
        {/* Section nav */}
        <List
          dense
          sx={{
            flexShrink: 0,
            width: { xs: "100%", sm: 200 },
            "& .MuiListItemButton-root": { borderRadius: 1.5, mb: 0.25 },
          }}
        >
          {NAV.map((n) => (
            <ListItemButton
              key={n.id}
              selected={section === n.id}
              onClick={() => setSection(n.id)}
              sx={{ gap: 1.5 }}
            >
              {n.icon}
              <ListItemText
                primary={n.label}
                primaryTypographyProps={{ fontSize: 13, fontWeight: section === n.id ? 600 : 400 }}
              />
            </ListItemButton>
          ))}
        </List>

        {/* Section content */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            borderLeft: { xs: "none", sm: `1px solid ${theme.palette.divider}` },
            pl: { xs: 0, sm: 4 },
          }}
        >
          {section === "general" && <GeneralSettings />}
          {section === "ai" && <AISettingsSection />}
          {section === "about" && <AboutSection />}
        </Box>
      </Box>
    </Box>
  );
}
