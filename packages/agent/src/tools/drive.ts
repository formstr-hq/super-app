import { z } from "zod";

import { ok, fail } from "../result";
import { requireConfirm } from "../safety";
import { drive } from "../services";

import type { ToolEntry } from "./types";

/** Metadata shape returned by the drive service (kept local — never imported into the AI surface). */
interface DriveFile {
  name: string;
  size: number;
  type: string;
  folder: string;
  uploadedAt: number;
  hash: string;
  server: string;
  encryptionKey: string;
  deleted?: boolean;
}

/**
 * Resolve a single live file by name (+ optional folder). Returns a `fail` result
 * when the file is missing or the name is ambiguous, otherwise the file.
 */
async function resolveFile(
  name: string,
  folder: string | undefined,
): Promise<{ file: DriveFile } | { error: ReturnType<typeof fail> }> {
  const all = (await drive.fetchFileIndex()) as DriveFile[];
  const matches = all.filter(
    (f) => !f.deleted && f.name === name && (folder === undefined || f.folder === folder),
  );
  if (matches.length === 0) {
    return { error: fail(`No file named "${name}"${folder ? ` in ${folder}` : ""}.`, "NOT_FOUND") };
  }
  if (matches.length > 1) {
    const folders = matches.map((f) => f.folder).join(", ");
    return {
      error: fail(
        `Multiple files named "${name}" exist (in: ${folders}). Specify "folder" to disambiguate.`,
        "AMBIGUOUS",
      ),
    };
  }
  return { file: matches[0] };
}

export const driveTools: ToolEntry[] = buildDriveTools();

function buildDriveTools(): ToolEntry[] {
  const tools: ToolEntry[] = [];
  let write = false;
  const server = {
    registerTool(
      name: string,
      config: Pick<ToolEntry, "description" | "inputSchema">,
      handler: ToolEntry["handler"],
    ) {
      tools.push({ name, ...config, handler, ...(write ? { write: true } : {}) });
    },
  };

  // ── Read ──────────────────────────────────────────────
  server.registerTool(
    "browse_files",
    {
      description: "List files in the user's encrypted drive, optionally under a folder.",
      inputSchema: { folder: z.string().optional() },
    },
    async ({ folder }: { folder?: string }) => {
      const all = (await drive.fetchFileIndex()) as DriveFile[];
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

  server.registerTool(
    "get_file_info",
    {
      description: "Get metadata for one file by name (and optional folder).",
      inputSchema: { name: z.string(), folder: z.string().optional() },
    },
    async ({ name, folder }: { name: string; folder?: string }) => {
      const resolved = await resolveFile(name, folder);
      if ("error" in resolved) return resolved.error;
      const f = resolved.file;
      // SECURITY: omit encryptionKey/hash/server.
      return ok(`File "${f.name}" (${f.size} bytes) in ${f.folder}.`, {
        file: {
          name: f.name,
          size: f.size,
          type: f.type,
          folder: f.folder,
          uploadedAt: f.uploadedAt,
        },
      });
    },
  );

  // ── Gated (destructive) ───────────────────────────────
  write = true;

  server.registerTool(
    "delete_file",
    {
      description: "Delete a file from your drive by name. Requires confirm:true.",
      inputSchema: {
        name: z.string(),
        folder: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ name, folder, confirm }: { name: string; folder?: string; confirm?: boolean }) => {
      const blocked = requireConfirm("delete_file", { confirm }, `deletes file "${name}"`);
      if (blocked) return blocked;
      const resolved = await resolveFile(name, folder);
      if ("error" in resolved) return resolved.error;
      await drive.deleteFile(resolved.file);
      return ok(`Deleted "${name}".`);
    },
  );

  server.registerTool(
    "rename_file",
    {
      description: "Rename a file in your drive. Requires confirm:true.",
      inputSchema: {
        name: z.string(),
        newName: z.string(),
        folder: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({
      name,
      newName,
      folder,
      confirm,
    }: {
      name: string;
      newName: string;
      folder?: string;
      confirm?: boolean;
    }) => {
      const blocked = requireConfirm(
        "rename_file",
        { confirm },
        `renames "${name}" to "${newName}"`,
      );
      if (blocked) return blocked;
      const resolved = await resolveFile(name, folder);
      if ("error" in resolved) return resolved.error;
      await drive.renameFile(resolved.file, newName);
      return ok(`Renamed "${name}" to "${newName}".`);
    },
  );

  server.registerTool(
    "move_file",
    {
      description: "Move a file to a different folder in your drive. Requires confirm:true.",
      inputSchema: {
        name: z.string(),
        newFolder: z.string(),
        folder: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({
      name,
      newFolder,
      folder,
      confirm,
    }: {
      name: string;
      newFolder: string;
      folder?: string;
      confirm?: boolean;
    }) => {
      const blocked = requireConfirm("move_file", { confirm }, `moves "${name}" to ${newFolder}`);
      if (blocked) return blocked;
      const resolved = await resolveFile(name, folder);
      if ("error" in resolved) return resolved.error;
      await drive.moveFile(resolved.file, newFolder);
      return ok(`Moved "${name}" to ${newFolder}.`);
    },
  );

  return tools;
}
