import { useLocation, useNavigate } from "react-router-dom";
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
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  const { isLoggedIn } = useAuthStore();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        {/* Logo + collapse toggle */}
        <div className={cn(
          "flex h-12 items-center border-b border-border shrink-0",
          collapsed ? "justify-center px-0" : "justify-between px-4"
        )}>
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary">
                <Radio className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
              <span className="text-sm font-semibold tracking-tight text-foreground">Formstr</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebarCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="h-8 w-8 text-muted-foreground hover:text-foreground hidden lg:flex"
          >
            {collapsed
              ? <PanelLeftOpen className="h-4 w-4" />
              : <PanelLeftClose className="h-4 w-4" />
            }
          </Button>
          {collapsed && (
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary cursor-default">
              <Radio className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            const Icon = item.icon;

            if (collapsed) {
              return (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigate(item.path)}
                      aria-label={item.label}
                      className={cn(
                        "flex h-8 w-full items-center justify-center rounded-md transition-colors duration-150",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }

            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-3 text-sm transition-colors duration-150",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className={cn(
          "border-t border-border px-2 py-2",
          collapsed ? "flex justify-center" : ""
        )}>
          {!isLoggedIn && (
            collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onLoginClick}
                    aria-label="Sign in"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors duration-150"
                  >
                    <LogIn className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign In</TooltipContent>
              </Tooltip>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={onLoginClick}
                className="w-full h-8 text-xs gap-2"
              >
                <LogIn className="h-3.5 w-3.5" />
                Sign In
              </Button>
            )
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

