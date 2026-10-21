import type { Command } from "@/lib/types";
import { findImageSource, toDataUrl } from "@/lib/imageSource";
import { upscale } from "@/scrapers/upscale";

export const upscaleCommand: Command = {
  name: "upscale",
  description: "Upscale an image 2x (reply to it, caption it, or send a URL)",
  aliases: ["hd", "remini"],
  run: async ({ msg, reply, react }) => {
    const fail = async (text: string) => {
      await react("❌");
      await reply(text);
    };

    const source = findImageSource(msg);
    if (!source) return fail("🚩 Reply to an image or send its URL.");

    await react("⏳");
    try {
      const url =
        source.kind === "url"
          ? source.url
          : await toDataUrl(source.message, source.mimetype);

      const result = await upscale(url);
      if (!result) return fail("🚩 Upscale failed, try again.");

      await reply({
        image: Buffer.from(await result.arrayBuffer()),
        mimetype: result.type,
      });
      await react("✅");
    } catch {
      await fail("🚩 Could not read the image.");
    }
  },
};

export default upscaleCommand;
