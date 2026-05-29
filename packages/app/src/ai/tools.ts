import type { ToolDefinition } from "./types";

export const toolDefinitions: ToolDefinition[] = [
  // ── Forms ─────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_form",
      description:
        "Create a new form/survey with specified fields. Returns a form ID and shareable naddr.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Form title" },
          description: { type: "string", description: "Form description shown to respondents" },
          titleImageUrl: { type: "string", description: "Optional title image URL" },
          coverImageUrl: { type: "string", description: "Optional cover image URL" },
          thankYouText: { type: "string", description: "Custom thank-you message shown after submit" },
          fields: {
            type: "array",
            description: "Form fields/questions",
            items: {
              type: "object",
              description: "A form field definition",
              properties: {
                label: { type: "string", description: "Question text" },
                type: {
                  type: "string",
                  description: "Field type",
                  enum: [
                    "shortText",
                    "paragraph",
                    "radioButton",
                    "checkboxes",
                    "dropdown",
                    "number",
                    "date",
                    "time",
                    "datetime",
                    "fileUpload",
                    "signature",
                    "multiChoiceGrid",
                    "checkboxGrid",
                    "label",
                    "section",
                  ],
                },
                options: {
                  type: "array",
                  description: "Options for choice fields (radioButton, checkboxes, dropdown)",
                  items: { type: "string", description: "An option label" },
                },
                required: { type: "boolean", description: "Whether field is required" },
                placeholder: { type: "string", description: "Placeholder text" },
                gridRows: {
                  type: "array",
                  description: "Row labels for grid fields",
                  items: { type: "string", description: "A row label" },
                },
                gridCols: {
                  type: "array",
                  description: "Column labels for grid fields",
                  items: { type: "string", description: "A column label" },
                },
              },
              required: ["label", "type"],
            },
          },
          publicForm: { type: "boolean", description: "Whether form is publicly discoverable" },
          encrypted: { type: "boolean", description: "Whether to encrypt form content (NIP-44)" },
          shareViewKey: {
            type: "boolean",
            description:
              "When true and recipients are listed, distribute the view key via NIP-59 gift-wrap so collaborators/responders can decrypt. Defaults to true when encrypted.",
          },
          collaborators: {
            type: "array",
            description: "Hex pubkeys or npubs that should receive the view key as collaborators",
            items: { type: "string", description: "An npub or hex pubkey" },
          },
          allowedResponders: {
            type: "array",
            description: "Restrict submissions to this allow-list of npubs (empty = anyone)",
            items: { type: "string", description: "An npub or hex pubkey" },
          },
          notifyNpubs: {
            type: "array",
            description: "Recipients of a gift-wrapped notification on each submission",
            items: { type: "string", description: "An npub or hex pubkey" },
          },
        },
        required: ["name", "fields"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_form",
      description:
        "Update an existing form by republishing it under the same form ID. Only the original author can update a form.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "Form identifier (d-tag)" },
          formPubkey: { type: "string", description: "Original author's hex pubkey" },
          name: { type: "string", description: "New form title" },
          description: { type: "string", description: "New description" },
          fields: {
            type: "array",
            description: "Replacement field set (omit to keep existing)",
            items: {
              type: "object",
              description: "A form field definition",
              properties: {
                label: { type: "string", description: "Question text" },
                type: { type: "string", description: "Field type" },
                options: {
                  type: "array",
                  description: "Options for choice fields",
                  items: { type: "string", description: "An option label" },
                },
                required: { type: "boolean", description: "Whether field is required" },
              },
              required: ["label", "type"],
            },
          },
        },
        required: ["formId", "formPubkey"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_form",
      description: "Delete a form by publishing a NIP-09 deletion event.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "Form identifier (d-tag)" },
          formPubkey: { type: "string", description: "Original author's hex pubkey" },
        },
        required: ["formId", "formPubkey"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "share_form",
      description:
        "Share a view-key encrypted form by gift-wrapping its view secret to additional recipients. Form must have been created in view-key encryption mode.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string", description: "Form identifier (d-tag)" },
          formPubkey: { type: "string", description: "Original author's hex pubkey" },
          recipients: {
            type: "array",
            description: "npubs / hex pubkeys to receive the view key",
            items: { type: "string", description: "An npub or hex pubkey" },
          },
        },
        required: ["formId", "formPubkey", "recipients"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "import_form_from_naddr",
      description:
        "Import a form into the user's forms list by its naddr or pubkey:formId coordinate.",
      parameters: {
        type: "object",
        properties: {
          ref: {
            type: "string",
            description: "naddr1… or pubkey:formId / kind:pubkey:formId",
          },
        },
        required: ["ref"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_form_response",
      description:
        "Submit a response to an existing form. Each answer is a fieldId/answer pair.",
      parameters: {
        type: "object",
        properties: {
          formAuthorPubkey: { type: "string", description: "Form author's hex pubkey" },
          formId: { type: "string", description: "Form identifier (d-tag)" },
          encrypt: {
            type: "boolean",
            description: "When true, NIP-44 encrypt the response to the form author.",
          },
          answers: {
            type: "array",
            description: "Field answers",
            items: {
              type: "object",
              description: "An answer entry",
              properties: {
                fieldId: { type: "string", description: "Form field id" },
                answer: { type: "string", description: "The answer text" },
                metadata: { type: "string", description: "Optional auxiliary value" },
              },
              required: ["fieldId", "answer"],
            },
          },
        },
        required: ["formAuthorPubkey", "formId", "answers"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_forms",
      description: "List the forms in the user's forms index, with response counts.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_form_responses",
      description: "Get all responses/submissions for a specific form.",
      parameters: {
        type: "object",
        properties: {
          formAuthorPubkey: { type: "string", description: "Form author's hex pubkey" },
          formId: { type: "string", description: "Form identifier (d-tag)" },
        },
        required: ["formAuthorPubkey", "formId"],
      },
    },
  },

  // ── Calendar ──────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_calendar_event",
      description:
        "Schedule a new calendar event. Provide start time in ISO 8601 format. Can be public or private (encrypted).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          description: { type: "string", description: "Event description" },
          start: { type: "string", description: "Start time in ISO 8601 format (e.g. 2026-04-20T15:00:00)" },
          end: { type: "string", description: "End time in ISO 8601 format" },
          location: { type: "string", description: "Event location" },
          isPrivate: { type: "boolean", description: "Whether event is encrypted/private (default false)" },
        },
        required: ["title", "start"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_calendar_event",
      description: "Delete a calendar event by its event ID.",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string", description: "Calendar event identifier" },
        },
        required: ["eventId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_event",
      description:
        "Update an existing calendar event. Provide the event id (d-tag) and only the fields to change.",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string", description: "Event identifier (d-tag) to update" },
          title: { type: "string", description: "New title" },
          description: { type: "string", description: "New description" },
          start: { type: "string", description: "New start time in ISO 8601" },
          end: { type: "string", description: "New end time in ISO 8601" },
          location: { type: "string", description: "New location" },
          rrule: {
            type: "string",
            description: "RFC-5545 RRULE (e.g. 'FREQ=WEEKLY;BYDAY=MO,WE')",
          },
          startTzid: { type: "string", description: "IANA timezone, e.g. America/New_York" },
        },
        required: ["eventId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rsvp_event",
      description:
        "Respond to a calendar event invitation. Status is one of accepted, declined, tentative.",
      parameters: {
        type: "object",
        properties: {
          eventCoordinate: {
            type: "string",
            description: "Addressable coordinate kind:pubkey:d of the event",
          },
          status: {
            type: "string",
            enum: ["accepted", "declined", "tentative"],
            description: "RSVP status",
          },
          isPrivate: {
            type: "boolean",
            description: "Send as gift-wrapped private RSVP (default false)",
          },
        },
        required: ["eventCoordinate", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "attach_form_to_event",
      description:
        "Attach an existing Formstr form (by naddr or coordinate) as the registration form for a calendar event.",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string", description: "Calendar event identifier (d-tag)" },
          formRef: { type: "string", description: "Form naddr or coordinate" },
        },
        required: ["eventId", "formRef"],
      },
    },
  },

  // ── Pages ─────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_page",
      description:
        "Create a new document/page with Markdown content. The page is encrypted and stored on Nostr relays.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title" },
          content: { type: "string", description: "Document content in Markdown format" },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_private_note",
      description:
        "Save a quick private note. The note is encrypted and stored for the user only.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Note title" },
          content: { type: "string", description: "Note content (Markdown)" },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "share_page",
      description: "Share a document with other Nostr users by their npub.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Document address (kind:pubkey:dtag)" },
          recipients: {
            type: "array",
            description: "npubs of recipients",
            items: { type: "string", description: "An npub" },
          },
        },
        required: ["address", "recipients"],
      },
    },
  },

  // ── Drive ─────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "browse_files",
      description:
        "List files in the user's encrypted drive. Optionally filter by folder.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Folder path to list (default: root '/')" },
        },
        required: [],
      },
    },
  },

  // ── Polls ─────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_poll",
      description: "Create a new poll/vote with options for people to vote on.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "Poll question" },
          options: {
            type: "array",
            description: "Poll options/choices",
            items: { type: "string", description: "An option label" },
          },
          pollType: {
            type: "string",
            description: "Whether users can pick one or multiple options",
            enum: ["singlechoice", "multiplechoice"],
          },
          endsAt: { type: "string", description: "Poll end time in ISO 8601 format" },
          hashtags: {
            type: "array",
            description: "Hashtags for discoverability",
            items: { type: "string", description: "A hashtag" },
          },
        },
        required: ["question", "options"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_poll_results",
      description: "Get current results/votes for a specific poll.",
      parameters: {
        type: "object",
        properties: {
          pollEventId: { type: "string", description: "Poll event ID" },
        },
        required: ["pollEventId"],
      },
    },
  },
];
