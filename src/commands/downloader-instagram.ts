import type { Command } from "@/lib/types";
import { mediaMessages } from "@/lib/mediaMessages";
import { instagram, instagramPattern } from "@/scrapers/instagram";

export const instagramCommand: Command = {
  name: "instagram",
  description: "Download an Instagram post or reel",
  aliases: ["ig"],
  run: async ({ msg, reply }) => {
    const link = msg.text.match(instagramPattern)?.[0];
    if (!link) {
      await reply("🚩 Send an Instagram post link.");
      return;
    }

    const media = await instagram(link);
    if (!media) {
      await reply("🚩 Could not fetch that post.");
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

export default instagramCommand;
