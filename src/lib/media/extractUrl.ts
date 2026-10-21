/**
 * The first http(s) URL in a text, or null. Splitting on whitespace and letting
 * `URL` parse is stricter than a hand-rolled regex: bare hosts, typos and
 * mailto:/tel: links are rejected instead of half-matching.
 */
export function extractFirstUrl(text: string): string | null {
  if (!text) return null;

  for (const token of text.split(/\s+/)) {
    try {
      const url = new URL(token);
      if (url.protocol === "http:" || url.protocol === "https:") return token;
    } catch {
      // Not a URL; keep looking.
    }
  }

  return null;
}
