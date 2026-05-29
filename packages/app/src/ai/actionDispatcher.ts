import type { ActionResult, EntityRef, ToolCall } from "./types";
import { useFormsStore } from "../stores/formsStore";
import { useCalendarStore } from "../stores/calendarStore";
import { usePagesStore } from "../stores/pagesStore";
import { useDriveStore } from "../stores/driveStore";
import { usePollsStore } from "../stores/pollsStore";
import { useAIPendingStore, moduleForTool } from "../stores/aiPendingStore";
import type { AnswerType, FormField } from "../services/forms/types";
import { FORM_KINDS } from "../services/forms/types";
import * as formsService from "../services/forms/service";
import { rsvpToEvent } from "../services/calendar/rsvp";
import { createRef, parseRef } from "@formstr/core";
import { nip19 } from "nostr-tools";

function normalizePubkey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return decoded.data;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function aiFieldsToFormFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, i) => {
    const f = raw as {
      label?: string;
      type?: string;
      options?: string[];
      required?: boolean;
      placeholder?: string;
      gridRows?: string[];
      gridCols?: string[];
    };
    return {
      id: `f${i}`,
      label: f.label ?? "",
      type: (f.type as AnswerType) ?? ("shortText" as AnswerType),
      required: f.required ?? false,
      placeholder: f.placeholder,
      options: f.options?.map((o, j) => ({ id: `o${j}`, label: o })),
      gridRows: f.gridRows,
      gridCols: f.gridCols,
    };
  });
}

function normalizePubkeyList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => (typeof v === "string" ? normalizePubkey(v) : null))
    .filter((p): p is string => !!p);
}

export async function dispatchAction(toolCall: ToolCall): Promise<ActionResult> {
  const args = toolCall.arguments as Record<string, unknown>;
  const module = moduleForTool(toolCall.name);
  const pendingId = module ? useAIPendingStore.getState().begin(module, toolCall.name) : null;
  try {
    return await runDispatch(toolCall, args);
  } finally {
    if (pendingId) useAIPendingStore.getState().end(pendingId);
  }
}

