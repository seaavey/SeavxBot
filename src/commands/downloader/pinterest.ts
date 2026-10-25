import type { Command } from "@/lib/core/types";
import { mediaMessages } from "@/lib/media/mediaMessages";
import { pinterest, pinterestPattern } from "@/scrapers/pinterest";

export const pinterestCommand: Command = {
  name: "pinterest",
  description: "Download a Pinterest pin (image or video)",
  aliases: ["pin"],
  run: async ({ msg, reply }) => {
    const link = msg.text.match(pinterestPattern)?.[0];
    if (!link) {
      await reply("🚩 Send a Pinterest pin link.");
      return;
    }

    const media = await pinterest(link);
    if (!media) {
      await reply("🚩 Could not fetch that pin.");
      return;
    }

    for (const { url, content } of mediaMessages(media)) {
      try {
        await reply(content);
      } catch (err) {
        // The CDN may refuse the fetch, so the failure is named, not generic.
        console.error(`Failed to send ${url}:`, err);
        await reply("🚩 Could not send that file.");
        return;
      }
    }
  },
};

export default pinterestCommand;
