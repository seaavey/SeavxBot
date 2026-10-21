import { getStickerPack } from "@/lib/core/db";
import type { Command } from "@/lib/core/types";
import { toSticker } from "@/lib/media/ffmpeg";
import { findImageSource } from "@/lib/media/imageSource";
import {
  downloadMedia,
  findMediaSource,
  MAX_MEDIA_BYTES,
} from "@/lib/media/mediaSource";
import { injectStickerExif } from "@/lib/media/stickerPack";
import { isAnimatedWebp } from "@/lib/media/webp";

export const toStickerCommand: Command = {
  name: "tosticker",
  description: "Make a sticker from an image, video, or sticker",
  aliases: ["sticker", "s", "stiker", "stik"],
  run: async ({ msg, reply, react }) => {
    const fail = async (text: string) => {
      await react("❌");
      await reply(text);
    };

    const video = findMediaSource(msg, ["video"]);
    const sticker = video ? null : findMediaSource(msg, ["sticker"]);
    const source = video ?? sticker;
    const image = video || sticker ? null : findImageSource(msg);
    const message =
      source?.message ?? (image?.kind === "media" ? image.message : null);

    if (!message) {
      await fail("🚩 Reply to an image, video, or sticker.");
      return;
    }
    if (source?.fileLength && source.fileLength > MAX_MEDIA_BYTES) {
      await fail("🚩 Media is too large (max 15MB).");
      return;
    }

    await react("⏳");
    try {
      const buffer = await downloadMedia(message);
      if (buffer.length > MAX_MEDIA_BYTES) {
        await fail("🚩 Media is too large (max 15MB).");
        return;
      }

      const animated =
        video !== null || (sticker !== null && isAnimatedWebp(buffer));
      const inputExt = video ? "mp4" : sticker ? "webp" : "jpg";
      const output = await toSticker(buffer, { animated, inputExt });
      const withExif = injectStickerExif(output, getStickerPack().get());
      await reply({ sticker: withExif });
      await react("✅");
    } catch {
      await fail("🚩 Failed to convert to sticker.");
    }
  },
};

export default toStickerCommand;
