import { calendarTools } from "./calendar";
import { driveTools } from "./drive";
import { formsTools } from "./forms";
import { pagesTools } from "./pages";
import { pollsTools } from "./polls";
import type { ToolEntry } from "./types";
import { withStrictArgs } from "./validate";

// Every handler strict-validates its arguments: unknown keys are a hard
// BAD_INPUT error (naming the key and the valid parameters), never a silent
// drop. See withStrictArgs for why that matters to LLM callers.
export const toolRegistry: ToolEntry[] = [
  ...formsTools,
  ...calendarTools,
  ...pagesTools,
  ...pollsTools,
  ...driveTools,
].map(withStrictArgs);

export type { ToolEntry, ToolCtx } from "./types";
export { withStrictArgs } from "./validate";
