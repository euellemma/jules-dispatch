/**
 * Telegram MarkdownV2 formatting utilities.
 * 
 * Converts natural markdown to Telegram MarkdownV2 format.
 * Based on Hermes agent format_message implementation.
 */

// Characters that need escaping in MarkdownV2 (per Telegram Bot API docs)
// Note: Backslash must be escaped first to avoid double-escaping
const MDV2_ESCAPE_CHARS = ['\\', '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];

/**
 * Escape Telegram MarkdownV2 special characters with a preceding backslash.
 */
export function escapeMdv2(text: string): string {
  let result = text;
  // Escape backslash first to avoid double-escaping other characters
  result = result.replace(/\\/g, "\\\\");
  // Escape other special characters
  for (const char of MDV2_ESCAPE_CHARS.slice(1)) {
    const regex = new RegExp(`\\${char}`, 'g');
    result = result.replace(regex, `\\${char}`);
  }
  return result;
}

/**
 * Strip MarkdownV2 escape backslashes to produce clean plain text.
 * Also removes MarkdownV2 formatting markers.
 */
export function stripMdv2(text: string): string {
  let cleaned = text;
  // Remove MarkdownV2 spoiler markers
  cleaned = cleaned.replace(/\|\|([^|]+)\|\|/g, "$1");
  // Remove MarkdownV2 strikethrough markers
  cleaned = cleaned.replace(/~([^~]+)~/g, "$1");
  // Remove MarkdownV2 bold markers
  cleaned = cleaned.replace(/\*([^*]+)\*/g, "$1");
  // Remove MarkdownV2 italic markers (with word boundary protection)
  cleaned = cleaned.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1");
  // Remove escape backslashes before special characters (but preserve actual backslashes)
  cleaned = cleaned.replace(/\\([_\*\[\]()~`>#+\-=|{}.!])/g, "$1");
  // Replace escaped backslashes with single backslash
  cleaned = cleaned.replace(/\\\\/g, "\\");
  return cleaned;
}

/**
 * Convert standard markdown to Telegram MarkdownV2 format.
 * 
 * Protected regions (code blocks, inline code) are extracted first so
 * their contents are never modified. Standard markdown constructs
 * (headers, bold, italic, links) are translated to MarkdownV2 syntax,
 * and all remaining special characters are escaped.
 */
export function formatToMdv2(content: string): string {
  if (!content) {
    return content;
  }

  const placeholders = new Map<string, string>();
  let counter = 0;

  function ph(value: string): string {
    const key = `\x00PH${counter++}\x00`;
    placeholders.set(key, value);
    return key;
  }

  let text = content;

  // 1) Protect fenced code blocks (``` ... ```)
  text = text.replace(/(```(?:[^\n]*\n)?[\s\S]*?```)/g, (match) => {
    const codeContent = match;
    // Find the newline after opening ```
    const openEnd = codeContent.indexOf("\n", 3) + 1;
    if (openEnd === 0) {
      // Single line code block, no newline
      return ph(codeContent);
    }
    const opening = codeContent.slice(0, openEnd);
    const bodyAndClose = codeContent.slice(openEnd);
    const body = bodyAndClose.slice(0, -3);
    // Escape \ and ` inside code per MarkdownV2 spec
    const escapedBody = body.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
    return ph(opening + escapedBody + "```");
  });

  // 2) Protect inline code (`...`)
  text = text.replace(/(`[^`]+`)/g, (match) => {
    // Escape \ inside inline code per MarkdownV2 spec
    return ph(match.replace(/\\/g, "\\\\"));
  });

  // 3) Convert markdown links – escape the display text; inside the URL
  // only ')' and '\' need escaping per the MarkdownV2 spec.
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, display: string, url: string) => {
      const escapedDisplay = escapeMdv2(display);
      const escapedUrl = url.replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
      return ph(`[${escapedDisplay}](${escapedUrl})`);
    }
  );

  // 4) Convert markdown headers (## Title) → bold *Title*
  text = text.replace(
    /^#{1,6}\s+(.+)$/gm,
    (match, inner: string) => {
      const cleaned = inner.replace(/\*\*(.+?)\*\*/g, "$1");
      return ph(`*${escapeMdv2(cleaned)}*`);
    }
  );

  // 5) Convert bold: **text** → *text* (MarkdownV2 bold)
  text = text.replace(
    /\*\*(.+?)\*\*/g,
    (match, inner: string) => {
      return ph(`*${escapeMdv2(inner)}*`);
    }
  );

  // 6) Convert italic: *text* (single asterisk) → _text_ (MarkdownV2 italic)
  // [^*\n]+ prevents matching across newlines (which would corrupt
  // bullet lists using * markers and multi-line content).
  text = text.replace(
    /\*([^*\n]+)\*/g,
    (match, inner: string) => {
      return ph(`_${escapeMdv2(inner)}_`);
    }
  );

  // 7) Convert strikethrough: ~~text~~ → ~text~ (MarkdownV2)
  text = text.replace(
    /~~(.+?)~~/g,
    (match, inner: string) => {
      return ph(`~${escapeMdv2(inner)}~`);
    }
  );

  // 8) Convert spoiler: ||text|| → ||text|| (protect from | escaping)
  text = text.replace(
    /\|\|(.+?)\|\|/g,
    (match, inner: string) => {
      return ph(`||${escapeMdv2(inner)}||`);
    }
  );

  // 9) Convert blockquotes: > at line start → protect > from escaping
  text = text.replace(
    /^(>{1,3}) (.+)$/gm,
    (match, arrows: string, content: string) => {
      return ph(arrows + " " + escapeMdv2(content));
    }
  );

  // 10) Escape remaining special characters in plain text
  text = escapeMdv2(text);

  // 11) Restore placeholders in reverse insertion order so that
  // nested references (a placeholder inside another) resolve correctly.
  const keys = Array.from(placeholders.keys()).reverse();
  for (const key of keys) {
    const value = placeholders.get(key);
    if (value) {
      text = text.replace(key, value);
    }
  }

  return text;
}

/**
 * Format message for Telegram with automatic MarkdownV2 conversion.
 * Returns the formatted text ready to send.
 */
export function formatTelegramMessage(content: string): string {
  return formatToMdv2(content);
}

/**
 * Chunk a message into Telegram-compatible sizes (max 4096 chars per message).
 * Attempts to split at line breaks or sentence boundaries.
 */
export function chunkMessage(text: string, maxLength: number = 4096): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point
    let splitPoint = maxLength;
    
    // Try to find a newline before maxLength
    const lastNewline = remaining.lastIndexOf("\n", maxLength);
    if (lastNewline > maxLength * 0.5) {
      splitPoint = lastNewline + 1;
    } else {
      // Try to find a sentence end
      const lastSentence = remaining.lastIndexOf(". ", maxLength - 1);
      if (lastSentence > maxLength * 0.5) {
        splitPoint = lastSentence + 2;
      } else {
        // Try to find a space
        const lastSpace = remaining.lastIndexOf(" ", maxLength);
        if (lastSpace > maxLength * 0.5) {
          splitPoint = lastSpace + 1;
        }
      }
    }

    chunks.push(remaining.slice(0, splitPoint));
    remaining = remaining.slice(splitPoint);
  }

  return chunks;
}