async function runDispatch(
  toolCall: ToolCall,
  args: Record<string, unknown>,
): Promise<ActionResult> {
  switch (toolCall.name) {
    // ── Forms ───────────────────────────────────────────
    case "create_form": {
      const fields = aiFieldsToFormFields(args.fields);
      const collaborators = normalizePubkeyList(args.collaborators);
      const allowedResponders = normalizePubkeyList(args.allowedResponders);
      const notifyNpubs = normalizePubkeyList(args.notifyNpubs);
      const encrypt = (args.encrypted as boolean) ?? false;
      const shareViewKey =
        args.shareViewKey === undefined
          ? encrypt && (collaborators.length > 0 || allowedResponders.length > 0)
          : Boolean(args.shareViewKey);

      const result = await useFormsStore.getState().createForm({
        name: args.name as string,
        fields,
        settings: {
          description: (args.description as string) ?? undefined,
          titleImageUrl: (args.titleImageUrl as string) ?? undefined,
          coverImageUrl: (args.coverImageUrl as string) ?? undefined,
          thankYouPage: args.thankYouText ? true : undefined,
          thankYouText: (args.thankYouText as string) ?? undefined,
          publicForm: (args.publicForm as boolean) ?? false,
          collaborators: collaborators.length ? collaborators : undefined,
          allowedResponders: allowedResponders.length ? allowedResponders : undefined,
          notifyNpubs: notifyNpubs.length ? notifyNpubs : undefined,
        },
        encrypt,
        shareViewKey,
      });

      const naddr = createRef("forms", FORM_KINDS.template, result.pubkey, result.formId);

      const entity: EntityRef = {
        module: "forms",
        ref: naddr,
        label: args.name as string,
        route: "/forms",
      };

      return {
        success: true,
        message: `Created form "${args.name}" with ${fields.length} field(s). Address: ${naddr}`,
        entity,
        data: { formId: result.formId, pubkey: result.pubkey, naddr },
      };
    }

    case "update_form": {
      const formId = args.formId as string;
      const formPubkey = args.formPubkey as string;
      const fields = args.fields ? aiFieldsToFormFields(args.fields) : undefined;
      await useFormsStore.getState().updateForm({
        formId,
        pubkey: formPubkey,
        name: (args.name as string) ?? undefined,
        fields,
        settings: args.description ? { description: args.description as string } : undefined,
      });
      return {
        success: true,
        message: `Updated form ${formId}.`,
        entity: {
          module: "forms",
          ref: createRef("forms", FORM_KINDS.template, formPubkey, formId),
          label: (args.name as string) ?? formId,
          route: "/forms",
        },
      };
    }

    case "delete_form": {
      const formId = args.formId as string;
      const formPubkey = args.formPubkey as string;
      await useFormsStore.getState().deleteForm(formId, formPubkey);
      return {
        success: true,
        message: `Deleted form ${formId}.`,
      };
    }

    case "share_form": {
      const formId = args.formId as string;
      const formPubkey = args.formPubkey as string;
      const recipients = normalizePubkeyList(args.recipients);
      if (recipients.length === 0) {
        return { success: false, message: "No valid recipients provided." };
      }
      const result = await useFormsStore.getState().shareForm({
        formId,
        formPubkey,
        recipients,
      });
      return {
        success: true,
        message: `Shared view key with ${result.published} recipient(s).`,
        data: { published: result.published },
      };
    }

    case "import_form_from_naddr": {
      const ref = (args.ref as string).trim();
      let pubkey: string | null = null;
      let identifier: string | null = null;
      if (ref.startsWith("naddr1")) {
        const parsed = parseRef(ref);
        if (!parsed || parsed.module !== "forms") {
          return { success: false, message: "Not a valid Formstr naddr." };
        }
        pubkey = parsed.params.pubkey;
        identifier = parsed.params.identifier;
      } else if (ref.includes(":")) {
        const parts = ref.split(":");
        if (parts.length === 2) {
          pubkey = parts[0];
          identifier = parts[1];
        } else if (parts.length === 3) {
          pubkey = parts[1];
          identifier = parts[2];
        }
      }
      if (!pubkey || !identifier) {
        return { success: false, message: "Expected naddr or pubkey:formId." };
      }
      const summary = await formsService.fetchFormSummaryFromRef(pubkey, identifier);
      if (!summary) {
        return { success: false, message: "Form not found on configured relays." };
      }
      await useFormsStore.getState().importForm(summary);
      const naddr = createRef("forms", FORM_KINDS.template, summary.pubkey, summary.id);
      return {
        success: true,
        message: `Imported form "${summary.name}".`,
        entity: {
          module: "forms",
          ref: naddr,
          label: summary.name,
          route: "/forms",
        },
      };
    }

    case "submit_form_response": {
      const formAuthorPubkey = args.formAuthorPubkey as string;
      const formId = args.formId as string;
      const answersArg =
        (args.answers as Array<{
          fieldId: string;
          answer: string;
          metadata?: string;
        }>) ?? [];
      const responses = answersArg.map((a) => ({
        fieldId: a.fieldId,
        answer: a.answer,
        metadata: a.metadata,
      }));
      await formsService.submitResponse(formAuthorPubkey, formId, responses, Boolean(args.encrypt));
      return {
        success: true,
        message: `Submitted ${responses.length} answer(s) to form ${formId}.`,
      };
    }

    case "list_forms": {
      await useFormsStore.getState().fetchMyForms();
      const forms = useFormsStore.getState().myForms;
      return {
        success: true,
        message: `You have ${forms.length} form(s).`,
        data: {
          forms: forms.map((f) => ({
            id: f.id,
            name: f.name,
            pubkey: f.pubkey,
            createdAt: f.createdAt,
            isEncrypted: f.isEncrypted,
            responseCount: f.responseCount ?? 0,
            naddr: createRef("forms", FORM_KINDS.template, f.pubkey, f.id),
          })),
        },
      };
    }

    case "fetch_form_responses": {
      await useFormsStore
        .getState()
        .loadResponses(args.formAuthorPubkey as string, args.formId as string);
      const responses = useFormsStore.getState().responses;
      return {
        success: true,
        message: `Found ${responses.length} response(s) for form ${args.formId}.`,
        data: { count: responses.length },
      };
    }

    // ── Calendar ────────────────────────────────────────
    case "create_calendar_event": {
      const start = new Date(args.start as string);
      const end = args.end ? new Date(args.end as string) : new Date(start.getTime() + 3600000);

      const event = await useCalendarStore.getState().createEvent({
        title: args.title as string,
        description: (args.description as string) ?? "",
        begin: start,
        end,
        location: (args.location as string) ?? undefined,
        isPrivate: (args.isPrivate as boolean) ?? false,
      });

      const entity: EntityRef = {
        module: "calendar",
        ref: event.eventId,
        label: args.title as string,
        route: "/calendar",
      };

      return {
        success: true,
        message: `Created calendar event "${args.title}" on ${start.toLocaleDateString()}.`,
        entity,
      };
    }

    case "delete_calendar_event":
    case "delete_event": {
      await useCalendarStore.getState().deleteEvent(args.eventId as string);
      return {
        success: true,
        message: `Deleted calendar event ${args.eventId}.`,
      };
    }

    case "update_event": {
      const id = args.eventId as string;
      const existing = useCalendarStore
        .getState()
        .events.find((e) => e.id === id || e.eventId === id);
      if (!existing) {
        return { success: false, message: `Event not found: ${id}` };
      }

      const begin = args.start ? new Date(args.start as string) : new Date(existing.begin);
      const end = args.end ? new Date(args.end as string) : new Date(existing.end);

      const updated = await useCalendarStore.getState().updateEvent(existing.id, {
        title: (args.title as string) ?? existing.title,
        description: (args.description as string) ?? existing.description,
        begin,
        end,
        location: (args.location as string) ?? existing.location[0],
        isPrivate: existing.isPrivate,
        calendarId: existing.calendarId,
        rrule: (args.rrule as string) ?? existing.repeat.rrule ?? undefined,
        startTzid: (args.startTzid as string) ?? existing.startTzid,
        registrationFormRef: existing.registrationFormRef,
      });

      return {
        success: true,
        message: `Updated event "${updated.title}".`,
        entity: {
          module: "calendar",
          ref: updated.eventId,
          label: updated.title,
          route: "/calendar",
        },
      };
    }

    case "rsvp_event": {
      const coord = args.eventCoordinate as string;
      const status = args.status as "accepted" | "declined" | "tentative";
      await rsvpToEvent(coord, status, (args.isPrivate as boolean) ?? false);
      return {
        success: true,
        message: `RSVP "${status}" sent for event.`,
      };
    }

    case "attach_form_to_event": {
      const id = args.eventId as string;
      const formRef = args.formRef as string;
      const existing = useCalendarStore
        .getState()
        .events.find((e) => e.id === id || e.eventId === id);
      if (!existing) {
        return { success: false, message: `Event not found: ${id}` };
      }
      const updated = await useCalendarStore.getState().updateEvent(existing.id, {
        title: existing.title,
        description: existing.description,
        begin: new Date(existing.begin),
        end: new Date(existing.end),
        location: existing.location[0],
        isPrivate: existing.isPrivate,
        calendarId: existing.calendarId,
        rrule: existing.repeat.rrule ?? undefined,
        startTzid: existing.startTzid,
        registrationFormRef: formRef,
      });
      return {
        success: true,
        message: `Attached form to event "${updated.title}".`,
        entity: {
          module: "calendar",
          ref: updated.eventId,
          label: updated.title,
          route: "/calendar",
        },
      };
    }

    // ── Pages ───────────────────────────────────────────
    case "create_page":
    case "save_private_note": {
      const page = await usePagesStore.getState().savePage({
        title: (args.title as string) ?? "Untitled",
        content: args.content as string,
      });

      const entity: EntityRef = {
        module: "pages",
        ref: page.address,
        label: (args.title as string) ?? "Untitled",
        route: "/pages",
      };

      return {
        success: true,
        message: `Created page "${args.title ?? "Untitled"}".`,
        entity,
      };
    }

    case "share_page": {
      const result = usePagesStore.getState().sharePage(args.address as string);
      if (!result) {
        return { success: false, message: "Page not found or cannot be shared." };
      }
      return {
        success: true,
        message: `Share link generated: ${result.url}`,
        data: result,
      };
    }

    // ── Drive ───────────────────────────────────────────
    case "browse_files": {
      await useDriveStore.getState().fetchFiles();
      const folder = (args.folder as string) ?? "/";
      const files = useDriveStore.getState().getFilesInFolder(folder);
      const folders = useDriveStore.getState().getFolders();

      return {
        success: true,
        message: `Found ${files.length} file(s) in "${folder}". Folders: ${folders.join(", ") || "none"}`,
        data: { files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })), folders },
      };
    }

    // ── Polls ───────────────────────────────────────────
    case "create_poll": {
      const poll = await usePollsStore.getState().createPoll({
        question: args.question as string,
        options: (args.options as string[]).map((label) => ({ label })),
        pollType: (args.pollType as "singlechoice" | "multiplechoice") ?? "singlechoice",
        endsAt: args.endsAt ? new Date(args.endsAt as string) : undefined,
        hashtags: (args.hashtags as string[]) ?? undefined,
      });

      const entity: EntityRef = {
        module: "polls",
        ref: poll.id,
        label: args.question as string,
        route: "/polls",
      };

      return {
        success: true,
        message: `Created poll "${args.question}" with ${(args.options as string[]).length} options.`,
        entity,
      };
    }

    case "fetch_poll_results": {
      await usePollsStore.getState().loadResults(args.pollEventId as string);
      const results = usePollsStore.getState().currentResults;
      const total = results?.totalVotes ?? 0;
      return {
        success: true,
        message: `Poll has ${total} total vote(s).`,
        data: { totalVotes: total },
      };
    }

    default:
      return { success: false, message: `Unknown tool: ${toolCall.name}` };
  }
}
