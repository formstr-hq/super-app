import { calendarTools } from "./calendar";
import { driveTools } from "./drive";
import { formsTools } from "./forms";
import { pagesTools } from "./pages";
import { pollsTools } from "./polls";
import type { ToolEntry } from "./types";

export const toolRegistry: ToolEntry[] = [
  ...formsTools,
  ...calendarTools,
  ...pagesTools,
  ...pollsTools,
  ...driveTools,
];

export type { ToolEntry, ToolCtx } from "./types";
