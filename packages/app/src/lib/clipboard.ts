/**
 * Copy text to the clipboard. Tries the async Clipboard API first (requires a
 * secure context), then falls back to a hidden textarea + execCommand — needed
 * when the app is served over plain http (e.g. LAN testing).
 *
 * Returns whether the copy succeeded so callers can show feedback.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
