import type { Command } from "@/lib/core/types";
import { getStickerPack } from "@/lib/core/db";

const usage = (prefix: string): string => {
  const { pack, author } = getStickerPack().get();
  return [
    "*Sticker pack EXIF*",
    `Pack: ${pack}`,
    `Author: ${author}`,
    "",
    `• ${prefix}setexif pack <text>`,
    `• ${prefix}setexif author <text>`,
  ].join("\n");
};

export const setexifCommand: Command = {
  name: "setexif",
  description: "Show or change the sticker pack name and author",
  ownerOnly: true,
  run: async ({ msg, reply }) => {
    const [sub = ""] = msg.args;
    if (!sub) {
      await reply(usage(msg.prefix));
      return;
    }

    if (sub !== "pack" && sub !== "author") {
      await reply(usage(msg.prefix));
      return;
    }

    const value = msg.args.slice(1).join(" ").trim();
    if (!value) {
      await reply(`🚩 Use: ${msg.prefix}setexif ${sub} <text>`);
      return;
    }
    if (value.length > 64) {
      await reply(`🚩 Too long (${value.length}/64).`);
      return;
    }

    getStickerPack().set(sub, value);
    await reply(`✅ ${sub === "pack" ? "Pack" : "Author"} saved: ${value}`);
  },
};

export default setexifCommand;
