import type { MediaItem, ScrapedMedia } from "@/scrapers/types";
import { getJson } from "@/scrapers/http";

interface TikwmResponse {
  code?: number;
  msg?: string;
  data?: {
    title?: string;
    play?: string;
    hdplay?: string;
    images?: string[];
    author?: { unique_id?: string };
  };
}

/** Matches a TikTok post link. */
export const tiktokPattern =
  /https?:\/\/(?:www\.|m\.)?(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)\/\S+/i;

/** tikwm's free tier rejects bursts with "Free Api Limit: 1 request/second", so
 *  calls are spaced one second apart. */
const MIN_INTERVAL_MS = 1000;
let lastCall = 0;

async function throttle(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();
}

/** Resolves a TikTok post URL to downloadable media, or null when unavailable. */
export async function tiktok(url: string): Promise<ScrapedMedia | null> {
  await throttle();

  const endpoint = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
  const json = await getJson<TikwmResponse>(endpoint);
  if (json?.code !== 0 || !json.data) return null;

  const { title, play, hdplay, images, author } = json.data;

  // Photo posts carry `images` and no usable video; videos carry `play`.
  const items: MediaItem[] = (images ?? []).length
    ? (images ?? []).map((image) => ({
        url: image,
        kind: "image" as const,
        mimetype: "image/jpeg",
      }))
    : [
        {
          url: hdplay || play || "",
          kind: "video" as const,
          mimetype: "video/mp4",
        },
      ];

  if (!items[0]?.url) return null;

  const authorTag = author?.unique_id ? `@${author.unique_id}` : "";
  const cleanTitle = title?.trim();
  const caption = [authorTag, cleanTitle].filter(Boolean).join(" — ");

  return {
    items,
    caption:
      caption || (items[0].kind === "image" ? "TikTok photos" : "TikTok video"),
  };
}
