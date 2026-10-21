/** Shared fetch helpers for scrapers. */

export const REQUEST_TIMEOUT_MS = 20000;

/** Mobile Safari UA. Several platforms serve desktop clients a JavaScript shell
 *  with no media payload, while the mobile markup is server-rendered. */
export const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** GET with a timeout, returning null instead of throwing on network errors. */
export async function getText(
  url: string,
  headers: Record<string, string> = {},
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** GET JSON with a timeout, returning null instead of throwing. */
export async function getJson<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
