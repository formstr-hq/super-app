import { AppBar, Avatar, Box, IconButton, InputBase, Toolbar, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Menu as MenuIcon, Moon, Search, Sparkles, Sun } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { AccountMenu } from "../components/AccountMenu";
import { useAuthStore, useSettingsStore } from "../stores";

const NAV_ITEMS = [
  { label: "Forms", path: "/forms" },
  { label: "Calendar", path: "/calendar" },
  { label: "Pages", path: "/pages" },
  { label: "Drive", path: "/drive" },
  { label: "Polls", path: "/polls" },
] as const;

const ROUTE_LABELS: Record<string, string> = {
  "/forms": "Forms",
  "/calendar": "Calendar",
  "/pages": "Pages",
  "/drive": "Drive",
  "/polls": "Polls",
};

interface HeaderProps {
  onLoginClick: () => void;
  onOpenCommandPalette?: () => void;
  isMobile: boolean;
}

export function Header({ onLoginClick, onOpenCommandPalette, isMobile }: HeaderProps) {
  const { isLoggedIn } = useAuthStore();
  const { toggleSidebar, aiPanelOpen, setAIPanelOpen, themeMode, toggleTheme } = useSettingsStore();
  const location = useLocation();
  const theme = useTheme();

  const routeLabel =
    Object.entries(ROUTE_LABELS).find(([path]) => location.pathname.startsWith(path))?.[1] ??
    "Formstr";

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: "background.default",
        borderBottom: `1px solid ${theme.palette.divider}`,
        color: "text.primary",
        zIndex: theme.zIndex.appBar,
      }}
    >
      <Toolbar variant="dense" sx={{ minHeight: 48, gap: 1, px: 2 }}>
        {/* Sidebar toggle — mobile/tablet only (desktop switches modules via the tabs) */}
        <IconButton
          size="small"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          sx={{ color: "text.secondary", flexShrink: 0, display: { xs: "flex", md: "none" } }}
        >
          <MenuIcon size={18} />
        </IconButton>

        {/* Brand */}
        <Typography variant="body2" fontWeight={700} noWrap sx={{ letterSpacing: "-0.02em" }}>
          Formstr
        </Typography>

        {/* Module tabs (desktop) */}
        <Box sx={{ display: { xs: "none", md: "flex" }, alignItems: "center", gap: 0.25, ml: 1 }}>
          {NAV_ITEMS.map(({ label, path }) => (
            <NavLink key={path} to={path} style={{ textDecoration: "none" }}>
              {({ isActive }) => (
                <Box
                  sx={{
                    px: 1.25,
                    py: 0.5,
                    borderRadius: "7px",
                    fontSize: 13.5,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? "text.primary" : "text.secondary",
                    bgcolor: isActive ? "action.selected" : "transparent",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  {label}
                </Box>
              )}
            </NavLink>
          ))}
        </Box>

        {/* Route label (mobile only) */}
        {isMobile && (
          <Typography variant="body2" fontWeight={600} noWrap sx={{ ml: 0.5 }}>
            {routeLabel}
          </Typography>
        )}

        <Box sx={{ flex: 1 }} />

        {/* Search pill */}
        {onOpenCommandPalette && (
          <>
            {/* Desktop: full pill */}
            <Box
              onClick={onOpenCommandPalette}
              sx={{
                display: { xs: "none", md: "flex" },
                alignItems: "center",
                gap: 0.75,
                bgcolor: "background.paper",
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: "6px",
                px: 1.25,
                py: 0.5,
                cursor: "pointer",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Search size={13} color={theme.palette.text.secondary} />
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Search
              </Typography>
              <Box
                component="kbd"
                sx={{
                  ml: 0.75,
                  fontSize: 10,
                  bgcolor: theme.palette.divider,
                  color: "text.secondary",
                  px: 0.75,
                  py: 0.25,
                  borderRadius: "3px",
                  fontFamily: "monospace",
                }}
              >
                ⌘K
              </Box>
              <InputBase sx={{ display: "none" }} />
            </Box>
            {/* Mobile: icon only */}
            <IconButton
              size="small"
              onClick={onOpenCommandPalette}
              sx={{ display: { xs: "flex", md: "none" }, color: "text.secondary" }}
            >
              <Search size={18} />
            </IconButton>
          </>
        )}

        {/* Theme toggle */}
        <IconButton
          size="small"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          sx={{ color: "text.secondary" }}
        >
          {themeMode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>

        {/* AI toggle */}
        <IconButton
          size="small"
          onClick={() => setAIPanelOpen(!aiPanelOpen)}
          aria-label="Toggle AI assistant"
          sx={{ color: aiPanelOpen ? "text.primary" : "text.secondary" }}
        >
          <Sparkles size={18} />
        </IconButton>

        {/* User */}
        {isLoggedIn ? (
          <AccountMenu />
        ) : (
          <IconButton size="small" onClick={onLoginClick} sx={{ color: "text.secondary", ml: 0.5 }}>
            <Avatar sx={{ width: 26, height: 26, fontSize: 11 }} />
          </IconButton>
        )}
      </Toolbar>
    </AppBar>
  );
}
