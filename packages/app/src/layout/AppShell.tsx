import { relayManager } from "@formstr/core";
import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Toaster } from "sonner";

import { AIChatPanel } from "../components/ai/AIChatPanel";
import { CommandPalette, useCommandPaletteHotkey } from "../components/CommandPalette";
import { LoginDialog } from "../components/LoginDialog";
import { hexToBytes } from "../services/forms/keys";
import { useAuthStore, useSettingsStore, useFormsKeyStore } from "../stores";

import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

import { Sheet, SheetContent } from "@/components/ui/sheet";

export const SIDEBAR_WIDTH = 240;
export const SIDEBAR_COLLAPSED_WIDTH = 56;

export function AppShell() {
  const { sidebarOpen, sidebarCollapsed, aiPanelOpen, setSidebarOpen } = useSettingsStore();
  const [loginOpen, setLoginOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  useCommandPaletteHotkey(paletteOpen, setPaletteOpen);

  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const pubkey = useAuthStore((s) => s.pubkey);
  const startFormsKeyStore = useFormsKeyStore((s) => s.start);
  const stopFormsKeyStore = useFormsKeyStore((s) => s.stop);
  const rememberViewKey = useFormsKeyStore((s) => s.remember);

  // Boot the NIP-59 view-key inbox once per authenticated session so
  // collaborators of view-key encrypted forms hydrate their secrets.
  useEffect(() => {
    if (!isLoggedIn) return;
    startFormsKeyStore();
    return () => stopFormsKeyStore();
  }, [isLoggedIn, startFormsKeyStore, stopFormsKeyStore]);

  // Fire-and-forget NIP-65 relay fetch once the user is authenticated.
  useEffect(() => {
    if (!pubkey) return;
    void relayManager.fetchUserRelays(pubkey);
  }, [pubkey]);

  // Upstream nostr-forms shares view keys via the URL hash `#view-key=<coord>:<hex>`.
  // Stash any matching fragment into the key store, then strip it so reloads stay clean.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#view-key=")) return;
    const payload = decodeURIComponent(hash.slice("#view-key=".length));
    const lastColon = payload.lastIndexOf(":");
    if (lastColon < 0) return;
    const coordColon = payload.lastIndexOf(":", lastColon - 1);
    if (coordColon < 0) return;
    const coord = payload.slice(0, lastColon);
    const hex = payload.slice(lastColon + 1);
    if (!coord || !/^[0-9a-f]+$/i.test(hex)) return;
    try {
      rememberViewKey(coord, hexToBytes(hex));
      history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      /* malformed hash, ignore */
    }
  }, [rememberViewKey]);

  useEffect(() => {
    const checkBreakpoints = () => {
      setIsMobile(window.innerWidth < 640);
      setIsTablet(window.innerWidth >= 640 && window.innerWidth < 1024);
    };
    checkBreakpoints();
    window.addEventListener("resize", checkBreakpoints);
    return () => window.removeEventListener("resize", checkBreakpoints);
  }, []);

  const showDesktopSidebar = !isMobile && !isTablet;
  const showOverlaySidebar = (isMobile || isTablet) && sidebarOpen;

  const sidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop persistent sidebar */}
      {showDesktopSidebar && (
        <aside
          className="fixed inset-y-0 left-0 z-40 shrink-0 border-r border-border bg-muted transition-all duration-200"
          style={{ width: sidebarWidth }}
        >
          <Sidebar collapsed={sidebarCollapsed} onLoginClick={() => setLoginOpen(true)} />
        </aside>
      )}

      {/* Tablet/Mobile overlay sidebar via Sheet */}
      {(isMobile || isTablet) && (
        <Sheet open={showOverlaySidebar} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-60 p-0 border-r border-border bg-muted">
            <Sidebar
              collapsed={false}
              onLoginClick={() => {
                setLoginOpen(true);
                setSidebarOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* Main content area */}
      <div
        className="flex flex-col flex-1 min-w-0 transition-all duration-200"
        style={{
          marginLeft: showDesktopSidebar ? sidebarWidth : 0,
          marginRight: !isMobile && !isTablet && aiPanelOpen ? 380 : 0,
        }}
      >
        <Header
          onLoginClick={() => setLoginOpen(true)}
          onOpenCommandPalette={() => setPaletteOpen(true)}
          isMobile={isMobile || isTablet}
        />

        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
            <Outlet />
          </div>
        </main>
      </div>

      {/* AI Chat Panel — desktop docked right */}
      {!isMobile && !isTablet && (
        <div className="fixed inset-y-0 right-0 z-40">
          <AIChatPanel />
        </div>
      )}

      {/* AI Chat Panel — mobile/tablet full-screen overlay */}
      {(isMobile || isTablet) && aiPanelOpen && (
        <div className="fixed inset-0 z-50 bg-background">
          <AIChatPanel />
        </div>
      )}

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onLoginClick={() => setLoginOpen(true)}
      />

      <Toaster position="bottom-right" richColors closeButton toastOptions={{ duration: 6000 }} />
    </div>
  );
}
