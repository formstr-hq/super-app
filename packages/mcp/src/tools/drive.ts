import { drive } from "@formstr/app/services";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ok } from "../result";

import type { RegisterCtx } from "./shared";

export function registerDrive(server: McpServer, _ctx: RegisterCtx): void {
  server.registerTool(
    "browse_files",
    {
      description: "List files in the user's encrypted drive, optionally under a folder.",
      inputSchema: { folder: z.string().optional() },
    },
    async ({ folder }: { folder?: string }) => {
      const all = await drive.fetchFileIndex();
      const files = all.filter((f) => !f.deleted);
      const folders = drive.extractFolders(files);
      const prefix = folder && folder !== "/" ? folder : null;
      const shown = prefix ? files.filter((f) => f.folder.startsWith(prefix)) : files;
      // SECURITY: deliberately omit encryptionKey/hash/server — never expose file keys.
      return ok(`Found ${shown.length} file(s). Folders: ${folders.join(", ") || "none"}.`, {
        files: shown.map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
          folder: f.folder,
        })),
        folders,
      });
    },
  );
}
