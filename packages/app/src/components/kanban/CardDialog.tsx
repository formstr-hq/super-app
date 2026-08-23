import type { CardDraft, KanbanCard } from "@formstr/kanban-sdk";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Tooltip,
} from "@mui/material";
import { useEffect, useState } from "react";

import { npubToHex } from "../../lib/npub";
import { profileName, useProfileName } from "../../lib/profileCache";

import { AssigneeAvatar } from "./AssigneeAvatar";

interface CardDialogProps {
  open: boolean;
  /** When set, the dialog edits this card instead of creating one. */
  card?: KanbanCard;
  /** Column heading shown in the title, for context when creating. */
  columnName: string;
  /** Labels already used on this board, offered before anything new is typed. */
  labelOptions?: string[];
  /** Board members, as hex pubkeys, offered as assignees. */
  assigneeOptions?: string[];
  saving: boolean;
  /** Viewers can open a card to read it, but every field and control is off. */
  readOnly?: boolean;
  onClose: () => void;
  onSubmit: (draft: CardDraft) => void;
  /** Offered only to the signer of this version — NIP-09 honours nobody else. */
  onDelete?: () => void;
  /** Offered instead of delete for a card somebody else wrote. */
  onBin?: () => void;
}

/** Trimmed, non-empty and de-duplicated, preserving the order they were added. */
function cleanLabels(values: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/**
 * Hex pubkeys only.
 *
 * Options arrive as hex already; a hand-typed entry may be an npub, and
 * anything that is neither is dropped rather than stored as a `p` tag no relay
 * or client can resolve.
 */
function cleanAssignees(values: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const hex = npubToHex(value);
    if (hex) seen.add(hex);
  }
  return [...seen];
}

/** A pubkey's display name, kept live so a kind-0 lookup repaints it. */
function AssigneeName({ pubkey }: { pubkey: string }) {
  return <>{useProfileName(pubkey)}</>;
}

export function CardDialog({
  open,
  card,
  columnName,
  labelOptions = [],
  assigneeOptions = [],
  saving,
  readOnly = false,
  onClose,
  onSubmit,
  onDelete,
  onBin,
}: CardDialogProps) {
  const editing = card !== undefined;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setTitle(card?.title ?? "");
    setDescription(card?.description ?? "");
    setLabels(card?.labels ?? []);
    setAssignees(card?.assignees ?? []);
  }, [open, card]);

  const canSubmit = title.trim().length > 0 && !saving && !readOnly;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      labels,
      assignees,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>
        {readOnly ? "Card" : editing ? "Edit card" : `New card in ${columnName}`}
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="Title"
            size="small"
            fullWidth
            autoFocus={!readOnly}
            disabled={readOnly}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextField
            label="Description"
            size="small"
            fullWidth
            multiline
            minRows={3}
            disabled={readOnly}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {/* freeSolo on both: the board's own labels and members are a
              shortcut, never the limit. A new label, or someone who has not
              been invited yet, still has to be typeable. */}
          <Autocomplete
            multiple
            freeSolo
            filterSelectedOptions
            disabled={readOnly}
            options={labelOptions}
            value={labels}
            onChange={(_, next) => setLabels(cleanLabels(next as string[]))}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Labels"
                size="small"
                placeholder={labels.length === 0 ? "bug, urgent" : ""}
                helperText={readOnly ? " " : "Pick one used on this board, or type a new one"}
              />
            )}
          />

          <Autocomplete
            multiple
            freeSolo
            filterSelectedOptions
            disabled={readOnly}
            options={assigneeOptions}
            value={assignees}
            getOptionLabel={(option) => profileName(String(option))}
            onChange={(_, next) => setAssignees(cleanAssignees(next as string[]))}
            renderOption={({ key, ...props }, option) => (
              <Box
                component="li"
                key={key}
                {...props}
                sx={{ display: "flex", alignItems: "center", gap: 1 }}
              >
                {/* Decorative here: the name sits right beside it, and the
                    avatar's own aria-label would otherwise be read twice. */}
                <Box component="span" aria-hidden sx={{ display: "flex" }}>
                  <AssigneeAvatar pubkey={option} size={20} />
                </Box>
                <AssigneeName pubkey={option} />
              </Box>
            )}
            renderTags={(values, getTagProps) =>
              values.map((option, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                return (
                  <Chip
                    size="small"
                    {...tagProps}
                    key={key}
                    label={<AssigneeName pubkey={option} />}
                  />
                );
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Assignees"
                size="small"
                placeholder={assignees.length === 0 ? "Board members" : ""}
                helperText={readOnly ? " " : "Board members, or paste an npub"}
              />
            )}
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {/* describeChild on both: the buttons already say what they do, so each
            tooltip is a description. Without it MUI turns the title into the
            button's accessible name. */}
        {editing && onDelete && (
          <Tooltip describeChild title="Publishes a NIP-09 deletion for the version you signed">
            <Button size="small" color="error" onClick={onDelete} sx={{ mr: "auto" }}>
              Delete
            </Button>
          </Tooltip>
        )}
        {editing && !onDelete && onBin && (
          <Tooltip
            describeChild
            title="Hides the card for everyone. Only its author can delete it outright."
          >
            <Button size="small" color="error" onClick={onBin} sx={{ mr: "auto" }}>
              Bin
            </Button>
          </Tooltip>
        )}
        <Button size="small" onClick={onClose}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button size="small" variant="contained" disabled={!canSubmit} onClick={submit}>
            {saving ? "Saving…" : editing ? "Save" : "Add card"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
