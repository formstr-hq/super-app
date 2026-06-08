import { Box, Paper, Typography } from "@mui/material";
import type { Editor, Range } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { PluginKey } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { MentionPicker, type MentionItem } from "../MentionPicker";

import { htmlToMarkdown, markdownToHtml } from "./markdownBridge";
import { SLASH_COMMANDS, filterSlashCommands, type SlashCommandItem } from "./slashCommands";

// ═══════════════════════════════════════════════════════════
// Slash command extension (uses @tiptap/suggestion)
// ═══════════════════════════════════════════════════════════

interface SlashState {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
  clientRect: (() => DOMRect | null) | null;
  query: string;
}

interface MentionState {
  command: (item: { mention: MentionItem } | null) => void;
  clientRect: (() => DOMRect | null) | null;
  query: string;
}

const slashPluginKey = new PluginKey("slashCommands");
const mentionPluginKey = new PluginKey("entityMentions");

function createSlashExtension(
  onOpen: (state: SlashState) => void,
  onUpdate: (state: SlashState) => void,
  onClose: () => void,
  onKeyDown: (e: KeyboardEvent) => boolean,
) {
  return Extension.create({
    name: "slashCommands",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommandItem, SlashCommandItem>({
          editor: this.editor,
          char: "/",
          startOfLine: false,
          pluginKey: slashPluginKey,
          items: ({ query }) => filterSlashCommands(query).slice(0, 10),
          command: ({ editor, range, props }) => {
            props.command({ editor, range });
          },
          render: () => ({
            onStart: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => {
              onOpen({
                items: props.items,
                command: (item) => props.command(item),
                clientRect: props.clientRect ?? null,
                query: props.query,
              });
            },
            onUpdate: (props) => {
              onUpdate({
                items: props.items,
                command: (item) => props.command(item),
                clientRect: props.clientRect ?? null,
                query: props.query,
              });
            },
            onExit: () => onClose(),
            onKeyDown: ({ event }: SuggestionKeyDownProps) => onKeyDown(event),
          }),
        }),
      ];
    },
  });
}

function createMentionExtension(
  onOpen: (state: MentionState) => void,
  onUpdate: (state: MentionState) => void,
  onClose: () => void,
  onKeyDown: (e: KeyboardEvent) => boolean,
) {
  return Extension.create({
    name: "entityMentions",
    addProseMirrorPlugins() {
      return [
        Suggestion<MentionItem, { mention: MentionItem } | null>({
          editor: this.editor,
          char: "@",
          startOfLine: false,
          pluginKey: mentionPluginKey,
          items: () => [],
          command: ({ editor, range, props }) => {
            if (!props) {
              editor.commands.focus();
              return;
            }
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContentAt(range.from, [
                {
                  type: "text",
                  marks: [
                    {
                      type: "link",
                      attrs: { href: `nostr:${props.mention.naddr}`, target: "_blank" },
                    },
                  ],
                  text: `@${props.mention.label}`,
                },
                { type: "text", text: " " },
              ])
              .run();
          },
          render: () => ({
            onStart: (props: SuggestionProps<MentionItem, { mention: MentionItem } | null>) => {
              onOpen({
                command: (item) => props.command(item),
                clientRect: props.clientRect ?? null,
                query: props.query,
              });
            },
            onUpdate: (props) => {
              onUpdate({
                command: (item) => props.command(item),
                clientRect: props.clientRect ?? null,
                query: props.query,
              });
            },
            onExit: () => onClose(),
            onKeyDown: ({ event }: SuggestionKeyDownProps) => onKeyDown(event),
          }),
        }),
      ];
    },
  });
}

// ═══════════════════════════════════════════════════════════
// Slash command popup
// ═══════════════════════════════════════════════════════════

function SlashPopup({
  state,
  selectedIdx,
  onSelect,
}: {
  state: SlashState;
  selectedIdx: number;
  onSelect: (idx: number) => void;
}) {
  const rect = state.clientRect?.() ?? null;
  if (!rect) return null;

  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(rect.bottom + 6, window.innerHeight - 320),
    left: Math.min(rect.left, window.innerWidth - 300),
    zIndex: 1300,
  };

  return createPortal(
    <Paper
      elevation={4}
      style={style}
      sx={{ width: 280, borderRadius: 1.5, overflow: "hidden", py: 0.5 }}
    >
      <Box sx={{ maxHeight: 280, overflowY: "auto" }}>
        {state.items.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
            No commands match “{state.query}”
          </Typography>
        ) : (
          state.items.map((item, i) => {
            const Icon = item.icon;
            const selected = i === selectedIdx;
            return (
              <Box
                key={item.title}
                component="button"
                onMouseEnter={() => onSelect(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  state.command(item);
                }}
                sx={{
                  display: "flex",
                  width: "100%",
                  alignItems: "flex-start",
                  gap: 1.5,
                  px: 2,
                  py: 1,
                  textAlign: "left",
                  border: "none",
                  cursor: "pointer",
                  bgcolor: selected ? "action.selected" : "transparent",
                  color: "text.primary",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Icon
                  size={16}
                  style={{ marginTop: 2, color: "var(--mui-palette-text-secondary)" }}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={500} lineHeight={1.2} sx={{ mb: 0.25 }}>
                    {item.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap display="block">
                    {item.description}
                  </Typography>
                </Box>
              </Box>
            );
          })
        )}
      </Box>
    </Paper>,
    document.body,
  );
}

// ═══════════════════════════════════════════════════════════
// Mention popup — wraps MentionPicker for positioning
// ═══════════════════════════════════════════════════════════

function MentionPopup({
  state,
  onSelect,
  onClose,
}: {
  state: MentionState;
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
}) {
  const rect = state.clientRect?.() ?? null;
  if (!rect) return null;

  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(rect.bottom + 6, window.innerHeight - 280),
    left: Math.min(rect.left, window.innerWidth - 300),
    zIndex: 1300,
  };

  return createPortal(
    <div style={style}>
      <MentionPicker query={state.query} onSelect={onSelect} onClose={onClose} />
    </div>,
    document.body,
  );
}

