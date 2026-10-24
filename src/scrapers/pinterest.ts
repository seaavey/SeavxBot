import type { MediaItem, ScrapedMedia } from "@/scrapers/types";
import { getText, MOBILE_UA } from "@/scrapers/http";

/** Matches a pin link on any locale host. */
export const pinterestPattern =
  /https?:\/\/(?:[\w-]+\.)?pinterest\.[a-z.]+\/pin\/\d+/i;

interface PinBlock {
  "@type"?: string;
  headline?: string;
  image?: string;
  thumbnailUrl?: string;
  author?: { name?: string; alternateName?: string };
}

/** Video and image pins both ship `ld+json`: a `SocialMediaPosting` for the
 *  pin, and for a video also a `VideoObject` whose thumbnail hash names the
 *  one mp4 that belongs to this pin. */
export function parsePinterestHtml(html: string): ScrapedMedia | null {
  const blocks: PinBlock[] = [];
  const scripts =
    /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;

  for (const match of html.matchAll(scripts)) {
    const body = match[1];
    if (!body) continue;
    try {
      blocks.push(JSON.parse(body) as PinBlock);
    } catch {
      // A malformed block is not the page's only block; keep scanning.
    }
  }

  const post = blocks.find((block) => block["@type"] === "SocialMediaPosting");
  const video = blocks.find((block) => block["@type"] === "VideoObject");

  const hash = video?.thumbnailUrl?.split("/").at(-1)?.split(".")[0];
  const mp4 = hash
    ? html
        .match(/https:\/\/v1\.pinimg\.com\/videos\/[^"\s]+?\.mp4/g)
        ?.find((url) => url.includes(hash))
    : undefined;

  const items: MediaItem[] = mp4
    ? [{ url: mp4, kind: "video", mimetype: "video/mp4" }]
    : post?.image
      ? [{ url: post.image, kind: "image", mimetype: "image/jpeg" }]
      : [];
  if (!items.length) return null;

  const author = post?.author?.alternateName ?? post?.author?.name;
  const caption = [author ? `@${author}` : "", post?.headline?.trim() ?? ""]
    .filter(Boolean)
    .join(" — ");

  return { items, caption: caption || "Pinterest pin" };
}

/** Resolves a pin URL to its image or video, or null when unavailable. */
export async function pinterest(url: string): Promise<ScrapedMedia | null> {
  const html = await getText(url, { "user-agent": MOBILE_UA });
  return html ? parsePinterestHtml(html) : null;
}
