import { Marked, type Tokens } from "marked";

// Markdown rendering for content that ends up in dangerouslySetInnerHTML
// (model output, user follow-ups, imported documents).
//
// Hardening only, not a full HTML sanitizer: raw HTML in the markdown source is
// shown as text instead of being passed through, and links/images may only use
// http(s), mailto, tel or relative URLs. Markdown formatting is otherwise
// rendered exactly as with the default `marked` instance.

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isSafeUrl(href: string | null | undefined): boolean {
  if (!href) return true;
  // Browsers ignore control characters and whitespace inside a scheme, and
  // decode entities in attributes, so normalise before looking for one.
  const normalised = href
    .replace(/&(#x?[0-9a-f]+|[a-z]+);?/gi, "")
    .replace(/[\u0000- \u007f-\u009f]+/g, "")
    .toLowerCase();
  const match = /^([a-z][a-z0-9+.-]*):/.exec(normalised);
  // No scheme: a relative URL.
  return match ? SAFE_SCHEMES.has(match[1]) : true;
}

const markdown = new Marked({
  renderer: {
    // Block-level and inline raw HTML: render as text.
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
  },
  walkTokens(token) {
    if ((token.type === "link" || token.type === "image") && !isSafeUrl(token.href)) {
      token.href = "#";
    }
  },
});

export function renderMarkdown(text: string): string {
  return markdown.parse(text ?? "", { async: false }) as string;
}
