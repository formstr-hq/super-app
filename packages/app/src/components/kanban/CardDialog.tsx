import type { CardDraft, KanbanCard } from "@formstr/kanban-sdk";
import {
  Autocomplete,
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

interface CardDialogProps {
  open: boolean;
  /** When set, the dialog edits this card instead of creating one. */
  card?: KanbanCard;
  /** Column heading shown in the title, for context when creating. */
  columnName: string;
  /** Labels already in use on this board, offered before anything new is typed. */
  labelOptions?: string[];
  /** The board's roster, as hex pubkeys, offered as assignees. */
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

/** Trimmed, de-duplicated, blanks dropped. */
function cleanLabels(values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/**
 * Assignees as hex pubkeys, whatever they were typed as.
 *
 * An assignee becomes a `p` tag, and a `p` tag has to be a pubkey — anything
 * that is neither an npub nor 64 hex characters is dropped here rather than
 * published as a tag no client can resolve.
 */
function cleanAssignees(values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const hex = npubToHex(value);
    if (hex) seen.add(hex);
  }
  return [...seen];
}

/** A pubkey's display name, live once the kind-0 lands. */
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
      labels: cleanLabels(labels),
      assignees: cleanAssignees(assignees),
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
          {/* freeSolo on both. The board's labels and roster are a shortlist,
              not a whitelist: the first card to carry a label has to be able to
              invent it, and assigning someone not yet invited is legitimate. */}
          <Autocomplete
            multiple
            freeSolo
            disabled={readOnly}
            options={labelOptions}
            value={labels}
            onChange={(_, next) => setLabels(cleanLabels(next))}
            renderTags={(value, getTagProps) =>
              value.map((label, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                return <Chip key={key} size="small" label={label} {...tagProps} />;
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Labels"
                size="small"
                placeholder={labels.length === 0 ? "bug, urgent" : ""}
                helperText={readOnly ? " " : "Pick one already used here, or type a new one"}
              />
            )}
          />
          <Autocomplete
            multiple
            freeSolo
            disabled={readOnly}
            options={assigneeOptions}
            value={assignees}
            onChange={(_, next) => setAssignees(cleanAssignees(next))}
            // Options are hex pubkeys; only their rendering is human.
            getOptionLabel={(option) => profileName(option)}
            renderOption={({ key, ...props }, option) => (
              <li key={key} {...props}>
                <AssigneeName pubkey={option} />
              </li>
            )}
            renderTags={(value, getTagProps) =>
              value.map((pubkey, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                return (
                  <Chip
                    key={key}
                    size="small"
                    label={<AssigneeName pubkey={pubkey} />}
                    {...tagProps}
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
                helperText={readOnly ? " " : "Someone on this board, or paste an npub"}
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
