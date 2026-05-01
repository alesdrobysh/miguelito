/**
 * Convert LLM markdown output to Telegram-compatible HTML.
 * Telegram supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href>, <blockquote>
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function mdToTelegramHtml(md: string): string {
  // Split on fenced code blocks first to protect their contents.
  const parts = md.split(/(```[\s\S]*?```)/g);

  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // Fenced code block: ```lang\ncontent\n```
      const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      const code = match ? match[2] : part.slice(3, -3);
      const lang = match?.[1] ?? "";
      const escaped = escapeHtml(code);
      return lang
        ? `<pre><code class="language-${lang}">${escaped}</code></pre>`
        : `<pre>${escaped}</pre>`;
    }

    // Process inline code before anything else.
    const withInlineCode: string[] = [];
    const inlineParts = part.split(/(`[^`]+`)/g);
    for (let j = 0; j < inlineParts.length; j++) {
      if (j % 2 === 1) {
        withInlineCode.push(`<code>${escapeHtml(inlineParts[j].slice(1, -1))}</code>`);
      } else {
        withInlineCode.push(inlineParts[j]);
      }
    }
    let text = withInlineCode.join("");

    // Escape HTML in non-code segments (the even parts only — odd are already code tags).
    text = text.replace(
      /(<code>[\s\S]*?<\/code>)|([^<]+)/g,
      (match, codeTag, plain) => codeTag ?? escapeHtml(plain),
    );

    // Bold: **text** or __text__
    text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    text = text.replace(/__(.+?)__/g, "<b>$1</b>");

    // Italic: *text* or _text_ (single)
    text = text.replace(/\*([^*]+?)\*/g, "<i>$1</i>");
    text = text.replace(/_([^_]+?)_/g, "<i>$1</i>");

    // Strikethrough: ~~text~~
    text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");

    // Links: [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Headings → bold line
    text = text.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

    // Blockquote: > text
    text = text.replace(/^&gt;\s?(.+)$/gm, "<blockquote>$1</blockquote>");

    // Horizontal rule → blank line
    text = text.replace(/^---+$/gm, "");

    // Unordered list bullets: - item or * item → • item
    text = text.replace(/^[\-\*]\s+/gm, "• ");

    // Ordered list: 1. item → keep as-is (already readable)

    return text;
  }).join("");
}
