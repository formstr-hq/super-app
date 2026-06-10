import { z } from "zod";

import { ok } from "../result";
import { requireConfirm } from "../safety";
import { pages, pagesComments } from "../services";
import type { PageComment } from "../services";

import type { ToolEntry } from "./types";

/** Fold a title into the Markdown body as an H1 (the doc has no plaintext title tag). */
function withTitle(title: string | undefined, content: string): string {
  return title ? `# ${title}\n\n${content}` : content;
}

export const pagesTools: ToolEntry[] = buildPagesTools();

function buildPagesTools(): ToolEntry[] {
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
          tags: p.tags ?? [],
        })),
      });
    },
  );

  server.registerTool(
    "get_page",
    {
      description: "Fetch + decrypt one document by author pubkey and docId (d-tag).",
      inputSchema: { pubkey: z.string(), docId: z.string(), viewKey: z.string().optional() },
    },
    async ({ pubkey, docId, viewKey }: { pubkey: string; docId: string; viewKey?: string }) => {
      const page = await pages.fetchPage(pubkey, docId, viewKey);
      if (!page) return ok("Page not found.", { page: null });
      return ok(`Page "${page.title}".`, {
        page: { address: page.address, title: page.title, content: page.content },
      });
    },
  );

  server.registerTool(
    "list_shared_pages",
    {
      description:
        "List documents others have shared with you (kind-34579 doc-metadata entries carrying a viewKey).",
      inputSchema: {},
    },
    async () => {
      const list = await pages.fetchSharedPages();
      return ok(`${list.length} shared page(s).`, {
        pages: list.map((p) => ({
          address: p.address,
          title: p.title,
          canEdit: !!p.canEdit,
        })),
      });
    },
  );

  server.registerTool(
    "get_page_tags",
    {
      description: "Get the private labels/tags for a document address.",
      inputSchema: { address: z.string() },
    },
    async ({ address }: { address: string }) => {
      const map = await pages.fetchDocTags([address]);
      return ok("Tags fetched.", { address, tags: map.get(address) ?? [] });
    },
  );

  server.registerTool(
    "list_page_comments",
    {
      description:
        "List the inline comments/suggestions on a shared document (kind 1494; needs the doc's viewKey).",
      inputSchema: { address: z.string(), viewKey: z.string() },
    },
    async ({ address, viewKey }: { address: string; viewKey: string }) => {
      const comments = await pagesComments.fetchPageComments(address, viewKey);
      return ok(`${comments.length} comment(s).`, {
        comments: comments.map((c: PageComment) => ({
          author: c.author,
          createdAt: c.createdAt,
          type: c.type,
          content: c.content,
          quote: c.quote,
        })),
      });
    },
  );

  // ── Constructive ──────────────────────────────────────
  server.registerTool(
    "create_page",
    {
      description: "Create an encrypted document/page (Markdown).",
      inputSchema: { title: z.string(), content: z.string() },
    },
    async ({ title, content }: { title: string; content: string }) => {
      const page = await pages.savePage({ content: withTitle(title, content) });
      return ok(`Saved page "${title}".`, { address: page.address });
    },
  );

  server.registerTool(
    "save_private_note",
    {
      description: "Save a quick private encrypted note (Markdown).",
      inputSchema: { title: z.string(), content: z.string() },
    },
    async ({ title, content }: { title: string; content: string }) => {
      const page = await pages.savePage({ content: withTitle(title, content) });
      return ok(`Saved page "${title}".`, { address: page.address });
    },
  );

  server.registerTool(
    "update_page",
    {
      description: "Update an existing document. Pass its docId (d-tag) and the new Markdown.",
      inputSchema: {
        docId: z.string(),
        content: z.string(),
        title: z.string().optional(),
        viewKey: z.string().optional(),
        editKey: z.string().optional(),
      },
    },
    async ({
      docId,
      content,
      title,
      viewKey,
      editKey,
    }: {
      docId: string;
      content: string;
      title?: string;
      viewKey?: string;
      editKey?: string;
    }) => {
      const page = await pages.savePage({
        existingId: docId,
        content: withTitle(title, content),
        viewKey,
        editKey,
      });
      return ok(`Updated page ${docId}.`, { address: page.address });
    },
  );

  server.registerTool(
    "set_page_tags",
    {
      description: "Set the private labels/tags for a document address.",
      inputSchema: { address: z.string(), tags: z.array(z.string()) },
    },
    async ({ address, tags }: { address: string; tags: string[] }) => {
      await pages.setDocTags(address, tags);
      return ok(`Set ${tags.length} tag(s) on ${address}.`);
    },
  );

  // ── Gated (destructive / outward) ─────────────────────
  write = true;

  server.registerTool(
    "delete_page",
    {
      description: "Delete a document (NIP-09). Requires confirm:true.",
      inputSchema: { address: z.string(), confirm: z.boolean().optional() },
    },
    async ({ address, confirm }: { address: string; confirm?: boolean }) => {
      const blocked = requireConfirm("delete_page", { confirm }, `deletes document ${address}`);
      if (blocked) return blocked;
      await pages.deletePage(address);
      return ok(`Deleted ${address}.`);
    },
  );

  server.registerTool(
    "share_page",
    {
      description:
        "Generate a shareable view-only or editable link for a document (re-encrypts under a viewKey). Requires confirm:true.",
      inputSchema: {
        address: z.string(),
        content: z.string(),
        canEdit: z.boolean().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({
      address,
      content,
      canEdit,
      confirm,
    }: {
      address: string;
      content: string;
      canEdit?: boolean;
      confirm?: boolean;
    }) => {
      const blocked = requireConfirm(
        "share_page",
        { confirm },
        `publishes a re-encrypted shareable copy of ${address}`,
      );
      if (blocked) return blocked;
      const result = await pages.sharePage({ address, content, canEdit: Boolean(canEdit) });
      return ok(`Share link created (${canEdit ? "can edit" : "view only"}).`, {
        url: result.url,
        viewKey: result.viewKey,
        editKey: result.editKey,
      });
    },
  );

  server.registerTool(
    "add_page_comment",
    {
      description:
        "Add an inline comment or suggestion to a shared document (kind 1494). Requires confirm:true.",
      inputSchema: {
        address: z.string(),
        eventId: z.string(),
        viewKey: z.string(),
        content: z.string(),
        type: z.enum(["comment", "suggestion"]).optional(),
        quote: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({
      address,
      eventId,
      viewKey,
      content,
      type,
      quote,
      confirm,
    }: {
      address: string;
      eventId: string;
      viewKey: string;
      content: string;
      type?: "comment" | "suggestion";
      quote?: string;
      confirm?: boolean;
    }) => {
      const blocked = requireConfirm(
        "add_page_comment",
        { confirm },
        `publishes a comment on ${address}`,
      );
      if (blocked) return blocked;
      const event = await pagesComments.publishPageComment(
        { content, type: type ?? "comment", ...(quote !== undefined ? { quote } : {}) },
        viewKey,
        address,
        eventId,
      );
      return ok("Comment published.", { id: event.id });
    },
  );

  return tools;
}
