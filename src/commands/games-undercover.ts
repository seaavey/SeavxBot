import type { Command } from "@/lib/core/types";
import { undercover } from "@/lib/games/undercover";

/** Thin router: the engine owns every game rule and every game message. */
export const undercoverCommand: Command = {
  name: "undercover",
  description: "Play Undercover in this group",
  aliases: ["uc"],
  run: async ({ sock, msg, reply }) => {
    const text = await undercover.handle({
      sock,
      chatJid: msg.chatJid,
      isGroup: msg.isGroup,
      senderJid: msg.senderJid,
      senderPn: msg.senderPn,
      senderLid: msg.senderLid,
      name: msg.pushName,
      prefix: msg.prefix,
      isAdmin: msg.isAdmin,
      isOwner: msg.isOwner,
      args: msg.args,
    });

    if (text) await reply(text);
  },
};

export default undercoverCommand;
