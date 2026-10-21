import type { AnyMessageContent } from "@whiskeysockets/baileys";
import type { MediaItem, ScrapedMedia } from "@/scrapers/types";

/** One file of a post, ready to send. */
export interface MediaMessage {
  /** The CDN URL, so a failed send can name the file. */
  url: string;
  content: AnyMessageContent;
}

/** The media message one scraped file becomes. */
const asMedia = (item: MediaItem): AnyMessageContent =>
  item.kind === "image"
    ? { image: { url: item.url }, mimetype: item.mimetype }
    : { video: { url: item.url }, mimetype: item.mimetype };

/** Every file of a post as one message; the caption rides on the first only. */
export function mediaMessages(media: ScrapedMedia): MediaMessage[] {
  return media.items.map((item, index) => ({
    url: item.url,
    content:
      index === 0
        ? { ...asMedia(item), caption: media.caption }
        : asMedia(item),
  }));
}
