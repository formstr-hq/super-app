import {
  Avatar,
  Box,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
  Button,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  FileText,
  Calendar,
  FileEdit,
  HardDrive,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  LogIn,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuthStore, useSettingsStore } from "../stores";

export const SIDEBAR_WIDTH = 240;
export const SIDEBAR_COLLAPSED_WIDTH = 56;

const NAV_ITEMS = [
  { label: "Forms", path: "/forms", icon: FileText },
  { label: "Calendar", path: "/calendar", icon: Calendar },
  { label: "Pages", path: "/pages", icon: FileEdit },
  { label: "Drive", path: "/drive", icon: HardDrive },
  { label: "Polls", path: "/polls", icon: BarChart3 },
] as const;

interface SidebarProps {
  collapsed: boolean;
  onLoginClick: () => void;
}

export function Sidebar({ collapsed, onLoginClick }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toggleSidebarCollapsed } = useSettingsStore();
  const { isLoggedIn, pubkey } = useAuthStore();
  const theme = useTheme();

  const shortPubkey = pubkey ? `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}` : "";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Logo + collapse toggle */}
      <Box
        sx={{
          height: 48,
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: collapsed ? 0 : 1.5,
          justifyContent: collapsed ? "center" : "space-between",
          borderBottom: `1px solid ${theme.palette.divider}`,
          flexShrink: 0,
        }}
      >
        {!collapsed && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box
              sx={{
                width: 22,
                height: 22,
                bgcolor: "text.primary",
                borderRadius: "5px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Radio size={11} style={{ color: theme.palette.background.default }} />
            </Box>
            <Typography variant="body2" fontWeight={600}>
              Formstr
            </Typography>
          </Box>
        )}

        <Tooltip title={collapsed ? "Expand sidebar" : "Collapse sidebar"} placement="right">
          <IconButton
            size="small"
            onClick={toggleSidebarCollapsed}
            sx={{ display: { xs: "none", lg: "flex" }, color: "text.secondary" }}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </IconButton>
        </Tooltip>

        {collapsed && (
          <Box
            sx={{
              width: 22,
              height: 22,
              bgcolor: "text.primary",
              borderRadius: "5px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Radio size={11} style={{ color: theme.palette.background.default }} />
          </Box>
        )}
      </Box>

      {/* Navigation */}
      <List dense disablePadding sx={{ flex: 1, overflowY: "auto", py: 1, px: 0.75 }}>
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => {
          const active = location.pathname.startsWith(path);
          const btn = (
            <ListItemButton
              key={path}
              selected={active}
              onClick={() => navigate(path)}
              sx={{
                borderRadius: "5px",
                minHeight: 36,
                px: collapsed ? 0 : 1,
                justifyContent: collapsed ? "center" : "flex-start",
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: collapsed ? 0 : 32,
                  color: active ? "text.primary" : "text.secondary",
                }}
              >
                <Icon size={16} />
              </ListItemIcon>
              {!collapsed && (
                <ListItemText
                  primary={label}
                  primaryTypographyProps={{
                    variant: "body2",
                    fontWeight: active ? 500 : 400,
                  }}
                />
              )}
            </ListItemButton>
          );

          return collapsed ? (
            <Tooltip key={path} title={label} placement="right">
              {btn}
            </Tooltip>
          ) : (
            btn
          );
        })}
      </List>

      {/* Bottom user area */}
      <Divider />
      <Box sx={{ px: 1.5, py: 1 }}>
        {isLoggedIn ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Avatar sx={{ width: 22, height: 22, fontSize: 10 }} />
            {!collapsed && (
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", fontFamily: "monospace", lineHeight: 1 }}
              >
                {shortPubkey}
              </Typography>
            )}
          </Box>
        ) : collapsed ? (
          <Tooltip title="Sign In" placement="right">
            <IconButton size="small" onClick={onLoginClick} sx={{ color: "text.secondary" }}>
              <LogIn size={16} />
            </IconButton>
          </Tooltip>
        ) : (
          <Button
            variant="outlined"
            size="small"
            fullWidth
            startIcon={<LogIn size={14} />}
            onClick={onLoginClick}
            sx={{ fontSize: 12, borderColor: "divider" }}
          >
            Sign In
          </Button>
        )}
      </Box>
    </Box>
  );
}