// ═══════════════════════════════════════════════════════════
// RichEditor component
// ═══════════════════════════════════════════════════════════

export interface RichEditorProps {
  /** Initial markdown */
  initialMarkdown?: string;
  onChangeMarkdown: (markdown: string) => void;
  placeholder?: string;
  className?: string;
  editable?: boolean;
}

export function RichEditor({
  initialMarkdown,
  onChangeMarkdown,
  placeholder = "Start writing, or press / for commands…",
  className,
  editable = true,
}: RichEditorProps) {
  const [slashState, setSlashState] = useState<SlashState | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  const slashIdxRef = useRef(0);
  const slashStateRef = useRef<SlashState | null>(null);
  useEffect(() => {
    slashStateRef.current = slashState;
  }, [slashState]);
  useEffect(() => {
    slashIdxRef.current = slashIdx;
  }, [slashIdx]);

  const [mentionState, setMentionState] = useState<MentionState | null>(null);
  const mentionStateRef = useRef<MentionState | null>(null);
  useEffect(() => {
    mentionStateRef.current = mentionState;
  }, [mentionState]);

  // Keyboard handlers for the two popups
  const handleSlashKeyDown = (e: KeyboardEvent): boolean => {
    const s = slashStateRef.current;
    if (!s) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSlashIdx((idx) => (idx + 1) % Math.max(s.items.length, 1));
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSlashIdx((idx) => (idx - 1 + Math.max(s.items.length, 1)) % Math.max(s.items.length, 1));
      return true;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = s.items[slashIdxRef.current];
      if (item) s.command(item);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      return true;
    }
    return false;
  };

  const handleMentionKeyDown = (e: KeyboardEvent): boolean => {
    // MentionPicker handles its own keyboard (ArrowUp/Down/Enter/Escape)
    // via a window listener, so just swallow these keys so the editor
    // doesn't also react to them.
    if (mentionStateRef.current) {
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Enter" ||
        e.key === "Tab" ||
        e.key === "Escape"
      ) {
        return true;
      }
    }
    return false;
  };

  // Build extensions once — stable across re-renders to avoid editor reset
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // StarterKit v3 bundles Link; disable it so our configured Link below is
        // the only one (avoids tiptap's "Duplicate extension names: ['link']").
        link: false,
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      createSlashExtension(
        (s) => {
          setSlashState(s);
          setSlashIdx(0);
        },
        (s) => {
          setSlashState(s);
          // Clamp selected index when list shrinks
          setSlashIdx((idx) => Math.min(idx, Math.max(s.items.length - 1, 0)));
        },
        () => setSlashState(null),
        handleSlashKeyDown,
      ),
      createMentionExtension(
        (s) => setMentionState(s),
        (s) => setMentionState(s),
        () => setMentionState(null),
        handleMentionKeyDown,
      ),
    ],

    [placeholder],
  );

  const initialContent = useMemo(
    () => (initialMarkdown ? markdownToHtml(initialMarkdown) : ""),
    // Only on mount; parent controls reset via `key` prop if needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable,
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[280px] px-1",
      },
    },
    onUpdate({ editor }) {
      const html = editor.getHTML();
      onChangeMarkdown(htmlToMarkdown(html));
    },
  });

  // When `initialMarkdown` changes externally (e.g. switching between pages),
  // replace the editor content.
  useEffect(() => {
    if (!editor) return;
    const currentMd = htmlToMarkdown(editor.getHTML());
    if ((initialMarkdown ?? "") === currentMd) return;
    editor.commands.setContent(initialMarkdown ? markdownToHtml(initialMarkdown) : "", {
      emitUpdate: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMarkdown]);

  return (
    <Box
      className={`rich-editor ${className || ""}`}
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        "& .tiptap": {
          outline: "none",
          p: 1,
          minHeight: 280,
          typography: "body2",
          "& p.is-editor-empty:first-of-type::before": {
            color: "text.disabled",
            content: "attr(data-placeholder)",
            float: "left",
            height: 0,
            pointerEvents: "none",
          },
        },
      }}
    >
      <EditorContent editor={editor} style={{ flex: 1, minHeight: 0, overflow: "auto" }} />

      {slashState && (
        <SlashPopup state={slashState} selectedIdx={slashIdx} onSelect={setSlashIdx} />
      )}

      {mentionState && (
        <MentionPopup
          state={mentionState}
          onSelect={(item) => {
            mentionState.command({ mention: item });
          }}
          onClose={() => {
            mentionState.command(null);
          }}
        />
      )}
    </Box>
  );
}

// Re-export for external reach
export type { SlashCommandItem };
export { SLASH_COMMANDS };

// ── Styles (scoped via class on container) ───────────────
// Consumed via tailwind `@layer` in index.css; see index.css additions.

// Helper: consume a ref-style mention token. Not actively used yet
// but useful for future extraction.
export function insertMentionLink(editor: Editor, range: Range, item: MentionItem) {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent(`[@${item.label}](nostr:${item.naddr}) `)
    .run();
}
