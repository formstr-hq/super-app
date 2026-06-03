import { forms, FORM_KINDS } from "@formstr/app/services";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ok, fail } from "../result";
import { requireConfirm } from "../safety";

import { aiFieldsToFormFields, normalizePubkeyList, type RegisterCtx } from "./shared";

const fieldShape = z
  .object({
    label: z.string(),
    type: z.string(),
    options: z.array(z.string()).optional(),
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    gridRows: z.array(z.string()).optional(),
    gridCols: z.array(z.string()).optional(),
  })
  .passthrough();

export function registerForms(server: McpServer, ctx: RegisterCtx): void {
  server.registerTool(
    "list_forms",
    { description: "List the forms in the user's forms index, with metadata.", inputSchema: {} },
    async () => {
      const list = await forms.fetchMyForms();
      return ok(`You have ${list.length} form(s).`, {
        forms: list.map((f) => ({
          id: f.id,
          name: f.name,
          pubkey: f.pubkey,
          isEncrypted: f.isEncrypted,
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
      return form ? ok(`Form "${form.name}".`, { form }) : fail("Form not found.");
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
      return ok(`Found ${responses.length} response(s).`, {
        count: responses.length,
        responses: responses.map((r) => ({
          id: r.id,
          pubkey: r.pubkey,
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
        "Create a new form/survey with fields. Returns formId, pubkey, and the coordinate.",
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        fields: z.array(fieldShape),
        publicForm: z.boolean().optional(),
        encrypted: z.boolean().optional(),
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
          allowedResponders: allowedResponders.length ? allowedResponders : undefined,
          collaborators: collaborators.length ? collaborators : undefined,
          notifyNpubs: notifyNpubs.length ? notifyNpubs : undefined,
        },
      });

      const coordinate = `${FORM_KINDS.template}:${result.pubkey}:${result.formId}`;
      return ok(`Created form "${args.name}" with ${fields.length} field(s).`, {
        formId: result.formId,
        pubkey: result.pubkey,
        coordinate,
      });
    },
  );

  // Read tools and constructive creates (above) are always available; only
  // destructive/outward actions below are gated behind --allow-writes.
  if (!ctx.allowWrites) return;

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
