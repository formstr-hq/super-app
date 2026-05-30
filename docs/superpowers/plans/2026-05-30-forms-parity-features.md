# Forms Parity — Bug Fixes & Feature Batch (PR4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two live forms bugs and ship the highest-value missing forms features (file/signature field types, drag-reorder, form settings, response export, responder identity, live responses) to reach functional parity with formstr.app.

**Architecture:** Extend the existing `@formstr/core`-backed forms service + Zustand store + MUI components. Refactor the monolithic `CreateFormDialog` into a focused `FieldEditorRow` plus a new `FormSettingsSection`. Add small pure helpers (`moveItem`, `formatNpub`, response export) under `packages/app/src/lib/` so logic is unit-testable.

**Tech Stack:** React 19, MUI v6, Zustand 5, nostr-tools, Vitest + Testing Library. No new runtime dependencies (native HTML5 drag-and-drop).

**Companion spec:** [../specs/2026-05-30-forms-parity-features-design.md](../specs/2026-05-30-forms-parity-features-design.md)

**Working directory:** repo root `/extra/formstr/super-app`. Run tests with `pnpm --filter @formstr/app test -- <path>`.

**Commit author note:** Per project convention, do NOT add a `Co-Authored-By` trailer to commits.

---

## File Structure

| File                                                        | Responsibility                                                               | Tasks      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------- |
| `packages/app/src/services/forms/service.ts`                | NIP-04 list encryption (done in tree); add `settings` tag to encrypted forms | 1, 6       |
| `packages/app/src/services/forms/service.test.ts`           | Repair mock signer; assert `settings` tag                                    | 1, 6       |
| `packages/app/src/components/forms/FormFieldsRenderer.tsx`  | Forward checkbox props                                                       | 2          |
| `packages/app/src/pages/FillPage.tsx`                       | Checkbox state, encrypt anon responses, thank-you text, login gate           | 2, 6       |
| `packages/app/src/pages/FillPage.test.tsx`                  | Checkbox submit + encrypted submit tests                                     | 2          |
| `packages/app/src/components/forms/CreateFormDialog.tsx`    | Orchestrate fields + settings; new field types; reorder                      | 3, 4, 5, 6 |
| `packages/app/src/components/forms/FieldEditorRow.tsx`      | One field's edit UI + drag handlers (extracted)                              | 4, 5       |
| `packages/app/src/components/forms/FormSettingsSection.tsx` | Thank-you text + access controls (new)                                       | 6          |
| `packages/app/src/components/forms/FillFormDialog.tsx`      | Thank-you text                                                               | 6          |
| `packages/app/src/lib/array.ts`                             | `moveItem` pure helper                                                       | 5          |
| `packages/app/src/lib/array.test.ts`                        | `moveItem` tests                                                             | 5          |
| `packages/app/src/lib/npub.ts`                              | `formatNpub` + `npubToHex` helpers                                           | 6, 7       |
| `packages/app/src/lib/npub.test.ts`                         | helper tests                                                                 | 6, 7       |
| `packages/app/src/lib/exportResponses.ts`                   | CSV/JSON serialisation + download                                            | 7          |
| `packages/app/src/lib/exportResponses.test.ts`              | export tests                                                                 | 7          |
| `packages/app/src/components/forms/ResponsesDialog.tsx`     | Export buttons + responder column                                            | 7          |
| `packages/app/src/stores/formsStore.ts`                     | Live response subscription lifecycle                                         | 8          |
| `packages/app/src/stores/formsStore.test.ts`                | subscribe/unsubscribe tests                                                  | 8          |

---

## Task 1: Repair service tests for NIP-04 list encryption (commit 1)

The working tree already changed `service.ts` to use `signer.encrypt`/`signer.decrypt` (NIP-04) for kind-14083. The test mock signer lacks `encrypt`/`decrypt`, so 3 tests fail. Fix the tests and commit both together.

**Files:**

- Modify: `packages/app/src/services/forms/service.test.ts`

- [ ] **Step 1: Run tests to confirm the 3 failures**

Run: `pnpm --filter @formstr/app test -- src/services/forms/service.test.ts`
Expected: FAIL — `Signer cannot encrypt` in `createForm — plain`, `createForm — encrypted`, `saveToMyForms` (3 failed / 57 passed).

- [ ] **Step 2: Add `encrypt`/`decrypt` to the mock signer**

In `service.test.ts`, extend `mockSigner` (currently lines ~42-51):

```ts
const mockSigner = {
  getPublicKey: vi.fn().mockResolvedValue("aabbccdd"),
  signEvent: vi
    .fn()
    .mockImplementation((e: any) =>
      Promise.resolve({ ...e, id: "eid", sig: "sig", pubkey: "aabbccdd" }),
    ),
  nip44Encrypt: vi.fn(),
  nip44Decrypt: vi.fn(),
  encrypt: vi.fn().mockResolvedValue("nip04_enc"),
  decrypt: vi.fn().mockResolvedValue("[]"),
};
```

- [ ] **Step 3: Update the encrypted-form assertion**

Replace the `nip44SelfEncrypt` assertion in `describe("createForm — encrypted form")` (currently lines ~117-120):

```ts
// kind-14083 published with NIP-04 (signer.encrypt), keys serialised in payload
const listEvent = calls[1][1];
expect(listEvent.kind).toBe(14083);
expect(mockSigner.encrypt).toHaveBeenCalledWith(
  "aabbccdd",
  expect.stringContaining(result.signingKey!),
);
```

- [ ] **Step 4: Update the `saveToMyForms` assertion**

Replace the `nip44SelfEncrypt` assertion in `describe("saveToMyForms")` (currently line ~355):

```ts
expect(mockSigner.encrypt).toHaveBeenCalledWith("aabbccdd", expect.stringContaining("pub1:f1"));
```

