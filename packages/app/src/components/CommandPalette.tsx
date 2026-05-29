import {
  Box,
  Dialog,
  Divider,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  Calendar,
  ClipboardList,
  FileEdit,
  FileText,
  FolderOpen,
  LogOut,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  Vote,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuthStore, useSettingsStore } from "../stores";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginClick?: () => void;
}

type CommandItem = {
  id: string;
  group: string;
  label: string;
  shortcut?: string;
  icon: React.ElementType;
  action: () => void;
  danger?: boolean;
};

export function CommandPalette({ open, onOpenChange, onLoginClick }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { isLoggedIn, logout } = useAuthStore();
  const { themeMode, toggleTheme, aiPanelOpen, setAIPanelOpen } = useSettingsStore();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const theme = useTheme();

  const close = () => {
    onOpenChange(false);
    setQuery("");
  };
  const run = (fn: () => void) => {
    close();
    setTimeout(fn, 10);
  };

  const allItems: CommandItem[] = [
    {
      id: "nav-forms",
      group: "Navigate",
      label: "Forms",
      shortcut: "G F",
      icon: ClipboardList,
      action: () => run(() => navigate("/forms")),
    },
    {
      id: "nav-calendar",
      group: "Navigate",
      label: "Calendar",
      shortcut: "G C",
      icon: Calendar,
      action: () => run(() => navigate("/calendar")),
    },
    {
      id: "nav-pages",
      group: "Navigate",
      label: "Pages",
      shortcut: "G P",
      icon: FileText,
      action: () => run(() => navigate("/pages")),
    },
    {
      id: "nav-drive",
      group: "Navigate",
      label: "Drive",
      shortcut: "G D",
      icon: FolderOpen,
      action: () => run(() => navigate("/drive")),
    },
    {
      id: "nav-polls",
      group: "Navigate",
      label: "Polls",
      shortcut: "G V",
      icon: Vote,
      action: () => run(() => navigate("/polls")),
    },
    {
      id: "new-form",
      group: "Create",
      label: "New form",
      icon: Plus,
      action: () => run(() => navigate("/forms?action=new")),
    },
    {
      id: "new-event",
      group: "Create",
      label: "New event",
      icon: Plus,
      action: () => run(() => navigate("/calendar?action=new")),
    },
    {
      id: "new-page",
      group: "Create",
      label: "New page",
      icon: FileEdit,
      action: () => run(() => navigate("/pages?action=new")),
    },
    {
      id: "new-file",
      group: "Create",
      label: "Upload file",
      icon: Plus,
      action: () => run(() => navigate("/drive?action=new")),
    },
    {
      id: "new-poll",
      group: "Create",
      label: "New poll",
      icon: Plus,
      action: () => run(() => navigate("/polls?action=new")),
    },
    {
      id: "toggle-ai",
      group: "Interface",
      label: aiPanelOpen ? "Hide AI assistant" : "Show AI assistant",
      icon: Sparkles,
      action: () => run(() => setAIPanelOpen(!aiPanelOpen)),
    },
    {
      id: "toggle-theme",
      group: "Interface",
      label: `Switch to ${themeMode === "dark" ? "light" : "dark"} theme`,
      icon: themeMode === "dark" ? Sun : Moon,
      action: () => run(toggleTheme),
    },
    ...(isLoggedIn
      ? [
          {
            id: "logout",
            group: "Account",
            label: "Sign out",
            icon: LogOut,
            action: () => run(logout),
            danger: true,
          },
        ]
      : onLoginClick
        ? [
            {
              id: "login",
              group: "Account",
              label: "Sign in",
              icon: Sparkles,
              action: () => run(onLoginClick),
            },
          ]
        : []),
  ];

  const filtered = query.trim()
    ? allItems.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
    : allItems;

  const groups = [...new Set(filtered.map((i) => i.group))];

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter") {
      e.preventDefault();
      filtered[activeIndex]?.action();
    }
    if (e.key === "Escape") {
      close();
    }
  };

  let itemIndex = -1;

  return (
    <Dialog
      open={open}
      onClose={close}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          borderRadius: 2,
          overflow: "hidden",
          mt: "10vh",
          verticalAlign: "top",
        },
      }}
    >
      {/* Search input */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 2,
          py: 1.5,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Search size={16} color={theme.palette.text.secondary} />
        <InputBase
          inputRef={inputRef}
          fullWidth
          placeholder="Type a command or search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          sx={{ fontSize: 14 }}
        />
      </Box>

      {/* Results */}
      <Box sx={{ maxHeight: 400, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <Box sx={{ py: 4, textAlign: "center" }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              No results.
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {groups.map((group, gi) => {
              const groupItems = filtered.filter((i) => i.group === group);
              return (
                <Box key={group}>
                  {gi > 0 && <Divider />}
                  <ListSubheader
                    disableSticky
                    sx={{
                      bgcolor: "transparent",
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "text.secondary",
                      lineHeight: "28px",
                      px: 2,
                    }}
                  >
                    {group}
                  </ListSubheader>
                  {groupItems.map((item) => {
                    itemIndex++;
                    const idx = itemIndex;
                    const Icon = item.icon;
                    return (
                      <ListItemButton
                        key={item.id}
                        selected={activeIndex === idx}
                        onClick={item.action}
                        onMouseEnter={() => setActiveIndex(idx)}
                        sx={{
                          px: 2,
                          py: 0.75,
                          borderRadius: 0,
                          ...(item.danger && { color: "error.main" }),
                        }}
                      >
                        <ListItemIcon
                          sx={{
                            minWidth: 32,
                            color: item.danger ? "error.main" : "text.secondary",
                          }}
                        >
                          <Icon size={15} />
                        </ListItemIcon>
                        <ListItemText
                          primary={item.label}
                          primaryTypographyProps={{ variant: "body2" }}
                        />
                        {item.shortcut && (
                          <Typography
                            variant="caption"
                            sx={{
                              fontFamily: "monospace",
                              color: "text.secondary",
                              bgcolor: "background.paper",
                              px: 0.75,
                              py: 0.25,
                              borderRadius: "4px",
                              border: `1px solid ${theme.palette.divider}`,
                            }}
                          >
                            {item.shortcut}
                          </Typography>
                        )}
                      </ListItemButton>
                    );
                  })}
                </Box>
              );
            })}
          </List>
        )}
      </Box>
    </Dialog>
  );
}

export function useCommandPaletteHotkey(open: boolean, onOpenChange: (open: boolean) => void) {
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);
}
