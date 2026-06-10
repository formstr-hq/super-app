import { relayManager } from "@formstr/core";
import { Box, Drawer } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { AIChatPanel } from "../components/ai/AIChatPanel";
import { CommandPalette, useCommandPaletteHotkey } from "../components/CommandPalette";
import { LoginDialog } from "../components/LoginDialog";
import { MigrationDialog } from "../components/MigrationDialog";
import { ShortcutsDialog } from "../components/ShortcutsDialog";
import { UnlockDialog } from "../components/UnlockDialog";
import { useAuthStore, useSettingsStore, useInvitationsStore } from "../stores";

import { isFullBleedRoute } from "./fullBleed";
import { Header } from "./Header";
import { Sidebar, SIDEBAR_WIDTH } from "./Sidebar";

export function AppShell() {
  const { sidebarOpen, aiPanelOpen, setSidebarOpen } = useSettingsStore();
  const authModalOpen = useAuthStore((s) => s.authModalOpen);
  const authModalMode = useAuthStore((s) => s.authModalMode);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);
  const closeAuthModal = useAuthStore((s) => s.closeAuthModal);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  useCommandPaletteHotkey(paletteOpen, setPaletteOpen);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      setShortcutsOpen(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const theme = useTheme();
  const pubkey = useAuthStore((s) => s.pubkey);
  useEffect(() => {
    if (!pubkey) return;
    void relayManager.fetchUserRelays(pubkey);
    void useInvitationsStore.getState().start();
    return () => useInvitationsStore.getState().stop();
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

  // Module switching lives in the navbar (Header). On smaller screens the nav
  // collapses into an overlay drawer; on desktop there is no module rail.
  const isDesktop = !isMobile && !isTablet;
  const fullBleed = isFullBleedRoute(useLocation().pathname);

  const sidebarContent = (
    <Sidebar
      collapsed={false}
      onLoginClick={() => {
        openAuthModal("login");
        setSidebarOpen(false);
      }}
    />
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      {/* Mobile / tablet overlay sidebar */}
      {!isDesktop && (
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

      {/* Main content — full width; the navbar owns module switching */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          mr: isDesktop && aiPanelOpen ? "380px" : 0,
          transition: "margin 200ms ease",
        }}
      >
        <Header
          onLoginClick={() => openAuthModal("login")}
          onOpenCommandPalette={() => setPaletteOpen(true)}
          isMobile={isMobile || isTablet}
        />
        <Box
          component="main"
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: fullBleed ? "hidden" : "auto",
            display: fullBleed ? "flex" : "block",
            flexDirection: "column",
          }}
        >
          {fullBleed ? (
            <Outlet />
          ) : (
            <Box sx={{ mx: "auto", maxWidth: "1280px", px: { xs: 2, sm: 3, lg: 4 }, py: 3 }}>
              <Outlet />
            </Box>
          )}
        </Box>
      </Box>

      {/* AI Chat Panel — desktop docked right */}
      {isDesktop && (
        <Box sx={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: theme.zIndex.drawer }}>
          <AIChatPanel />
        </Box>
      )}

      {/* AI Chat Panel — mobile full-screen overlay */}
      {!isDesktop && aiPanelOpen && (
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

      <LoginDialog open={authModalOpen && authModalMode === "login"} onClose={closeAuthModal} />
      <UnlockDialog open={authModalOpen && authModalMode === "unlock"} onClose={closeAuthModal} />
      <MigrationDialog />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onLoginClick={() => openAuthModal("login")}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
    </Box>
  );
}
