/**
 * Minimal Markdown ↔ HTML bridge for the Pages TipTap editor.
 *
 * We intentionally keep this pair of functions narrow and deterministic
 * so the roundtrip preserves the markdown subset the Pages service stores:
 * H1-H3, paragraphs, bold, italic, code, links, blockquotes, bullet lists,
 * ordered lists, task lists, code blocks, and horizontal rules.
 *
 * Anything outside this subset is preserved as plain text on conversion.
 */

// ── Markdown → HTML ──────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  // Code spans first to avoid mangling bold/italic inside them
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  // Links: [label](url)
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label, url) => `<a href="${url}">${label}</a>`,
  );
  // Bold: **text** or __text__
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // Italic: *text* or _text_  (avoid matching bold we just replaced)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  return out;
}

export function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length, 6);
      out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote><p>${renderInline(buf.join(" "))}</p></blockquote>`);
      continue;
    }

    // Task list item
    if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[[ xX]\]\s+/.test(lines[i])) {
        const m = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(lines[i]);
        if (!m) break;
        const checked = m[1].toLowerCase() === "x";
        buf.push(
          `<li data-type="taskItem" data-checked="${checked}"><p>${renderInline(m[2])}</p></li>`,
        );
        i++;
      }
      out.push(`<ul data-type="taskList">${buf.join("")}</ul>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (
        i < lines.length &&
        /^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*[-*]\s+\[[ xX]\]\s+/.test(lines[i])
      ) {
        const m = /^\s*[-*]\s+(.+)$/.exec(lines[i]);
        if (!m) break;
        buf.push(`<li><p>${renderInline(m[1])}</p></li>`);
        i++;
      }
      out.push(`<ul>${buf.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const m = /^\s*\d+\.\s+(.+)$/.exec(lines[i]);
        if (!m) break;
        buf.push(`<li><p>${renderInline(m[1])}</p></li>`);
        i++;
      }
      out.push(`<ol>${buf.join("")}</ol>`);
      continue;
    }

    // Blank line — paragraph break, skip
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Paragraph: accumulate consecutive non-empty, non-special lines
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*(---|\*\*\*|___)\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(buf.join(" "))}</p>`);
  }

  return out.join("");
}

// ── HTML → Markdown ──────────────────────────────────────

export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  if (typeof document === "undefined") return "";

  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;

  const walk = (node: Node, listContext?: "ul" | "ol" | "task", depth = 0): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    const childText = (ctx?: "ul" | "ol" | "task") =>
      Array.from(el.childNodes)
        .map((c) => walk(c, ctx, depth))
        .join("");

    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const level = Number(tag[1]);
        return `${"#".repeat(level)} ${childText()}\n\n`;
      }
      case "p":
        return `${childText()}\n\n`;
      case "strong":
      case "b":
        return `**${childText()}**`;
      case "em":
      case "i":
        return `*${childText()}*`;
      case "code": {
        // Inline code (not inside pre)
        if (el.parentElement?.tagName.toLowerCase() === "pre") {
          return childText();
        }
        return `\`${childText()}\``;
      }
      case "pre": {
        const code = el.querySelector("code");
        const content = code?.textContent ?? el.textContent ?? "";
        return `\`\`\`\n${content}\n\`\`\`\n\n`;
      }
      case "a": {
        const href = el.getAttribute("href") ?? "";
        return `[${childText()}](${href})`;
      }
      case "blockquote": {
        const inner = childText().trimEnd();
        return (
          inner
            .split("\n")
            .map((line) => (line.length ? `> ${line}` : ">"))
            .join("\n") + "\n\n"
        );
      }
      case "hr":
        return "---\n\n";
      case "br":
        return "\n";
      case "ul": {
        const dataType = el.getAttribute("data-type");
        const ctx = dataType === "taskList" ? "task" : "ul";
        return childText(ctx) + "\n";
      }
      case "ol":
        return childText("ol") + "\n";
      case "li": {
        const dataType = el.getAttribute("data-type");
        const checked = el.getAttribute("data-checked") === "true";
        const indent = "  ".repeat(Math.max(depth - 1, 0));
        const body = Array.from(el.childNodes)
          .map((c) => walk(c, undefined, depth + 1))
          .join("")
          .trim();
        if (dataType === "taskItem" || listContext === "task") {
          return `${indent}- [${checked ? "x" : " "}] ${body}\n`;
        }
        if (listContext === "ol") {
          return `${indent}1. ${body}\n`;
        }
        return `${indent}- ${body}\n`;
      }
      default:
        return childText(listContext);
    }
  };

  return Array.from(wrapper.childNodes)
    .map((c) => walk(c))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
