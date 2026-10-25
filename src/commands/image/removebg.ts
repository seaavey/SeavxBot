import type { Command } from "@/lib/core/types";
import { findImageSource, toDataUrl } from "@/lib/media/imageSource";
import { removeBackground } from "@/scrapers/iloveimg";

export const removeBackgroundCommand: Command = {
  name: "removebg",
  description:
    "Remove an image background (reply to it, caption it, or send a URL)",
  aliases: ["rmbg", "nobg"],
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

      const result = await removeBackground(url);
      if (!result) return fail("🚩 Background removal failed, try again.");

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

export default removeBackgroundCommand;
