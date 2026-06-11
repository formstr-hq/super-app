import {
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { FileText, Calendar, FileEdit, HardDrive, BarChart3, LogIn } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import formstrLogo from "../assets/formstr.png";
import { AccountMenu } from "../components/AccountMenu";
import { useAuthStore } from "../stores";

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
  const { isLoggedIn } = useAuthStore();
  const theme = useTheme();

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
          <Box
            component="img"
            src={formstrLogo}
            alt="Formstr"
            sx={{ height: 20, display: "block" }}
          />
        )}

        {collapsed && (
          <Box
            component="img"
            src={formstrLogo}
            alt="Formstr"
            sx={{ height: 20, display: "block" }}
          />
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
          <AccountMenu variant="sidebar" />
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
