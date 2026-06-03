import { pages } from "@formstr/app/services";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ok } from "../result";

import type { RegisterCtx } from "./shared";

export function registerPages(server: McpServer, _ctx: RegisterCtx): void {
  server.registerTool(
    "list_pages",
    { description: "List the user's documents/pages.", inputSchema: {} },
    async () => {
      const list = await pages.fetchMyPages();
      return ok(`You have ${list.length} page(s).`, {
        pages: list.map((p) => ({
          id: p.id,
          address: p.address,
          title: p.title,
          isEncrypted: p.isEncrypted,
        })),
      });
    },
  );

  server.registerTool(
    "create_page",
    {
      description: "Create an encrypted document/page (Markdown).",
      inputSchema: { title: z.string(), content: z.string() },
    },
    async (args: { title: string; content: string }) => {
      const page = await pages.savePage({ title: args.title, content: args.content });
      return ok(`Saved page "${args.title}".`, { address: page.address });
    },
  );

  server.registerTool(
    "save_private_note",
    {
      description: "Save a quick private encrypted note (Markdown).",
      inputSchema: { title: z.string(), content: z.string() },
    },
    async (args: { title: string; content: string }) => {
      const page = await pages.savePage({ title: args.title, content: args.content });
      return ok(`Saved page "${args.title}".`, { address: page.address });
    },
  );
}
