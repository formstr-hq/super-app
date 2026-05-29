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
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useAuthStore, useSettingsStore } from "../stores";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";


interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginClick?: () => void;
}

/**
 * App-wide Cmd-K command palette. Navigates between modules, triggers
 * quick-create actions, toggles UI, and signs out.
 */
export function CommandPalette({ open, onOpenChange, onLoginClick }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { isLoggedIn, logout } = useAuthStore();
  const { themeMode, toggleTheme, aiPanelOpen, setAIPanelOpen } = useSettingsStore();

  const run = (fn: () => void) => () => {
    onOpenChange(false);
    setTimeout(fn, 10);
  };

  const goNew = (module: string) => () => {
    onOpenChange(false);
    setTimeout(() => {
      navigate(`/${module}?action=new`);
    }, 10);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search…" autoFocus />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={run(() => navigate("/forms"))}>
            <ClipboardList />
            <span>Forms</span>
            <CommandShortcut>G F</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/calendar"))}>
            <Calendar />
            <span>Calendar</span>
            <CommandShortcut>G C</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/pages"))}>
            <FileText />
            <span>Pages</span>
            <CommandShortcut>G P</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/drive"))}>
            <FolderOpen />
            <span>Drive</span>
            <CommandShortcut>G D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(() => navigate("/polls"))}>
            <Vote />
            <span>Polls</span>
            <CommandShortcut>G V</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Search">
          <CommandItem onSelect={run(() => navigate("/calendar?focus=search"))}>
            <Search />
            <span>Search events…</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Create">
          <CommandItem onSelect={goNew("forms")}>
            <Plus />
            <span>New form</span>
          </CommandItem>
          <CommandItem onSelect={goNew("calendar")}>
            <Plus />
            <span>New event</span>
          </CommandItem>
          <CommandItem onSelect={goNew("pages")}>
            <FileEdit />
            <span>New page</span>
          </CommandItem>
          <CommandItem onSelect={goNew("drive")}>
            <Plus />
            <span>Upload file</span>
          </CommandItem>
          <CommandItem onSelect={goNew("polls")}>
            <Plus />
            <span>New poll</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Interface">
          <CommandItem onSelect={run(() => setAIPanelOpen(!aiPanelOpen))}>
            <Sparkles />
            <span>{aiPanelOpen ? "Hide AI assistant" : "Show AI assistant"}</span>
          </CommandItem>
          <CommandItem onSelect={run(toggleTheme)}>
            {themeMode === "dark" ? <Sun /> : <Moon />}
            <span>Switch to {themeMode === "dark" ? "light" : "dark"} theme</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Account">
          {isLoggedIn ? (
            <CommandItem onSelect={run(logout)} className="text-destructive">
              <LogOut />
              <span>Sign out</span>
            </CommandItem>
          ) : (
            onLoginClick && (
              <CommandItem onSelect={run(onLoginClick)}>
                <Sparkles />
                <span>Sign in</span>
              </CommandItem>
            )
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

/** Hook that opens the palette on Cmd-K / Ctrl-K. */
export function useCommandPaletteHotkey(open: boolean, onOpenChange: (open: boolean) => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);
}
