import { relayManager } from "@formstr/core";
import { Box, Drawer } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";

import { AIChatPanel } from "../components/ai/AIChatPanel";
import { CommandPalette, useCommandPaletteHotkey } from "../components/CommandPalette";
import { LoginDialog } from "../components/LoginDialog";
import { useAuthStore, useSettingsStore } from "../stores";

import { Header } from "./Header";
import { Sidebar, SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from "./Sidebar";

export function AppShell() {
  const { sidebarOpen, sidebarCollapsed, aiPanelOpen, setSidebarOpen } = useSettingsStore();
  const [loginOpen, setLoginOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  useCommandPaletteHotkey(paletteOpen, setPaletteOpen);

  const theme = useTheme();
  const pubkey = useAuthStore((s) => s.pubkey);
  useEffect(() => {
    if (!pubkey) return;
    void relayManager.fetchUserRelays(pubkey);
  }, [pubkey]);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 640);
      setIsTablet(window.innerWidth >= 640 && window.innerWidth < 1024);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const showDesktopSidebar = !isMobile && !isTablet;
  const sidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  const sidebarContent = (
    <Sidebar
      collapsed={showDesktopSidebar ? sidebarCollapsed : false}
      onLoginClick={() => {
        setLoginOpen(true);
        setSidebarOpen(false);
      }}
    />
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      {/* Desktop persistent sidebar */}
      {showDesktopSidebar && (
        <Box
          component="aside"
          sx={{
            width: sidebarWidth,
            flexShrink: 0,
            position: "fixed",
            top: 0,
            bottom: 0,
            left: 0,
            zIndex: theme.zIndex.drawer,
            bgcolor: "background.paper",
            borderRight: `1px solid ${theme.palette.divider}`,
            transition: "width 200ms ease",
            overflow: "hidden",
          }}
        >
          {sidebarContent}
        </Box>
      )}

      {/* Mobile / tablet overlay sidebar */}
      {(isMobile || isTablet) && (
        <Drawer
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          sx={{
            "& .MuiDrawer-paper": {
              width: SIDEBAR_WIDTH,
              bgcolor: "background.paper",
              borderRight: `1px solid ${theme.palette.divider}`,
            },
          }}
        >
          {sidebarContent}
        </Drawer>
      )}

      {/* Main content */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          ml: showDesktopSidebar ? `${sidebarWidth}px` : 0,
          mr: !isMobile && !isTablet && aiPanelOpen ? "380px" : 0,
          transition: "margin 200ms ease",
        }}
      >
        <Header
          onLoginClick={() => setLoginOpen(true)}
          onOpenCommandPalette={() => setPaletteOpen(true)}
          isMobile={isMobile || isTablet}
        />
        <Box component="main" sx={{ flex: 1, overflow: "auto" }}>
          <Box sx={{ mx: "auto", maxWidth: "1280px", px: { xs: 2, sm: 3, lg: 4 }, py: 3 }}>
            <Outlet />
          </Box>
        </Box>
      </Box>

      {/* AI Chat Panel — desktop docked right */}
      {!isMobile && !isTablet && (
        <Box sx={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: theme.zIndex.drawer }}>
          <AIChatPanel />
        </Box>
      )}

      {/* AI Chat Panel — mobile full-screen overlay */}
      {(isMobile || isTablet) && aiPanelOpen && (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: theme.zIndex.modal,
            bgcolor: "background.default",
          }}
        >
          <AIChatPanel />
        </Box>
      )}

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onLoginClick={() => setLoginOpen(true)}
      />
    </Box>
  );
}
