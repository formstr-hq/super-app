import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor, Range } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";

import { cn } from "@/lib/utils";
import {
  SLASH_COMMANDS,
  filterSlashCommands,
  type SlashCommandItem,
} from "./slashCommands";
import { htmlToMarkdown, markdownToHtml } from "./markdownBridge";
import { MentionPicker, type MentionItem } from "../MentionPicker";

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
            onStart: (
              props: SuggestionProps<MentionItem, { mention: MentionItem } | null>,
            ) => {
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
    zIndex: 60,
  };

  return createPortal(
    <div
      style={style}
      className="w-72 overflow-hidden rounded-md border border-border bg-popover shadow-lg"
    >
      <div className="max-h-72 overflow-y-auto py-1">
        {state.items.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No commands match “{state.query}”
          </div>
        ) : (
          state.items.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.title}
                onMouseEnter={() => onSelect(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  state.command(item);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                  i === selectedIdx
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
              >
                <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">{item.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.description}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>,
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
    zIndex: 60,
  };

  return createPortal(
    <div style={style}>
      <MentionPicker
        query={state.query}
        onSelect={onSelect}
        onClose={onClose}
      />
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
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "underline underline-offset-2" },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        class:
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[280px] px-1",
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
    <div className={cn("rich-editor flex flex-col min-h-0", className)}>
      <EditorContent editor={editor} className="flex-1 min-h-0 overflow-auto" />

      {slashState && (
        <SlashPopup
          state={slashState}
          selectedIdx={slashIdx}
          onSelect={setSlashIdx}
        />
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
    </div>
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
