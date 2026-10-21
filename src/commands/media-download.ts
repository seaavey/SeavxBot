import type { AnyMessageContent } from "@whiskeysockets/baileys";
import type { Command } from "@/lib/types";
import { findScraper, scrape } from "@/scrapers";
import type { MediaItem } from "@/scrapers/types";

/** The media message one scraped file becomes. */
const asMedia = (item: MediaItem): AnyMessageContent =>
  item.kind === "image"
    ? { image: { url: item.url }, mimetype: item.mimetype }
    : { video: { url: item.url }, mimetype: item.mimetype };

export const downloadCommand: Command = {
  name: "download",
  description: "Download a post from a supported platform",
  aliases: ["dl"],
  run: async ({ msg, reply }) => {
    const found = findScraper(msg.text);
    if (!found) {
      await reply("🚩 Send a TikTok or Instagram post link.");
      return;
    }

    const media = await scrape(found.url);
    if (!media) {
      await reply("🚩 Could not fetch that post.");
      return;
    }

    for (const [index, item] of media.items.entries()) {
      try {
        // The caption rides on the first file only — an album cannot share one.
        await reply(
          index === 0
            ? { ...asMedia(item), caption: media.caption }
            : asMedia(item),
        );
      } catch (err) {
        // The CDN may refuse the fetch, so the failure is named, not generic.
        console.error(`Failed to send ${item.url}:`, err);
        await reply("🚩 Could not send that file.");
        return;
      }
    }
  },
};

export default downloadCommand;
