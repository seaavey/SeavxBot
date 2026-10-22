import type { Command } from "@/lib/core/types";
import { werewolf } from "@/lib/games/werewolf";

/** Thin router: the engine owns every game rule and every game message. */
export const werewolfCommand: Command = {
  name: "werewolf",
  description: "Play Werewolf in this group",
  aliases: ["ww"],
  run: async ({ msg, reply }) => {
    const text = await werewolf.handle({
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

export default werewolfCommand;
