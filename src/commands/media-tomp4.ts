import { findMediaSource, downloadMedia } from "@/lib/mediaSource";
import { webpToMp4 } from "@/lib/ffmpeg";
import { isAnimatedWebp } from "@/lib/webp";
import type { Command } from "@/lib/types";

const MAX_BYTES = 15 * 1024 * 1024;

export const toMp4Command: Command = {
  name: "tomp4",
  description: "Convert animated sticker to MP4 video",
  aliases: ["tovideo"],
  run: async ({ msg, reply, react }) => {
    const fail = async (text: string) => {
      await react("❌");
      await reply(text);
    };

    const source = findMediaSource(msg, ["sticker", "video"]);
    if (!source) {
      await fail("🚩 Reply to an animated sticker or video.");
      return;
    }
    if (source.fileLength && source.fileLength > MAX_BYTES) {
      await fail("🚩 Media is too large (max 15MB).");
      return;
    }

    await react("⏳");
    try {
      const buffer = await downloadMedia(source.message);
      if (buffer.length > MAX_BYTES) {
        await fail("🚩 Media is too large (max 15MB).");
        return;
      }
      // WhatsApp often omits stickerMessage.isAnimated, so trust the WebP flag.
      if (source.kind === "sticker" && !isAnimatedWebp(buffer)) {
        await fail("🚩 Only animated stickers can be converted to MP4.");
        return;
      }
      const mp4Buffer = await webpToMp4(buffer);
      await reply({
        video: mp4Buffer,
        mimetype: "video/mp4",
        gifPlayback: true,
      });
      await react("✅");
    } catch {
      await fail("🚩 Failed to convert to MP4.");
    }
  },
};

export default toMp4Command;
