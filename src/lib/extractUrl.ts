// Matches http/https URLs with boundaries, ignoring trailing punctuation
const URL_REGEX =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

/**
 * Finds and returns the first HTTP/HTTPS URL from a given string, or null if none.
 */
export function extractFirstUrl(text: string): string | null {
  if (!text) return null;
  const matches = text.match(URL_REGEX);
  return matches ? matches[0] || null : null;
}
