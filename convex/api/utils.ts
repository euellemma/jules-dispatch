"use node";

// Telegram's supported HTML tags: b, i, u, s, code, pre, a, blockquote, strong, em, tg-spoiler
const SUPPORTED_TAGS = new Set([
  'b',
  'i',
  'u',
  's',
  'code',
  'pre',
  'a',
  'blockquote',
  'strong',
  'em',
  'tg-spoiler',
]);
const SELF_CLOSING_OR_VOID = new Set([
  'br',
  'hr',
  'img',
  'input',
  'wbr',
  'area',
  'base',
  'col',
  'embed',
  'source',
  'track',
]);
const BLOCK_TAGS_NEED_NEWLINE = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'tr',
  'br',
]);

function sanitizeHtmlForTelegram(html: string): string {
  return html.replace(
    /<\/?([a-z][a-z0-9-]*)([^>]*)>/gi,
    (match, tag, attrs) => {
      const t = tag.toLowerCase();
      const needsNewline = BLOCK_TAGS_NEED_NEWLINE.has(t);

      if (SUPPORTED_TAGS.has(t)) {
        const allowedAttrs =
          t === 'a' ? (attrs.match(/href="[^"]*"/)?.[0] ?? '') : '';
        return `<${t}${allowedAttrs}>`;
      }
      if (SELF_CLOSING_OR_VOID.has(t)) {
        return t === 'br' ? '\n' : '';
      }
      if (needsNewline) {
        return '\n';
      }
      return '';
    },
  );
}

export function chunkHtml(text: string, limit = 4000): string[] {
  const sanitized = sanitizeHtmlForTelegram(text);
  const chunks: string[] = [];
  const openTags: string[] = [];
  const tagRegex = /<(\/?[a-z][a-z0-9-]*)([^>]*)>/gi;
  let i = 0;

  while (i < sanitized.length) {
    let chunk = sanitized.slice(i, i + limit);
    let sliceEnd = i + limit;

    const inPreBlock = (tags: string[]) => tags.includes('pre');

    if (sliceEnd < sanitized.length && !inPreBlock(openTags)) {
      const lastDoubleNewline = chunk.lastIndexOf('\n\n');
      const lastNewline = chunk.lastIndexOf('\n');

      if (lastDoubleNewline > limit * 0.5) {
        sliceEnd = i + lastDoubleNewline + 1;
        chunk = sanitized.slice(i, sliceEnd);
      } else if (lastNewline > limit * 0.5) {
        sliceEnd = i + lastNewline + 1;
        chunk = sanitized.slice(i, sliceEnd);
      }
    }

    const chunkOpenTags: string[] = [];
    let match;
    tagRegex.lastIndex = 0;
    while ((match = tagRegex.exec(chunk)) !== null) {
      const tag = match[1]!.toLowerCase();
      if (tag.startsWith('/')) {
        const inner = tag.slice(1);
        if (
          chunkOpenTags.length > 0 &&
          chunkOpenTags[chunkOpenTags.length - 1] === inner
        ) {
          chunkOpenTags.pop();
        }
      } else if (SUPPORTED_TAGS.has(tag) && !SELF_CLOSING_OR_VOID.has(tag)) {
        chunkOpenTags.push(tag);
      }
    }

    let suffix = '';
    for (const tag of chunkOpenTags.slice().reverse()) {
      suffix += `</${tag}>`;
    }

    let prefix = '';
    if (chunks.length > 0) {
      for (const tag of [...openTags]) {
        prefix += `<${tag}>`;
      }
    }

    const finalChunk = prefix + chunk + suffix;
    if (finalChunk.length > limit + 500) {
      const excess = finalChunk.length - limit;
      if (suffix.length > excess) {
        const reducedSuffix = suffix.slice(
          0,
          Math.max(0, suffix.length - excess),
        );
        chunks.push(prefix + chunk + reducedSuffix);
      } else {
        chunks.push(prefix + chunk);
      }
    } else {
      chunks.push(finalChunk);
    }

    for (const t of chunkOpenTags) {
      if (!openTags.includes(t)) openTags.push(t);
    }

    i = sliceEnd;
  }

  return chunks.filter((c) => c.trim().length > 0);
}
