import { Menu, LogOut, User, Settings, ChevronDown, Sparkles, Search } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuthStore, useSettingsStore } from "../stores";
import { ThemeToggle } from "../components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const { pubkey, isLoggedIn, method, logout } = useAuthStore();
  const { toggleSidebar, aiPanelOpen, setAIPanelOpen } = useSettingsStore();
  const location = useLocation();

  const routeLabel =
    Object.entries(ROUTE_LABELS).find(([path]) => location.pathname.startsWith(path))?.[1] ??
    "Formstr";

  const shortPubkey = pubkey ? `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}` : "";

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center border-b border-border bg-background/95 backdrop-blur-sm px-4 gap-3">
      {/* Sidebar toggle */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
        className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
      >
        <Menu className="h-4 w-4" />
      </Button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm min-w-0">
        {isMobile ? null : <span className="text-muted-foreground hidden sm:block">Formstr</span>}
        {!isMobile && <span className="text-muted-foreground hidden sm:block">/</span>}
        <span className="font-medium text-foreground truncate">{routeLabel}</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side */}
      <div className="flex items-center gap-1">
        {onOpenCommandPalette && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenCommandPalette}
            aria-label="Open command palette"
            className="h-8 gap-2 px-2 text-muted-foreground hidden md:inline-flex"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="text-xs">Search</span>
            <kbd className="pointer-events-none ml-1 hidden h-5 select-none items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>
        )}

        {onOpenCommandPalette && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenCommandPalette}
            aria-label="Open command palette"
            className="h-8 w-8 text-muted-foreground hover:text-foreground md:hidden"
          >
            <Search className="h-4 w-4" />
          </Button>
        )}

        <ThemeToggle />

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setAIPanelOpen(!aiPanelOpen)}
          aria-label="Toggle AI assistant"
          className={`h-8 w-8 ${aiPanelOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Sparkles className="h-4 w-4" />
        </Button>

        {isLoggedIn ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-2 px-2 text-muted-foreground hover:text-foreground"
              >
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <User className="h-3 w-3" />
                </div>
                <span className="hidden sm:block font-mono text-xs">{shortPubkey}</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <div className="px-2 py-1.5">
                <p className="text-xs text-muted-foreground">Signed in via</p>
                <p className="text-xs font-medium capitalize">{method ?? "unknown"}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 text-sm cursor-pointer">
                <Settings className="h-3.5 w-3.5" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={logout}
                className="gap-2 text-sm text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button size="sm" onClick={onLoginClick} className="h-8">
            Sign In
          </Button>
        )}
      </div>
    </header>
  );
}
