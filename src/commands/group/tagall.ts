import type { Command } from "@/lib/core/types";
import { mentionables } from "@/lib/group/participants";
import { userPart } from "@/lib/message/identity";

export const tagAllCommand: Command = {
  name: "tagall",
  description: "Mention every group member",
  aliases: ["everyone"],
  groupOnly: true,
  adminOnly: true,
  run: async ({ sock, msg, reply }) => {
    const meta = msg.groupMetadata;
    if (!meta) {
      await reply("🚩 Group metadata is unavailable right now.");
      return;
    }

    // The bot is a participant too; mentioning yourself pings your own
    // account. `mentionedJid` keeps the group's addressing form (a LID in a
    // LID group), and the text token is built from that same JID so the tag
    // resolves — the same pairing `greeting.ts` uses.
    const members = mentionables(sock, meta.participants);

    const mentions = members.map((participant) => participant.id);
    const list = members
      .map((participant, index) => `${index + 1}. @${userPart(participant.id)}`)
      .join("\n");

    const header = msg.text.trim() || "Attention:";
    await reply({ text: `${header}\n\n${list}`, mentions });
  },
};

export default tagAllCommand;
