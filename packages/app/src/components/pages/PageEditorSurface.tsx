import type { PageDocument } from "@formstr/agent/services/pages";
import { Box, Button, Chip, TextField, Typography } from "@mui/material";
import { Lock, Share2, Tag, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { RichEditor } from "./RichEditor";

interface PageEditorSurfaceProps {
  /** The open document, or null for a brand-new draft. */
  page: PageDocument | null;
  tags?: string[];
  readOnly?: boolean;
  saving?: boolean;
  onSave: (content: string) => Promise<unknown> | void;
  onShare: () => void;
  onDelete: () => void;
  onOpenTags: (anchor: HTMLElement) => void;
}

/** Compose the leading H1 title back into the markdown body on save. */
function stripLeadingTitle(markdown: string, title: string): string {
  const trimmed = markdown.replace(/^\s+/, "");
  const nl = trimmed.indexOf("\n");
  const firstLine = nl === -1 ? trimmed : trimmed.slice(0, nl);
  const h1 = /^#\s+(.+?)\s*$/.exec(firstLine);
  if (!h1) return markdown;
  if (!title || h1[1].trim() === title.trim()) {
    return nl === -1 ? "" : trimmed.slice(nl + 1).replace(/^\s*/, "");
  }
  return markdown;
}

const KBD_SX = {
  bgcolor: "action.hover",
  px: 0.5,
  borderRadius: 0.5,
  fontFamily: "monospace",
  fontSize: 11,
} as const;

export function PageEditorSurface({
  page,
  readOnly = false,
  saving = false,
  onSave,
  onShare,
  onDelete,
  onOpenTags,
}: PageEditorSurfaceProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const tagsBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const md = page?.content ?? "";
    const first = md.trim().split("\n")[0] ?? "";
    const derivedTitle = /^#\s+/.test(first)
      ? first.replace(/^#\s+/, "").trim()
      : (page?.title ?? "");
    setTitle(derivedTitle);
    setContent(md);
  }, [page?.address, page?.content, page?.title]);

  const bodyMarkdown = useMemo(() => stripLeadingTitle(content, title), [content, title]);

  const handleSave = () => {
    const body = stripLeadingTitle(content, title);
    void onSave(title ? `# ${title}\n\n${body}` : body);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Title row */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 3, pt: 2 }}>
        <TextField
          variant="standard"
          placeholder="Untitled"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={readOnly}
          InputProps={{
            disableUnderline: true,
            sx: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" },
          }}
          sx={{ flex: 1, minWidth: 0 }}
        />
        <Chip
          icon={<Lock size={12} />}
          label={readOnly ? "Read only" : "Encrypted"}
          size="small"
          sx={{
            flexShrink: 0,
            height: 26,
            fontSize: 12,
            borderRadius: 5,
            bgcolor: "action.hover",
            "& .MuiChip-icon": { ml: 0.85 },
          }}
        />
      </Box>

      {/* Toolbar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 3,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
          flexWrap: "wrap",
        }}
      >
        <Button
          ref={tagsBtnRef}
          variant="outlined"
          size="small"
          color="inherit"
          startIcon={<Tag size={15} />}
          disabled={!page || readOnly}
          onClick={() => tagsBtnRef.current && onOpenTags(tagsBtnRef.current)}
          sx={{ color: "text.primary", borderColor: "divider" }}
        >
          Tags
        </Button>
        <Button
          variant="outlined"
          size="small"
          color="inherit"
          startIcon={<Share2 size={15} />}
          disabled={!page}
          onClick={onShare}
          sx={{ color: "text.primary", borderColor: "divider" }}
        >
          Share
        </Button>
        {!readOnly && (
          <Button
            variant="outlined"
            size="small"
            color="error"
            startIcon={<Trash2 size={15} />}
            disabled={!page}
            onClick={onDelete}
          >
            Delete
          </Button>
        )}
        {!readOnly && (
          <Button
            variant="contained"
            size="small"
            onClick={handleSave}
            disabled={saving || !title.trim()}
            sx={{ ml: "auto" }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </Box>

      {/* Body */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          px: 3,
          py: 2.5,
          "& .ProseMirror": { minHeight: "100%", outline: "none" },
        }}
      >
        <RichEditor
          key={page?.address ?? "new-page"}
          initialMarkdown={bodyMarkdown}
          onChangeMarkdown={setContent}
          editable={!readOnly}
        />
      </Box>

      {/* Hint */}
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ px: 3, py: 1.25, borderTop: 1, borderColor: "divider" }}
      >
        Type{" "}
        <Box component="kbd" sx={KBD_SX}>
          /
        </Box>{" "}
        for blocks ·{" "}
        <Box component="kbd" sx={KBD_SX}>
          @
        </Box>{" "}
        to link a form / event / poll · AI assist inline · autosaves on{" "}
        <Box component="kbd" sx={KBD_SX}>
          ⌘S
        </Box>
      </Typography>
    </Box>
  );
}
