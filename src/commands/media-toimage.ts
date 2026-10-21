import { findMediaSource, downloadMedia } from "@/lib/mediaSource";
import { toImage } from "@/lib/ffmpeg";
import type { Command } from "@/lib/types";

const MAX_BYTES = 15 * 1024 * 1024;

export const toImageCommand: Command = {
  name: "toimage",
  description: "Convert sticker to image",
  aliases: ["toimg"],
  run: async ({ msg, reply, react }) => {
    const fail = async (text: string) => {
      await react("❌");
      await reply(text);
    };

    const source = findMediaSource(msg, ["sticker"]);
    if (!source) {
      await fail("🚩 Reply to a sticker.");
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

      const imgBuffer = await toImage(buffer);
      await reply({
        image: imgBuffer,
        mimetype: "image/png",
      });
      await react("✅");
    } catch {
      await fail("🚩 Failed to convert to image.");
    }
  },
};

export default toImageCommand;
