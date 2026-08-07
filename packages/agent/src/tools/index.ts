import { calendarTools } from "./calendar";
import { driveTools } from "./drive";
import { formsTools } from "./forms";
import { pagesTools } from "./pages";
import { pollsTools } from "./polls";
import type { ToolDef, ToolEntry, ToolModule } from "./types";
import { withStrictArgs } from "./validate";

/** Stamp a module file's tools with the module that owns them. */
function tag(defs: ToolDef[], module: ToolModule): ToolEntry[] {
  return defs.map((def) => ({ ...def, module }));
}

// Every handler strict-validates its arguments: unknown keys are a hard
// BAD_INPUT error (naming the key and the valid parameters), never a silent
// drop. See withStrictArgs for why that matters to LLM callers.
//
// `module` is stamped here rather than on each definition so it cannot be
// omitted: a new tool joins the registry only by joining one of these arrays.
export const toolRegistry: ToolEntry[] = [
  ...tag(formsTools, "forms"),
  ...tag(calendarTools, "calendar"),
  ...tag(pagesTools, "pages"),
  ...tag(pollsTools, "polls"),
  ...tag(driveTools, "drive"),
].map(withStrictArgs);

export type { ToolDef, ToolEntry, ToolCtx, ToolModule } from "./types";
export { withStrictArgs } from "./validate";