- [ ] **Step 5: Run the service tests — expect green**

Run: `pnpm --filter @formstr/app test -- src/services/forms/service.test.ts`
Expected: PASS (all green).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/services/forms/service.ts packages/app/src/services/forms/service.test.ts
git commit -m "fix(forms): NIP-04 kind-14083 encryption for formstr.app compatibility"
```

---

## Task 2: Checkbox support on FillPage + encrypt anonymous responses (commit 2)

**Files:**

- Modify: `packages/app/src/components/forms/FormFieldsRenderer.tsx`
- Modify: `packages/app/src/pages/FillPage.tsx`
- Modify: `packages/app/src/pages/FillPage.test.tsx`

- [ ] **Step 1: Extend `FormFieldsRenderer` to forward checkbox props**

Replace the whole file body:

```tsx
import { Box } from "@mui/material";

import type { FormField } from "../../services/forms/types";

import { FieldInput } from "./FieldInput";

interface Props {
  fields: FormField[];
  values: Record<string, string>;
  checkAnswers?: Record<string, Set<string>>;
  onChange: (fieldId: string, value: string) => void;
  onToggleCheck?: (fieldId: string, optionId: string) => void;
}

export function FormFieldsRenderer({
  fields,
  values,
  checkAnswers,
  onChange,
  onToggleCheck,
}: Props) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {fields.map((field) => (
        <FieldInput
          key={field.id}
          field={field}
          value={values[field.id] ?? ""}
          checkedValues={checkAnswers?.[field.id]}
          onChange={(val) => onChange(field.id, val)}
          onToggleCheck={(optId) => onToggleCheck?.(field.id, optId)}
        />
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Add checkbox state + serialisation + encryption to `FillPage`**

In `FillPage.tsx`:

(a) Add `AnswerType` to the types import:

```tsx
import type { FormTemplate, FormResponse } from "../services/forms/types";
import { AnswerType } from "../services/forms/types";
```

(b) Add checkbox state next to `values`:

```tsx
const [values, setValues] = useState<Record<string, string>>({});
const [checkAnswers, setCheckAnswers] = useState<Record<string, Set<string>>>({});
```

(c) Add a toggle handler (place above `handleSubmit`):

```tsx
const toggleCheck = (fieldId: string, optionId: string) =>
  setCheckAnswers((prev) => {
    const set = new Set(prev[fieldId] ?? []);
    if (set.has(optionId)) set.delete(optionId);
    else set.add(optionId);
    return { ...prev, [fieldId]: set };
  });
```

(d) Replace the body of `handleSubmit` response-building + submit call:

```tsx
const responses: FormResponse[] = form.fields
  .filter((f) => f.type !== AnswerType.label && f.type !== AnswerType.section)
  .map((f) => {
    if (f.type === AnswerType.checkboxes) {
      return { fieldId: f.id, answer: JSON.stringify(Array.from(checkAnswers[f.id] ?? [])) };
    }
    return { fieldId: f.id, answer: values[f.id] ?? "" };
  });

if (identityMode === "me" && isLoggedIn) {
  await formsService.submitResponse(form.pubkey, form.id, responses, form.isEncrypted);
} else {
  const ephSk = generateSecretKey();
  const ephPubkey = getPublicKey(ephSk);
  const ephSigner = {
    getPublicKey: async () => ephPubkey,
    signEvent: async (e: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(e, ephSk),
    nip44Encrypt: async (recipientPubkey: string, plaintext: string) => {
      const convKey = nip44.v2.utils.getConversationKey(ephSk, recipientPubkey);
      return nip44.v2.encrypt(plaintext, convKey);
    },
  };
  await formsService.submitResponse(form.pubkey, form.id, responses, form.isEncrypted, ephSigner);
}
```

(e) Pass checkbox props to the renderer:

```tsx
<FormFieldsRenderer
  fields={form.fields}
  values={values}
  checkAnswers={checkAnswers}
  onChange={(fieldId, value) => setValues((prev) => ({ ...prev, [fieldId]: value }))}
  onToggleCheck={toggleCheck}
/>
```

- [ ] **Step 3: Add tests for checkbox submit + encrypted submit**

Append to `FillPage.test.tsx` inside `describe("FillPage", ...)`. The lucide mock must include the checkbox/icons the FieldInput tree needs — extend the existing `vi.mock("lucide-react", ...)` to return a Proxy so any icon resolves:

Replace the `vi.mock("lucide-react", ...)` block with:

```tsx
vi.mock("lucide-react", () => new Proxy({}, { get: () => () => <span /> }));
```

Add a helper near the other helpers:

```tsx
const mockSubmitResponse = formsService.submitResponse as unknown as ReturnType<typeof vi.fn>;
```

Add tests:

```tsx
it("submits encrypted when the form is encrypted (anonymous)", async () => {
  mockFetchForm.mockResolvedValue(makeForm({ isEncrypted: true }));

  render(<FillPage />);
  await waitFor(() => expect(screen.getByText("Your name")).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

  await waitFor(() => {
    // 4th positional arg is `encrypt` — must be true for encrypted forms
    expect(mockSubmitResponse).toHaveBeenCalledWith(
      "a".repeat(64),
      "form1",
      expect.any(Array),
      true,
      expect.any(Object),
    );
  });
});

it("serialises checkbox selections as a JSON array in the response", async () => {
  mockFetchForm.mockResolvedValue(
    makeForm({
      fields: [
        {
          id: "c1",
          type: AnswerType.checkboxes,
          label: "Pick",
          options: [
            { id: "o1", label: "One" },
            { id: "o2", label: "Two" },
          ],
        },
      ],
    }),
  );

  render(<FillPage />);
  await waitFor(() => expect(screen.getByText("Pick")).toBeInTheDocument());

  fireEvent.click(screen.getByLabelText("One"));
  fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

  await waitFor(() => {
    const responses = mockSubmitResponse.mock.calls[0][2] as { fieldId: string; answer: string }[];
    expect(responses).toContainEqual({ fieldId: "c1", answer: JSON.stringify(["o1"]) });
  });
});
```

Add `fireEvent` and `AnswerType` to imports if not present (they are: `fireEvent` is not yet imported — add it):

```tsx
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
```

- [ ] **Step 4: Run FillPage tests — expect green**

Run: `pnpm --filter @formstr/app test -- src/pages/FillPage.test.tsx`
Expected: PASS (existing 5 + 2 new).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @formstr/app typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/components/forms/FormFieldsRenderer.tsx packages/app/src/pages/FillPage.tsx packages/app/src/pages/FillPage.test.tsx
git commit -m "fix(forms): checkbox support + encrypt anonymous responses on public fill page"
```

---

## Task 3: Enable file-upload & signature field types in the builder (commit 3)

**Files:**

- Modify: `packages/app/src/components/forms/CreateFormDialog.tsx`

- [ ] **Step 1: Add the two MenuItems to the type `<Select>`**

In the field-type `<Select>` (currently lines ~186-196), add after the `label` item:

```tsx
                    <MenuItem value={AnswerType.fileUpload}>File upload</MenuItem>
                    <MenuItem value={AnswerType.signature}>Signature</MenuItem>
```

- [ ] **Step 2: Verify existing dialog tests still pass**

Run: `pnpm --filter @formstr/app test -- src/components/forms/CreateFormDialog.test.tsx`
Expected: PASS (unchanged behaviour).

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @formstr/app typecheck` (expect 0 errors)

```bash
git add packages/app/src/components/forms/CreateFormDialog.tsx
git commit -m "feat(forms): enable file-upload & signature field types in builder"
```

---

## Task 4: Extract `FieldEditorRow` from `CreateFormDialog` (commit 4)

Pure refactor — move one field's editor UI into its own component. No behaviour change.

**Files:**

- Create: `packages/app/src/components/forms/FieldEditorRow.tsx`
- Modify: `packages/app/src/components/forms/CreateFormDialog.tsx`

- [ ] **Step 1: Create `FieldEditorRow.tsx`**

```tsx
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { GripVertical, PlusCircle, Trash2, X } from "lucide-react";

import { AnswerType, type FormField } from "../../services/forms/types";

const CHOICE_TYPES = new Set([AnswerType.radioButton, AnswerType.checkboxes, AnswerType.dropdown]);

interface Props {
  field: FormField;
  index: number;
  onUpdate: (index: number, updates: Partial<FormField>) => void;
  onRemove: (index: number) => void;
  onAddOption: (index: number) => void;
  onUpdateOption: (index: number, optIndex: number, label: string) => void;
  onRemoveOption: (index: number, optIndex: number) => void;
}

export function FieldEditorRow({
  field,
  index,
  onUpdate,
  onRemove,
  onAddOption,
  onUpdateOption,
  onRemoveOption,
}: Props) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <GripVertical size={14} color="var(--mui-palette-text-disabled)" />
        <TextField
          placeholder="Question…"
          value={field.label}
          onChange={(e) => onUpdate(index, { label: e.target.value })}
          size="small"
          sx={{ flex: 1 }}
        />
        <Select
          value={field.type}
          onChange={(e) => onUpdate(index, { type: e.target.value as AnswerType })}
          size="small"
          sx={{ width: 150 }}
        >
          <MenuItem value={AnswerType.shortText}>Short answer</MenuItem>
          <MenuItem value={AnswerType.paragraph}>Paragraph</MenuItem>
          <MenuItem value={AnswerType.radioButton}>Multiple choice</MenuItem>
          <MenuItem value={AnswerType.checkboxes}>Checkboxes</MenuItem>
          <MenuItem value={AnswerType.dropdown}>Dropdown</MenuItem>
          <MenuItem value={AnswerType.number}>Number</MenuItem>
          <MenuItem value={AnswerType.date}>Date</MenuItem>
          <MenuItem value={AnswerType.time}>Time</MenuItem>
          <MenuItem value={AnswerType.datetime}>Date &amp; time</MenuItem>
          <MenuItem value={AnswerType.label}>Label</MenuItem>
          <MenuItem value={AnswerType.fileUpload}>File upload</MenuItem>
          <MenuItem value={AnswerType.signature}>Signature</MenuItem>
        </Select>
        <Tooltip title={field.required ? "Mark optional" : "Mark required"}>
          <Box
            component="button"
            onClick={() => onUpdate(index, { required: !field.required })}
            sx={{
              fontSize: 11,
              px: 1,
              py: 0.25,
              borderRadius: 1,
              border: "1px solid",
              cursor: "pointer",
              bgcolor: field.required ? "primary.main" : "transparent",
              color: field.required ? "primary.contrastText" : "text.secondary",
              borderColor: field.required ? "primary.main" : "divider",
            }}
          >
            Req
          </Box>
        </Tooltip>
        <Tooltip title="Remove field">
          <IconButton size="small" color="error" onClick={() => onRemove(index)}>
            <Trash2 size={13} />
          </IconButton>
        </Tooltip>
      </Box>

      {CHOICE_TYPES.has(field.type) && (
        <Box sx={{ pl: 3.5, mt: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
          {(field.options ?? []).map((opt, oi) => (
            <Box key={opt.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ width: 16, textAlign: "right" }}
              >
                {oi + 1}.
              </Typography>
              <TextField
                size="small"
                value={opt.label}
                onChange={(e) => onUpdateOption(index, oi, e.target.value)}
                placeholder={`Option ${oi + 1}`}
                sx={{ flex: 1, "& .MuiInputBase-input": { py: 0.5, fontSize: 13 } }}
              />
              <IconButton size="small" color="error" onClick={() => onRemoveOption(index, oi)}>
                <X size={12} />
              </IconButton>
            </Box>
          ))}
          <Button
            size="small"
            variant="text"
            startIcon={<PlusCircle size={13} />}
            onClick={() => onAddOption(index)}
            sx={{ alignSelf: "flex-start", fontSize: 12, color: "text.secondary" }}
          >
            Add option
          </Button>
        </Box>
      )}
    </Paper>
  );
}
```

- [ ] **Step 2: Replace the inline field rendering in `CreateFormDialog.tsx`**

Remove the inline `CHOICE_TYPES` const (now in FieldEditorRow) and the inline `{fields.map(...)}` `<Paper>` block; render `FieldEditorRow` instead. Add the import:

```tsx
import { FieldEditorRow } from "./FieldEditorRow";
```

Replace the field list (currently lines ~168-263) with:

```tsx
<Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
  {fields.map((field, index) => (
    <FieldEditorRow
      key={field.id}
      field={field}
      index={index}
      onUpdate={updateField}
      onRemove={removeField}
      onAddOption={addOption}
      onUpdateOption={updateOption}
      onRemoveOption={removeOption}
    />
  ))}
</Box>
```

Remove now-unused imports from `CreateFormDialog.tsx` (`Paper`, `Select`, `MenuItem`, `Tooltip`, `GripVertical`, `Trash2`, `X`, `PlusCircle` if no longer referenced — keep `PlusCircle` if still used by Add question/Add field buttons). Verify by typecheck.

- [ ] **Step 3: Typecheck (catches unused imports via build) + run dialog tests**

Run: `pnpm --filter @formstr/app typecheck`
Expected: 0 errors. Fix any unused-import errors by deleting them.

Run: `pnpm --filter @formstr/app test -- src/components/forms/CreateFormDialog.test.tsx`
Expected: PASS (behaviour unchanged).

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/components/forms/FieldEditorRow.tsx packages/app/src/components/forms/CreateFormDialog.tsx
git commit -m "refactor(forms): extract FieldEditorRow from CreateFormDialog"
```

---

## Task 5: Drag-to-reorder fields (commit 5)

**Files:**

- Create: `packages/app/src/lib/array.ts`
- Create: `packages/app/src/lib/array.test.ts`
- Modify: `packages/app/src/components/forms/FieldEditorRow.tsx`
- Modify: `packages/app/src/components/forms/CreateFormDialog.tsx`

- [ ] **Step 1: Write the failing test for `moveItem`**

`packages/app/src/lib/array.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { moveItem } from "./array";

describe("moveItem", () => {
  it("moves an item from one index to another (forward)", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item backward", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns an equal array when from === to", () => {
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("returns a new array (does not mutate input)", () => {
    const input = ["a", "b", "c"];
    const out = moveItem(input, 0, 1);
    expect(out).not.toBe(input);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("returns a copy when indices are out of range", () => {
    expect(moveItem(["a", "b"], -1, 5)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `pnpm --filter @formstr/app test -- src/lib/array.test.ts`
Expected: FAIL — `moveItem` is not defined.

- [ ] **Step 3: Implement `moveItem`**

`packages/app/src/lib/array.ts`:

```ts
/** Return a new array with the element at `from` relocated to `to`. Out-of-range indices yield a shallow copy. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
```

- [ ] **Step 4: Run it — expect pass**

Run: `pnpm --filter @formstr/app test -- src/lib/array.test.ts`
Expected: PASS.

- [ ] **Step 5: Add drag props to `FieldEditorRow`**

Add to the `Props` interface:

```ts
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
```

Destructure them, and make the root `<Paper>` draggable:

```tsx
    <Paper
      variant="outlined"
      sx={{ p: 1.5, borderRadius: 1.5 }}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(index);
      }}
    >
```

- [ ] **Step 6: Wire reorder state in `CreateFormDialog`**

Add the import:

```tsx
import { useRef, useState } from "react";
import { moveItem } from "../../lib/array";
```

Add a drag ref and handlers (inside the component):

```tsx
const dragIndex = useRef<number | null>(null);
const handleDragStart = (index: number) => {
  dragIndex.current = index;
};
const handleDrop = (index: number) => {
  const from = dragIndex.current;
  dragIndex.current = null;
  if (from === null || from === index) return;
  setFields((prev) => moveItem(prev, from, index));
};
```

Pass them to `FieldEditorRow`:

```tsx
onDragStart = { handleDragStart };
onDrop = { handleDrop };
```

- [ ] **Step 7: Typecheck + run dialog tests + commit**

Run: `pnpm --filter @formstr/app typecheck` (expect 0 errors)
Run: `pnpm --filter @formstr/app test -- src/components/forms/CreateFormDialog.test.tsx` (expect PASS)

```bash
git add packages/app/src/lib/array.ts packages/app/src/lib/array.test.ts packages/app/src/components/forms/FieldEditorRow.tsx packages/app/src/components/forms/CreateFormDialog.tsx
git commit -m "feat(forms): drag-to-reorder fields in builder"
```

---

## Task 6: Form settings — thank-you text + responder access controls (commit 6)

**Files:**

- Create: `packages/app/src/lib/npub.ts`
- Create: `packages/app/src/lib/npub.test.ts`
- Create: `packages/app/src/components/forms/FormSettingsSection.tsx`
- Modify: `packages/app/src/components/forms/CreateFormDialog.tsx`
- Modify: `packages/app/src/services/forms/service.ts`
- Modify: `packages/app/src/services/forms/service.test.ts`
- Modify: `packages/app/src/pages/FillPage.tsx`
- Modify: `packages/app/src/components/forms/FillFormDialog.tsx`

- [ ] **Step 1: Write failing tests for `npubToHex`/`formatNpub`**

`packages/app/src/lib/npub.test.ts`:

```ts
import { nip19 } from "nostr-tools";
import { describe, it, expect } from "vitest";

import { formatNpub, npubToHex } from "./npub";

const HEX = "a".repeat(64);
const NPUB = nip19.npubEncode(HEX);

describe("npubToHex", () => {
  it("decodes a valid npub to hex", () => {
    expect(npubToHex(NPUB)).toBe(HEX);
  });

  it("accepts a raw 64-char hex pubkey", () => {
    expect(npubToHex(HEX)).toBe(HEX);
  });

  it("trims surrounding whitespace", () => {
    expect(npubToHex(`  ${NPUB}  `)).toBe(HEX);
  });

  it("returns null for invalid input", () => {
    expect(npubToHex("not-a-key")).toBeNull();
  });
});

describe("formatNpub", () => {
  it("returns a truncated npub for a hex pubkey", () => {
    const out = formatNpub(HEX);
    expect(out.startsWith("npub1")).toBe(true);
    expect(out).toContain("…");
  });

  it("falls back to truncated hex for invalid input", () => {
    expect(formatNpub("xyz")).toBe("xyz…");
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --filter @formstr/app test -- src/lib/npub.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `npub.ts`**

```ts
import { nip19 } from "nostr-tools";

/** Convert an npub or raw hex pubkey to lowercase hex. Returns null if invalid. */
export function npubToHex(input: string): string | null {
  const trimmed = input.trim();
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === "npub") return decoded.data as string;
  } catch {
    /* not an npub — fall through to hex check */
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

/** Render a hex pubkey as a short, human-readable npub (e.g. "npub1abc…wxyz"). */
export function formatNpub(pubkeyHex: string): string {
  try {
    const npub = nip19.npubEncode(pubkeyHex);
    return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
  } catch {
    return `${pubkeyHex.slice(0, 8)}…`;
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @formstr/app test -- src/lib/npub.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `FormSettingsSection.tsx`**

```tsx
import {
  Box,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import { npubToHex, formatNpub } from "../../lib/npub";
import type { FormSettings } from "../../services/forms/types";

interface Props {
  settings: FormSettings;
  onChange: (patch: Partial<FormSettings>) => void;
}

export function FormSettingsSection({ settings, onChange }: Props) {
  const [npubInput, setNpubInput] = useState("");
  const [npubError, setNpubError] = useState<string | null>(null);

  const addResponder = () => {
    const hex = npubToHex(npubInput);
    if (!hex) {
      setNpubError("Enter a valid npub or hex pubkey");
      return;
    }
    const existing = settings.allowedResponders ?? [];
    if (!existing.includes(hex)) onChange({ allowedResponders: [...existing, hex] });
    setNpubInput("");
    setNpubError(null);
  };

  const removeResponder = (hex: string) =>
    onChange({ allowedResponders: (settings.allowedResponders ?? []).filter((h) => h !== hex) });

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <Typography variant="body2" fontWeight={500}>
          Settings
        </Typography>
        <Divider sx={{ flex: 1 }} />
      </Box>

      <TextField
        label="Thank-you message (optional)"
        placeholder="Thanks for your response!"
        value={settings.thankYouText ?? ""}
        onChange={(e) => onChange({ thankYouText: e.target.value })}
        size="small"
        fullWidth
        multiline
        rows={2}
        sx={{ mb: 1.5 }}
      />

      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={settings.disallowAnonymous ?? false}
            onChange={(e) => onChange({ disallowAnonymous: e.target.checked })}
          />
        }
        label={<Typography variant="body2">Require login to respond</Typography>}
      />

      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Allowed responders (optional — leave empty for anyone)
        </Typography>
        <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="npub1… or hex pubkey"
            value={npubInput}
            error={!!npubError}
            helperText={npubError ?? undefined}
            onChange={(e) => setNpubInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addResponder();
              }
            }}
          />
          <IconButton size="small" onClick={addResponder} aria-label="Add responder">
            <Plus size={16} />
          </IconButton>
        </Box>
        {(settings.allowedResponders ?? []).length > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1 }}>
            {(settings.allowedResponders ?? []).map((hex) => (
              <Chip
                key={hex}
                size="small"
                label={formatNpub(hex)}
                onDelete={() => removeResponder(hex)}
                deleteIcon={<X size={12} />}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 6: Wire settings state into `CreateFormDialog`**

(a) Add imports:

```tsx
import { FormSettingsSection } from "./FormSettingsSection";
import type { FormField, FormSettings } from "../../services/forms/types";
```

(remove the old `type { ... FormField }` import line if duplicated; keep one combined `AnswerType, type FormField, type FormSettings` import — `AnswerType` is a value import, the types are type imports.)

(b) Replace the `description` state with a `settings` object plus keep description for the title field, OR fold description in. Use a single settings state:

```tsx
const [settings, setSettings] = useState<FormSettings>({});
const patchSettings = (patch: Partial<FormSettings>) =>
  setSettings((prev) => ({ ...prev, ...patch }));
```

Keep the existing `description` state and `Description` TextField unchanged.

(c) Render `FormSettingsSection` after the Questions `<Box>` (before the closing `</DialogContent>`):

```tsx
<FormSettingsSection settings={settings} onChange={patchSettings} />
```

(d) Merge settings into the `createForm` call inside `handleCreate`:

```tsx
await createForm({
  name,
  fields,
  settings: {
    publicForm: !encrypt,
    description: description || undefined,
    ...settings,
  },
  encrypt,
});
```

(e) Reset settings in the success branch of `handleCreate`:

```tsx
setSettings({});
```

- [ ] **Step 7: Add the `settings` tag to encrypted forms in `service.ts`**

In `createForm`'s encrypted branch, replace the event `tags` array (currently lines ~76-82) with a settings-aware build:

```tsx
const encTags: string[][] = [
  ["d", formId],
  ["name", params.name],
  ["encryption", "view-key"],
];
if (params.settings) encTags.push(["settings", JSON.stringify(params.settings)]);

const event: EventTemplate = {
  kind: FORM_KINDS.template,
  created_at: Math.floor(Date.now() / 1000),
  tags: encTags,
  content,
};
```

- [ ] **Step 8: Add a service test asserting the settings tag round-trips on encrypted forms**

In `service.test.ts`, inside `describe("createForm — encrypted form")`, add a test:

```ts
it("includes a settings tag on the encrypted form event", async () => {
  const mockFormSigner = { nip44Encrypt: vi.fn().mockResolvedValue("enc_fields") };
  (LocalSigner as any).mockImplementationOnce(() => mockFormSigner);

  await createForm({
    name: "Secret",
    fields: [{ id: "f1", type: "shortText" as any, label: "Q" }],
    settings: { thankYouText: "Cheers", disallowAnonymous: true },
    encrypt: true,
  });

  const formEvent = (nostrRuntime.publish as any).mock.calls[0][1];
  const settingsTag = formEvent.tags.find((t: string[]) => t[0] === "settings");
  expect(settingsTag).toBeTruthy();
  expect(JSON.parse(settingsTag[1])).toMatchObject({ thankYouText: "Cheers" });
});
```

- [ ] **Step 9: Wire thank-you text + login gate into the fill surfaces**

(a) `FillPage.tsx` — replace the hardcoded thank-you (currently lines ~118-120):

```tsx
<Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
  {form.settings?.thankYouText || `Thank you for filling out ${form.name}.`}
</Typography>
```

and replace `requiresLogin` (currently line ~125):

```tsx
const requiresLogin =
  (form.settings?.disallowAnonymous ?? false) ||
  (form.settings?.allowedResponders?.length ?? 0) > 0;
```

(b) `FillFormDialog.tsx` — replace the hardcoded submitted message (currently line ~135-137):

```tsx
<Typography variant="body2" color="text.secondary">
  {form?.settings?.thankYouText || "Thank you for filling out this form."}
</Typography>
```

- [ ] **Step 10: Run the affected tests + typecheck**

Run: `pnpm --filter @formstr/app test -- src/services/forms/service.test.ts src/lib/npub.test.ts src/components/forms/CreateFormDialog.test.tsx src/pages/FillPage.test.tsx`
Expected: PASS.
Run: `pnpm --filter @formstr/app typecheck`
Expected: 0 errors.

- [ ] **Step 11: Commit**

```bash
git add packages/app/src/lib/npub.ts packages/app/src/lib/npub.test.ts packages/app/src/components/forms/FormSettingsSection.tsx packages/app/src/components/forms/CreateFormDialog.tsx packages/app/src/services/forms/service.ts packages/app/src/services/forms/service.test.ts packages/app/src/pages/FillPage.tsx packages/app/src/components/forms/FillFormDialog.tsx
git commit -m "feat(forms): form settings — thank-you text + responder access controls"
```

---

## Task 7: CSV + JSON response export + responder identity (commit 7)

**Files:**

- Create: `packages/app/src/lib/exportResponses.ts`
- Create: `packages/app/src/lib/exportResponses.test.ts`
- Modify: `packages/app/src/components/forms/ResponsesDialog.tsx`

- [ ] **Step 1: Write failing tests for the export serialisers**

`packages/app/src/lib/exportResponses.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { responsesToCsv, responsesToJson } from "./exportResponses";
import { AnswerType, type FormResponseEvent, type FormTemplate } from "../services/forms/types";

const form: FormTemplate = {
  id: "f1",
  name: "Survey",
  pubkey: "p".repeat(64),
  createdAt: 0,
  isEncrypted: false,
  settings: {},
  fields: [
    { id: "q1", type: AnswerType.shortText, label: "Name" },
    {
      id: "q2",
      type: AnswerType.checkboxes,
      label: "Likes",
      options: [
        { id: "o1", label: "Cats" },
        { id: "o2", label: "Dogs" },
      ],
    },
    { id: "q3", type: AnswerType.label, label: "Section header" },
  ],
};

const responses: FormResponseEvent[] = [
  {
    id: "r1",
    pubkey: "a".repeat(64),
    createdAt: 1700000000,
    event: {} as any,
    responses: [
      { fieldId: "q1", answer: "Alice, the great" },
      { fieldId: "q2", answer: JSON.stringify(["o1", "o2"]) },
    ],
  },
];

describe("responsesToCsv", () => {
  it("maps checkbox option ids to labels and joins them", () => {
    const csv = responsesToCsv(form, responses);
    expect(csv).toContain("Cats; Dogs");
  });

  it("excludes label/section fields from columns", () => {
    const csv = responsesToCsv(form, responses);
    expect(csv).not.toContain("Section header");
  });

  it("escapes values containing commas", () => {
    const csv = responsesToCsv(form, responses);
    expect(csv).toContain('"Alice, the great"');
  });

  it("includes a Responder column with the npub", () => {
    const csv = responsesToCsv(form, responses);
    const header = csv.split("\n")[0];
    expect(header).toContain("Responder");
  });
});

describe("responsesToJson", () => {
  it("serialises the raw responses array", () => {
    const json = JSON.parse(responsesToJson(responses));
    expect(json).toHaveLength(1);
    expect(json[0].responses[0].answer).toBe("Alice, the great");
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --filter @formstr/app test -- src/lib/exportResponses.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `exportResponses.ts`**

```ts
import { formatNpub } from "./npub";
import {
  AnswerType,
  type FormField,
  type FormResponseEvent,
  type FormTemplate,
} from "../services/forms/types";

function optionLabel(field: FormField, optionId: string): string {
  return field.options?.find((o) => o.id === optionId)?.label ?? optionId;
}

/** Render a stored answer for display/export, mapping choice option ids to their labels. */
export function renderAnswer(field: FormField, answer: string): string {
  if (!answer) return "";
  if (field.type === AnswerType.checkboxes) {
    try {
      const ids = JSON.parse(answer) as string[];
      return ids.map((id) => optionLabel(field, id)).join("; ");
    } catch {
      return answer;
    }
  }
  if (field.type === AnswerType.radioButton || field.type === AnswerType.dropdown) {
    return optionLabel(field, answer);
  }
  return answer;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function answerableFields(form: FormTemplate): FormField[] {
  return form.fields.filter((f) => f.type !== AnswerType.label && f.type !== AnswerType.section);
}

export function responsesToCsv(form: FormTemplate, responses: FormResponseEvent[]): string {
  const fields = answerableFields(form);
  const header = ["#", "Date", "Responder", ...fields.map((f) => f.label || "—")];
  const rows = responses.map((r, i) => {
    const byId: Record<string, string> = {};
    r.responses.forEach((rr) => {
      byId[rr.fieldId] = rr.answer;
    });
    return [
      String(i + 1),
      new Date(r.createdAt * 1000).toISOString(),
      formatNpub(r.pubkey),
      ...fields.map((f) => renderAnswer(f, byId[f.id] ?? "")),
    ];
  });
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function responsesToJson(responses: FormResponseEvent[]): string {
  return JSON.stringify(responses, null, 2);
}

/** Trigger a client-side file download for the given text content. */
export function downloadTextFile(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @formstr/app test -- src/lib/exportResponses.test.ts`
Expected: PASS.

- [ ] **Step 5: Add export buttons + responder column to `ResponsesDialog`**

(a) Imports:

```tsx
import { Download, Copy } from "lucide-react";
import { formatNpub } from "../../lib/npub";
import {
  responsesToCsv,
  responsesToJson,
  downloadTextFile,
  renderAnswer,
} from "../../lib/exportResponses";
```

(b) Add export handlers inside the component:

```tsx
const handleExportCsv = () => {
  if (!form) return;
  downloadTextFile(
    `${form.name || "form"}-responses.csv`,
    "text/csv",
    responsesToCsv(form, responses),
  );
};
const handleExportJson = () => {
  downloadTextFile(
    `${form?.name || "form"}-responses.json`,
    "application/json",
    responsesToJson(responses),
  );
};
```

(c) In `DialogActions`, add export buttons before Close (disabled when no responses):

```tsx
<DialogActions>
  <Button
    size="small"
    startIcon={<Download size={14} />}
    onClick={handleExportCsv}
    disabled={responses.length === 0}
  >
    CSV
  </Button>
  <Button
    size="small"
    startIcon={<Download size={14} />}
    onClick={handleExportJson}
    disabled={responses.length === 0}
  >
    JSON
  </Button>
  <Box sx={{ flex: 1 }} />
  <Button onClick={onClose}>Close</Button>
</DialogActions>
```

(Add `Box` to the MUI import if not already present — it is.)

(d) Add a "Responder" header cell after "Date":

```tsx
                  <TableCell>Date</TableCell>
                  <TableCell>Responder</TableCell>
```

(e) Add the responder body cell after the Date cell, and switch answer rendering to `renderAnswer`:

```tsx
<TableCell>
  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
    <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
      {formatNpub(r.pubkey)}
    </Typography>
    <IconButton
      size="small"
      onClick={() => navigator.clipboard?.writeText(r.pubkey).catch(() => {})}
      aria-label="Copy responder pubkey"
    >
      <Copy size={11} />
    </IconButton>
  </Box>
</TableCell>;
{
  form.fields
    .filter((f) => f.type !== AnswerType.label)
    .map((f) => (
      <TableCell key={f.id}>
        <Typography variant="caption">{renderAnswer(f, byId[f.id] ?? "")}</Typography>
      </TableCell>
    ));
}
```

(Add `IconButton` to the MUI import.)

- [ ] **Step 6: Typecheck + run all forms tests**

Run: `pnpm --filter @formstr/app typecheck` (expect 0 errors)
Run: `pnpm --filter @formstr/app test -- src/components/forms/ResponsesDialog.test.tsx src/lib/exportResponses.test.ts`
Expected: PASS. If the existing ResponsesDialog test asserts exact column counts, update it to include the new Responder column.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/lib/exportResponses.ts packages/app/src/lib/exportResponses.test.ts packages/app/src/components/forms/ResponsesDialog.tsx
git commit -m "feat(forms): CSV + JSON response export and responder identity column"
```

---

## Task 8: Live response subscription in the responses dialog (commit 8)

Switch `formsStore.loadResponses` from one-shot `fetchResponses` to the live `subscribeToResponses`; tear down in `clearCurrent`.

**Files:**

- Modify: `packages/app/src/stores/formsStore.ts`
- Modify: `packages/app/src/stores/formsStore.test.ts`

- [ ] **Step 1: Update the store**

(a) Imports:

```ts
import type { SubscriptionHandle } from "@formstr/core";
```

(b) Add a module-scope handle above `useFormsStore`:

```ts
let responsesSub: SubscriptionHandle | null = null;
```

(c) Replace `loadResponses`:

```ts
  loadResponses(pubkey, formId) {
    if (responsesSub) {
      responsesSub.unsub();
      responsesSub = null;
    }
    set({ isLoading: true, error: null, responses: [] });
    const summary = get().myForms.find((f) => f.pubkey === pubkey && f.id === formId);
    responsesSub = formsService.subscribeToResponses(
      pubkey,
      formId,
      (resp) =>
        set((state) =>
          state.responses.some((r) => r.id === resp.id)
            ? state
            : { responses: [...state.responses, resp] },
        ),
      () => set({ isLoading: false }),
      summary?.signingKey,
    );
    return Promise.resolve();
  },
```

(d) Replace `clearCurrent`:

```ts
  clearCurrent() {
    if (responsesSub) {
      responsesSub.unsub();
      responsesSub = null;
    }
    set({ currentForm: null, responses: [] });
  },
```

(e) The `FormsStore` interface keeps `loadResponses(pubkey, formId): Promise<void>` (the body returns `Promise.resolve()`), so no interface change is required.

- [ ] **Step 2: Update the store test mock + tests**

In `formsStore.test.ts`, change the service mock to expose `subscribeToResponses` instead of `fetchResponses`:

```ts
vi.mock("../services/forms/service", () => ({
  fetchMyForms: vi.fn(),
  fetchForm: vi.fn(),
  subscribeToResponses: vi.fn(),
  createForm: vi.fn(),
  deleteForm: vi.fn(),
  saveToMyForms: vi.fn(),
}));
```

Replace the entire `describe("loadResponses", ...)` block with:

```ts
describe("loadResponses", () => {
  it("subscribes with signingKey from myForms and accumulates responses", () => {
    useFormsStore.setState({
      myForms: [
        {
          id: "f1",
          name: "Form",
          pubkey: "pub",
          createdAt: 0,
          isEncrypted: true,
          signingKey: "sk",
          viewKey: "vk",
        },
      ],
    });

    let captured: ((r: any) => void) | undefined;
    const handle = { unsub: vi.fn() };
    (formsService.subscribeToResponses as any).mockImplementation(
      (_pub: string, _id: string, onResponse: (r: any) => void) => {
        captured = onResponse;
        return handle;
      },
    );

    void useFormsStore.getState().loadResponses("pub", "f1");

    expect(formsService.subscribeToResponses).toHaveBeenCalledWith(
      "pub",
      "f1",
      expect.any(Function),
      expect.any(Function),
      "sk",
    );

    captured!({ id: "r1", pubkey: "x", responses: [], createdAt: 0, event: {} });
    captured!({ id: "r1", pubkey: "x", responses: [], createdAt: 0, event: {} }); // duplicate
    expect(useFormsStore.getState().responses).toHaveLength(1);
  });

  it("clears stale responses immediately on load", () => {
    useFormsStore.setState({
      responses: [{ id: "old", pubkey: "x", responses: [], createdAt: 0, event: {} as any }],
    });
    (formsService.subscribeToResponses as any).mockReturnValue({ unsub: vi.fn() });

    void useFormsStore.getState().loadResponses("pub", "f1");
    expect(useFormsStore.getState().responses).toHaveLength(0);
  });
});

describe("clearCurrent", () => {
  it("unsubscribes the active responses subscription", () => {
    const handle = { unsub: vi.fn() };
    (formsService.subscribeToResponses as any).mockReturnValue(handle);

    void useFormsStore.getState().loadResponses("pub", "f1");
    useFormsStore.getState().clearCurrent();

    expect(handle.unsub).toHaveBeenCalled();
    expect(useFormsStore.getState().responses).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the store tests — expect pass**

Run: `pnpm --filter @formstr/app test -- src/stores/formsStore.test.ts`
Expected: PASS.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter @formstr/app typecheck` (expect 0 errors)

```bash
git add packages/app/src/stores/formsStore.ts packages/app/src/stores/formsStore.test.ts
git commit -m "feat(forms): live response subscription in responses dialog"
```

---

## Task 9: Full verification (no commit unless fixes needed)

- [ ] **Step 1: Full test suite**

Run: `pnpm --filter @formstr/app test`
Expected: all tests PASS.

- [ ] **Step 2: Coverage gate on forms service**

Run: `pnpm --filter @formstr/app test:coverage`
Expected: `services/forms/**` ≥ 80% lines (gate). Build green.

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @formstr/app typecheck && pnpm --filter @formstr/app build`
Expected: 0 type errors, successful build.

- [ ] **Step 4: If anything fails, fix and amend the relevant commit** (use systematic-debugging skill for non-obvious failures).

---

## Self-Review Notes

- **Spec coverage:** All 9 scope items map to tasks 1–8 (item 0 → T1, items 1–2 → T2, item 3 → T3, item 4 → T4+T5, item 5 → T6, item 6 → T7, item 7 → T7, item 8 → T8). ✅
- **Deviation from spec commit plan:** The spec's commit 4 said "extract FieldEditorRow **& FormSettingsSection**". `FormSettingsSection` is genuinely _new_ (the settings UI does not exist yet), so it is created in Task 6 (settings feature), not the refactor. The refactor (Task 4) extracts `FieldEditorRow` only. Net commit count: 8 feature/fix commits + 1 docs commit.
- **CSV + responder column folded into one commit (Task 7):** they touch the same file (`ResponsesDialog.tsx`) and the CSV needs `formatNpub` too, so they ship together. Spec listed them as commits 7 and 8; merging avoids a churny intermediate state.
- **Type consistency:** `moveItem`, `formatNpub`, `npubToHex`, `renderAnswer`, `responsesToCsv`, `responsesToJson`, `downloadTextFile`, `SubscriptionHandle.unsub()` names are used identically across tasks. `FormSettings` fields (`thankYouText`, `disallowAnonymous`, `allowedResponders`) already exist in `types.ts`. ✅
- **No new dependencies.** ✅
