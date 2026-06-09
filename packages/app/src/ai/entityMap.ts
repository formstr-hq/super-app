import type { EntityRef } from "./types";

type Dict = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Map a successful tool result to an EntityRef for the AI panel's entity cards.
 * Only constructive / updating tools produce a navigable entity; reads and
 * deletes return null. `route` is app-routing (lives here, not in the shared
 * registry). Returns null when no usable reference is present.
 */
export function entityFromTool(name: string, args: Dict, data: unknown): EntityRef | null {
  const d = (data ?? {}) as Dict;
  const a = (args ?? {}) as Dict;

  switch (name) {
    case "create_form":
    case "import_form_from_naddr":
    case "update_form": {
      const ref = str(d.naddr);
      if (!ref) return null;
      return { module: "forms", ref, label: str(a.name) ?? ref, route: "/forms" };
    }
    case "create_calendar_event":
    case "update_calendar_event":
    case "attach_form_to_event": {
      const ref = str(d.eventId) ?? str(d.coordinate) ?? str(d.id);
      if (!ref) return null;
      return { module: "calendar", ref, label: str(a.title) ?? ref, route: "/calendar" };
    }
    case "create_calendar":
    case "update_calendar": {
      const ref = str(d.id);
      if (!ref) return null;
      return { module: "calendar", ref, label: str(a.title) ?? ref, route: "/calendar" };
    }
    case "create_page":
    case "save_private_note":
    case "update_page": {
      const ref = str(d.address);
      if (!ref) return null;
      return { module: "pages", ref, label: str(a.title) ?? ref, route: "/pages" };
    }
    case "create_poll": {
      const ref = str(d.id);
      if (!ref) return null;
      return { module: "polls", ref, label: str(a.question) ?? ref, route: "/polls" };
    }
    default:
      return null;
  }
}
