import type { MediaItem, ScrapedMedia } from "@/scrapers/types";
import { getText, MOBILE_UA, REQUEST_TIMEOUT_MS } from "@/scrapers/http";

/** Matches an Instagram post, reel, or TV link. */
export const instagramPattern =
  /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[\w-]+/i;

/** SnapInsta answers a link with an HTML list of signed CDN links, one per
 *  slide, so a carousel needs neither a browser nor a per-request signature. */
const API_URL = "https://snapinsta.gg/api/ajaxSearch";

/** Thumbnails and app links share the markup, so the title attribute decides
 *  which anchors carry a downloadable file. */
export function parseApiItems(html: string): MediaItem[] {
  const items: MediaItem[] = [];

  for (const [tag] of html.matchAll(/<a\b[^>]*>/g)) {
    const kind = /title="Download (Video|Image)"/.exec(tag)?.[1];
    const href = /href="([^"]+)"/.exec(tag)?.[1];
    if (!kind || !href?.startsWith("http")) continue;

    items.push(
      kind === "Video"
        ? { url: href, kind: "video", mimetype: "video/mp4" }
        : { url: href, kind: "image", mimetype: "image/jpeg" },
    );
  }
  return items;
}

async function fromApi(url: string): Promise<MediaItem[] | null> {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-requested-with": "XMLHttpRequest",
        "user-agent": MOBILE_UA,
      },
      body: new URLSearchParams({ q: url, t: "media", lang: "en" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as { status?: string; data?: string };
    if (json.status !== "ok" || !json.data) return null;

    const items = parseApiItems(json.data);
    return items.length ? items : null;
  } catch {
    return null;
  }
}

interface EmbedMedia {
  is_video?: boolean;
  video_url?: string;
  display_url?: string;
  owner?: { username?: string };
  edge_sidecar_to_children?: { edges: { node: EmbedMedia }[] };
}

/** The embed page ships its GraphQL payload as an escaped JSON string, so the
 *  object is sliced out by brace depth — string-aware, or a caption's braces
 *  would end the scan early — and unescaped once before parsing. */
export function parseInstagramEmbed(html: string): EmbedMedia | null {
  const marker = html.indexOf('\\"gql_data\\":');
  if (marker < 0) return null;

  const start = html.indexOf("{", marker);
  let depth = 0;
  let inString = false;
  let end = -1;

  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (char === "\\") {
      // Inside the payload a string boundary is the escaped quote `\"`.
      if (html[i + 1] === '"') inString = !inString;
      i++;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) return null;

  // The slice is a JS string literal body, so one JSON string parse unescapes
  // it and the second parse reads the GraphQL payload inside.
  try {
    const text = JSON.parse(`"${html.slice(start, end)}"`) as string;
    const data = JSON.parse(text) as { shortcode_media?: EmbedMedia };
    return data.shortcode_media ?? null;
  } catch {
    return null;
  }
}

/** One slide of a post, or null for a node that carries no media. */
const toItem = (node: EmbedMedia): MediaItem | null => {
  if (node.video_url) {
    return { url: node.video_url, kind: "video", mimetype: "video/mp4" };
  }
  if (node.display_url) {
    return { url: node.display_url, kind: "image", mimetype: "image/jpeg" };
  }
  return null;
};

/** Instagram's own embed, the fallback when the downloader API declines. */
async function fromEmbed(
  kind: string,
  shortcode: string,
): Promise<{ items: MediaItem[]; username?: string } | null> {
  const html = await getText(
    `https://www.instagram.com/${kind}/${shortcode}/embed/captioned/`,
    { "user-agent": MOBILE_UA },
  );
  if (!html) return null;

  const post = parseInstagramEmbed(html);
  if (!post) return null;

  // A carousel lists its slides as children; a single post is the node itself.
  const nodes = post.edge_sidecar_to_children?.edges.map(
    (edge) => edge.node,
  ) ?? [post];
  const items = nodes
    .map(toItem)
    .filter((item): item is MediaItem => item !== null);
  if (!items.length) return null;

  return {
    items,
    username: post.owner?.username ?? nodes[0]?.owner?.username,
  };
}

/** Resolves an Instagram post URL to downloadable media, or null when unavailable. */
export async function instagram(url: string): Promise<ScrapedMedia | null> {
  const match = url.match(/instagram\.com\/(p|reel|reels|tv)\/([\w-]+)/i);
  if (!match) return null;

  const kind = match[1] ?? "p";
  const shortcode = match[2] ?? "";

  const api = await fromApi(url);
  const embed = api ? null : await fromEmbed(kind, shortcode);

  const items = api ?? embed?.items ?? [];
  if (!items.length) return null;

  const label =
    items.length > 1
      ? `carousel of ${items.length}`
      : items[0]?.kind === "video"
        ? "reel"
        : "photo";

  return {
    items,
    caption: `${embed?.username ? `@${embed.username} — ` : ""}Instagram ${label}`,
  };
}
