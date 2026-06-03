import { forms, FORM_KINDS, type FormField } from "@formstr/app/services";
import { createRef, parseRef } from "@formstr/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { nip19 } from "nostr-tools";
import { z } from "zod";

import { ok, fail, table } from "../result";
import { requireConfirm } from "../safety";

import { aiFieldsToFormFields, normalizePubkeyList, type RegisterCtx } from "./shared";

const optionShape = z.union([
  z.string(),
  z.object({ id: z.string().optional(), label: z.string() }),
]);

const fieldShape = z
  .object({
    label: z.string(),
    type: z.string(),
    options: z.array(optionShape).optional(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    validation: z
      .object({
        required: z.boolean().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        regex: z.string().optional(),
        regexError: z.string().optional(),
      })
      .optional(),
    gridRows: z.array(z.string()).optional(),
    gridCols: z.array(z.string()).optional(),
    fileConfig: z
      .object({
        blossomServer: z.string().optional(),
        maxBytes: z.number().optional(),
        mimeTypes: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .passthrough();

/** naddr for a form, falling back to the raw coordinate if encoding fails (bad pubkey). */
function formNaddr(pubkey: string, formId: string): string {
  try {
    return createRef("forms", FORM_KINDS.template, pubkey, formId);
  } catch {
    return `${FORM_KINDS.template}:${pubkey}:${formId}`;
  }
}

function npub(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
}

function renderField(f: FormField): string {
  const req = f.required ? " (required)" : "";
  const opts = f.options?.length ? ` — options: ${f.options.map((o) => o.label).join(", ")}` : "";
  return `- [${f.type}] ${f.label}${req}${opts}`;
}

export function registerForms(server: McpServer, ctx: RegisterCtx): void {
  server.registerTool(
    "list_forms",
    { description: "List the forms in the user's forms index, with metadata.", inputSchema: {} },
    async () => {
      const list = await forms.fetchMyForms();
      const rows = list.map((f) => ({
        id: f.id,
        name: f.name,
        encrypted: f.isEncrypted ? "yes" : "no",
        naddr: formNaddr(f.pubkey, f.id),
      }));
      const body =
        list.length === 0
          ? "You have no forms yet. Create one with `create_form`."
          : `You have ${list.length} form(s):\n\n${table(rows, ["id", "name", "encrypted", "naddr"])}`;
      return ok(body, {
        forms: list.map((f) => ({
          id: f.id,
          name: f.name,
          pubkey: f.pubkey,
          isEncrypted: f.isEncrypted,
          createdAt: f.createdAt,
          responseCount: f.responseCount ?? 0,
          naddr: formNaddr(f.pubkey, f.id),
        })),
      });
    },
  );

  server.registerTool(
    "get_form",
    {
      description: "Fetch a single form's definition. Provide viewKey for encrypted forms.",
      inputSchema: { pubkey: z.string(), formId: z.string(), viewKey: z.string().optional() },
    },
    async ({ pubkey, formId, viewKey }) => {
      const form = await forms.fetchForm(pubkey, formId, viewKey);
      if (!form) return fail("Form not found on the configured relays.", "NOT_FOUND");

      const lines = [
        `# ${form.name}`,
        `id: ${form.id} · author: ${npub(form.pubkey)} · encrypted: ${form.isEncrypted ? "yes" : "no"}`,
        `naddr: ${formNaddr(form.pubkey, form.id)}`,
      ];
      if (form.settings?.description) lines.push(`\n${form.settings.description}`);
      if (form.isEncrypted && form.fields.length === 0) {
        lines.push("\n_Encrypted form — provide `viewKey` to reveal the fields._");
      } else if (form.fields.length) {
        lines.push("\n## Fields", ...form.fields.map(renderField));
      }
      return ok(lines.join("\n"), { form });
    },
  );

  server.registerTool(
    "fetch_form_responses",
    {
      description: "Get all responses/submissions for a specific form.",
      inputSchema: { formAuthorPubkey: z.string(), formId: z.string() },
    },
    async ({ formAuthorPubkey, formId }) => {
      // Decrypt with the form's signing key only if it's in the user's own forms list.
      const mine = await forms.fetchMyForms();
      const signingKey = mine.find(
        (f) => f.pubkey === formAuthorPubkey && f.id === formId,
      )?.signingKey;
      const responses = await forms.fetchResponses(formAuthorPubkey, formId, signingKey);

      const blocks = responses.map((r) => {
        const when = new Date(r.createdAt * 1000).toISOString();
        const answers = r.responses.length
          ? r.responses.map((a) => `- ${a.fieldId}: ${a.answer}`).join("\n")
          : r.wasEncrypted
            ? "_(encrypted — you are not the form owner)_"
            : "_(no answers)_";
        return `### ${npub(r.pubkey)} · ${when}\n${answers}`;
      });
      const body =
        responses.length === 0
          ? `No responses yet for form ${formId}.`
          : `Found ${responses.length} response(s) for form ${formId}:\n\n${blocks.join("\n\n")}`;

      return ok(body, {
        count: responses.length,
        responses: responses.map((r) => ({
          id: r.id,
          pubkey: r.pubkey,
          npub: npub(r.pubkey),
          createdAt: r.createdAt,
          responses: r.responses,
        })),
      });
    },
  );

  server.registerTool(
    "create_form",
    {
      description:
        "Create a new form/survey with fields. Supports all field types (text, choice, grid, " +
        "file, signature, section), validation, images and a thank-you message. Returns formId, " +
        "pubkey, and the naddr coordinate.",
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        fields: z.array(fieldShape),
        publicForm: z.boolean().optional(),
        encrypted: z.boolean().optional(),
        titleImageUrl: z.string().optional(),
        coverImageUrl: z.string().optional(),
        thankYouText: z.string().optional(),
        allowedResponders: z.array(z.string()).optional(),
        collaborators: z.array(z.string()).optional(),
        notifyNpubs: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const fields = aiFieldsToFormFields(args.fields);
      const encrypt = args.encrypted ?? false;
      const allowedResponders = normalizePubkeyList(args.allowedResponders);
      const collaborators = normalizePubkeyList(args.collaborators);
      const notifyNpubs = normalizePubkeyList(args.notifyNpubs);
      // createForm publishes the kind-30168 template AND registers it in the user's
      // kind-14083 "my forms" list (persisting signing/view keys for encrypted forms),
      // so there is no separate persist step here.
      const result = await forms.createForm({
        name: args.name,
        fields,
        encrypt,
        settings: {
          description: args.description,
          publicForm: args.publicForm ?? false,
          titleImageUrl: args.titleImageUrl,
          coverImageUrl: args.coverImageUrl,
          thankYouPage: args.thankYouText ? true : undefined,
          thankYouText: args.thankYouText,
          allowedResponders: allowedResponders.length ? allowedResponders : undefined,
          collaborators: collaborators.length ? collaborators : undefined,
          notifyNpubs: notifyNpubs.length ? notifyNpubs : undefined,
        },
      });

      const naddr = formNaddr(result.pubkey, result.formId);
      return ok(
        `Created form "${args.name}" with ${fields.length} field(s).\n` +
          `naddr: ${naddr}\nformId: ${result.formId}` +
          (encrypt && collaborators.length
            ? `\n\nTo let collaborators decrypt it, run \`share_form\` with their npubs.`
            : ""),
        { formId: result.formId, pubkey: result.pubkey, naddr },
      );
    },
  );

  server.registerTool(
    "import_form_from_naddr",
    {
      description:
        "Import a form by reference (naddr1…, pubkey:formId, or kind:pubkey:formId) into your forms list.",
      inputSchema: { ref: z.string() },
    },
    async ({ ref }) => {
      const parsed = parseFormRef(ref);
      if (!parsed) return fail("Expected an naddr or pubkey:formId reference.", "BAD_INPUT");
      const summary = await forms.fetchFormSummaryFromRef(parsed.pubkey, parsed.formId);
      if (!summary) return fail("Form not found on the configured relays.", "NOT_FOUND");
      await forms.importForm(summary);
      return ok(`Imported form "${summary.name}".`, {
        naddr: formNaddr(summary.pubkey, summary.id),
        formId: summary.id,
        pubkey: summary.pubkey,
      });
    },
  );

  // Read tools and constructive creates (above) are always available; only
  // destructive/outward actions below are gated behind --allow-writes.
  if (!ctx.allowWrites) return;

  server.registerTool(
    "update_form",
    {
      description:
        "Update a form's name, fields, or description (republishes it). Requires confirm:true.",
      inputSchema: {
        formId: z.string(),
        formPubkey: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        fields: z.array(fieldShape).optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ formId, formPubkey, name, description, fields, confirm }) => {
      const blocked = requireConfirm("update_form", { confirm }, `republishes form ${formId}`);
      if (blocked) return blocked;
      await forms.updateForm({
        formId,
        pubkey: formPubkey,
        name,
        fields: fields ? aiFieldsToFormFields(fields) : undefined,
        settings: description ? { description } : undefined,
      });
      return ok(`Updated form ${formId}.`, { formId, naddr: formNaddr(formPubkey, formId) });
    },
  );

  server.registerTool(
    "share_form",
    {
      description:
        "Share an encrypted form's view key with collaborators via NIP-59 gift-wrap so they can " +
        "decrypt it. Requires confirm:true.",
      inputSchema: {
        formId: z.string(),
        formPubkey: z.string(),
        recipients: z.array(z.string()),
        confirm: z.boolean().optional(),
      },
    },
    async ({ formId, formPubkey, recipients, confirm }) => {
      const recipientHex = normalizePubkeyList(recipients);
      if (recipientHex.length === 0) return fail("No valid recipients provided.", "BAD_INPUT");
      const blocked = requireConfirm(
        "share_form",
        { confirm },
        `gift-wraps the view key of form ${formId} to ${recipientHex.length} recipient(s)`,
      );
      if (blocked) return blocked;
      const result = await forms.shareForm({ formId, formPubkey, recipients: recipientHex });
      const failedNote = result.failed.length ? ` (${result.failed.length} failed)` : "";
      return ok(`Shared view key with ${result.published} recipient(s)${failedNote}.`, {
        published: result.published,
        failed: result.failed,
      });
    },
  );

  server.registerTool(
    "delete_form",
    {
      description: "Delete a form (publishes a NIP-09 deletion). Requires confirm:true.",
      inputSchema: { formId: z.string(), formPubkey: z.string(), confirm: z.boolean().optional() },
    },
    async ({ formId, formPubkey, confirm }) => {
      const blocked = requireConfirm("delete_form", { confirm }, `deletes form ${formId}`);
      if (blocked) return blocked;
      await forms.deleteForm(formId, formPubkey);
      return ok(`Deleted form ${formId}.`);
    },
  );

  server.registerTool(
    "submit_form_response",
    {
      description: "Submit a response to a form on your identity. Requires confirm:true.",
      inputSchema: {
        formAuthorPubkey: z.string(),
        formId: z.string(),
        encrypt: z.boolean().optional(),
        answers: z.array(
          z.object({
            fieldId: z.string(),
            answer: z.string(),
            metadata: z.string().optional(),
          }),
        ),
        confirm: z.boolean().optional(),
      },
    },
    async ({ formAuthorPubkey, formId, encrypt, answers, confirm }) => {
      const blocked = requireConfirm(
        "submit_form_response",
        { confirm },
        `publicly submits ${answers.length} answer(s) to form ${formId}`,
      );
      if (blocked) return blocked;
      await forms.submitResponse(
        formAuthorPubkey,
        formId,
        answers.map((a) => ({ fieldId: a.fieldId, answer: a.answer, metadata: a.metadata })),
        Boolean(encrypt),
      );
      return ok(`Submitted ${answers.length} answer(s) to form ${formId}.`);
    },
  );
}

/** Parse a form reference: naddr1…, `pubkey:formId`, or `kind:pubkey:formId`. */
function parseFormRef(ref: string): { pubkey: string; formId: string } | null {
  const trimmed = ref.trim();
  if (trimmed.startsWith("naddr1")) {
    const parsed = parseRef(trimmed);
    if (!parsed || parsed.module !== "forms") return null;
    const { pubkey, identifier } = parsed.params;
    return pubkey && identifier ? { pubkey, formId: identifier } : null;
  }
  const parts = trimmed.split(":");
  if (parts.length === 2) return { pubkey: parts[0], formId: parts[1] };
  if (parts.length === 3) return { pubkey: parts[1], formId: parts[2] };
  return null;
}
