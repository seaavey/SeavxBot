import { findMediaSource, downloadMedia } from "@/lib/mediaSource";
import { toMp3 } from "@/lib/ffmpeg";
import type { Command } from "@/lib/types";

const MAX_BYTES = 15 * 1024 * 1024;

export const toMp3Command: Command = {
  name: "tomp3",
  description: "Convert video or audio/voice note to MP3",
  aliases: ["toaudio"],
  run: async ({ msg, reply, react }) => {
    const fail = async (text: string) => {
      await react("❌");
      await reply(text);
    };

    const source = findMediaSource(msg, ["video", "audio"]);
    if (!source) {
      await fail("🚩 Reply to a video or audio.");
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

      const ext = source.mimetype?.split("/")[1]?.split(";")[0] ?? "bin";
      const mp3Buffer = await toMp3(buffer, ext);
      await reply({ audio: mp3Buffer, mimetype: "audio/mpeg", ptt: false });
      await react("✅");
    } catch {
      await fail("🚩 Failed to convert to MP3.");
    }
  },
};

export default toMp3Command;
