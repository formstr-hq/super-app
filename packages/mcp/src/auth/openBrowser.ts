import { spawn } from "node:child_process";
import { platform } from "node:os";

/**
 * Best-effort open of a URL in the user's default browser. Detached + errors swallowed —
 * the caller always also prints the URL so a headless/SSH user can open it manually.
 */
export function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // ignore — URL is printed by the caller
  }
}
