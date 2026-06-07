import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import type { PollDraft, PollOption, PollType } from "../../services/polls";

interface CreatePollDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: PollDraft) => Promise<unknown>;
}

const emptyOptions = (): PollOption[] => [
  { id: "1", label: "" },
  { id: "2", label: "" },
];

export function CreatePollDialog({ open, onClose, onCreate }: CreatePollDialogProps) {
  const [question, setQuestion] = useState("");
  const [pollType, setPollType] = useState<PollType>("singlechoice");
  const [options, setOptions] = useState<PollOption[]>(emptyOptions());
  const [endsAt, setEndsAt] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [topicDraft, setTopicDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addOption = () => setOptions([...options, { id: String(options.length + 1), label: "" }]);
  const updateOption = (index: number, label: string) =>
    setOptions(options.map((o, i) => (i === index ? { ...o, label } : o)));
  const removeOption = (index: number) =>
    options.length > 2 && setOptions(options.filter((_, i) => i !== index));

  const addTopic = () => {
    const t = topicDraft.trim().replace(/^#/, "").toLowerCase();
    if (t && !topics.includes(t)) setTopics([...topics, t]);
    setTopicDraft("");
  };

  const reset = () => {
    setQuestion("");
    setPollType("singlechoice");
    setOptions(emptyOptions());
    setEndsAt("");
    setTopics([]);
    setTopicDraft("");
  };

  const handleCreate = async () => {
    setIsSubmitting(true);
    try {
      await onCreate({
        question: question.trim(),
        pollType,
        options: options.map((o) => ({ label: o.label.trim() })),
        endsAt: endsAt ? new Date(endsAt) : undefined,
        hashtags: topics.length ? topics : undefined,
      });
      reset();
      onClose();
    } catch {
      /* surfaced via store error */
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValid = question.trim() && options.every((o) => o.label.trim()) && !isSubmitting;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create Poll</DialogTitle>
      <DialogContentText sx={{ px: 3, pb: 0 }}>
        Ask a question and collect responses.
      </DialogContentText>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
        <TextField
          label="Question"
          size="small"
          fullWidth
          placeholder="What would you like to ask?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />

        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
            Options
          </Typography>
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 0.75,
              maxHeight: 192,
              overflowY: "auto",
              pr: 0.5,
            }}
          >
            {options.map((opt, index) => (
              <Box key={opt.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ width: 20, textAlign: "right", flexShrink: 0 }}
                >
                  {index + 1}.
                </Typography>
                <TextField
                  size="small"
                  placeholder={`Option ${index + 1}`}
                  value={opt.label}
                  onChange={(e) => updateOption(index, e.target.value)}
                  sx={{ flex: 1, "& .MuiInputBase-input": { py: 0.625, fontSize: 13 } }}
                />
                <IconButton
                  size="small"
                  disabled={options.length <= 2}
                  onClick={() => removeOption(index)}
                >
                  <X size={13} />
                </IconButton>
              </Box>
            ))}
          </Box>
          <Button
            size="small"
            variant="text"
            startIcon={<Plus size={13} />}
            onClick={addOption}
            sx={{ mt: 0.5, color: "text.secondary", fontSize: 12 }}
          >
            Add option
          </Button>
        </Box>

        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.25 }}>
              Poll type
            </Typography>
            <RadioGroup
              value={pollType}
              onChange={(e) => setPollType(e.target.value as PollType)}
              row
            >
              <FormControlLabel
                value="singlechoice"
                control={<Radio size="small" />}
                label={<Typography variant="body2">Single</Typography>}
              />
              <FormControlLabel
                value="multiplechoice"
                control={<Radio size="small" />}
                label={<Typography variant="body2">Multiple</Typography>}
              />
            </RadioGroup>
          </Box>
          <Box sx={{ flex: 1, minWidth: 180 }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Ends (optional)
            </Typography>
            <TextField
              type="datetime-local"
              size="small"
              fullWidth
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </Box>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
            Topics (optional)
          </Typography>
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", alignItems: "center" }}>
            {topics.map((t) => (
              <Chip
                key={t}
                label={`#${t}`}
                size="small"
                onDelete={() => setTopics(topics.filter((x) => x !== t))}
              />
            ))}
            <TextField
              size="small"
              placeholder="add #tag"
              value={topicDraft}
              onChange={(e) => setTopicDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTopic();
                }
              }}
              onBlur={addTopic}
              sx={{ width: 120, "& .MuiInputBase-input": { py: 0.5, fontSize: 12 } }}
            />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleCreate} disabled={!isValid}>
          {isSubmitting ? "Creating…" : "Create Poll"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
