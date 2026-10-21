import type { Command } from "@/lib/core/types";
import { mediaMessages } from "@/lib/media/mediaMessages";
import { tiktok, tiktokPattern } from "@/scrapers/tiktok";

export const tiktokCommand: Command = {
  name: "tiktok",
  description: "Download a TikTok post (video or photos)",
  aliases: ["tt"],
  run: async ({ msg, reply }) => {
    const link = msg.text.match(tiktokPattern)?.[0];
    if (!link) {
      await reply("🚩 Send a TikTok post link.");
      return;
    }

    const media = await tiktok(link);
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

export default tiktokCommand;
