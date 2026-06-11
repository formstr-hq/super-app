import { Box, Button, IconButton, Paper, TextField, Tooltip, Typography } from "@mui/material";
import { Check, Pencil, PlusCircle, Trash2, X } from "lucide-react";
import { useState } from "react";

import { normalizePromptKeyword, useSettingsStore } from "../../stores/settingsStore";

/**
 * Saved prompts for the AI panel: each row is a `/keyword` shortcut that expands
 * to the stored prompt text in the chat input (with autosuggestions).
 */
export function PromptsSection() {
  const savedPrompts = useSettingsStore((s) => s.savedPrompts);
  const addSavedPrompt = useSettingsStore((s) => s.addSavedPrompt);
  const updateSavedPrompt = useSettingsStore((s) => s.updateSavedPrompt);
  const removeSavedPrompt = useSettingsStore((s) => s.removeSavedPrompt);

  const [newKeyword, setNewKeyword] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");

  const handleAdd = () => {
    setAddError(null);
    if (!newPrompt.trim()) {
      setAddError("Prompt text is required");
      return;
    }
    const ok = addSavedPrompt(newKeyword, newPrompt);
    if (!ok) {
      setAddError(
        normalizePromptKeyword(newKeyword)
          ? "That keyword is already taken"
          : "Keyword must contain letters or numbers",
      );
      return;
    }
    setNewKeyword("");
    setNewPrompt("");
  };

  const startEdit = (id: string, prompt: string) => {
    setEditingId(id);
    setEditPrompt(prompt);
  };

  const saveEdit = () => {
    if (editingId) updateSavedPrompt(editingId, { prompt: editPrompt });
    setEditingId(null);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 640 }}>
      <Box>
        <Typography variant="subtitle2" fontWeight={600}>
          Saved prompts
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Save prompts you use often. In the AI panel, type <code>/keyword</code> and press Enter to
          insert one.
        </Typography>
      </Box>

      {/* Existing prompts */}
      {savedPrompts.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {savedPrompts.map((p) => (
            <Paper key={p.id} variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography
                  variant="caption"
                  sx={{
                    fontFamily: "monospace",
                    fontWeight: 600,
                    bgcolor: "action.hover",
                    borderRadius: 0.75,
                    px: 0.75,
                    py: 0.25,
                  }}
                >
                  /{p.keyword}
                </Typography>
                <Box sx={{ flex: 1 }} />
                {editingId === p.id ? (
                  <>
                    <Tooltip title="Save">
                      <IconButton size="small" onClick={saveEdit}>
                        <Check size={14} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Cancel">
                      <IconButton size="small" onClick={() => setEditingId(null)}>
                        <X size={14} />
                      </IconButton>
                    </Tooltip>
                  </>
                ) : (
                  <>
                    <Tooltip title="Edit prompt">
                      <IconButton size="small" onClick={() => startEdit(p.id, p.prompt)}>
                        <Pencil size={14} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => removeSavedPrompt(p.id)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </Box>
              {editingId === p.id ? (
                <TextField
                  size="small"
                  fullWidth
                  multiline
                  minRows={2}
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  sx={{ mt: 1 }}
                />
              ) : (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.75, whiteSpace: "pre-wrap" }}
                >
                  {p.prompt}
                </Typography>
              )}
            </Paper>
          ))}
        </Box>
      )}

      {/* Add new */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <TextField
            size="small"
            label="Keyword"
            placeholder="weekly-report"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            helperText={
              newKeyword ? `Will be used as /${normalizePromptKeyword(newKeyword)}` : undefined
            }
            sx={{ maxWidth: 260 }}
          />
          <TextField
            size="small"
            label="Prompt"
            placeholder="Summarize this week's form responses and draft a report page…"
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
          {addError && (
            <Typography variant="caption" color="error">
              {addError}
            </Typography>
          )}
          <Button
            size="small"
            variant="outlined"
            startIcon={<PlusCircle size={14} />}
            onClick={handleAdd}
            sx={{ alignSelf: "flex-start" }}
          >
            Add prompt
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
