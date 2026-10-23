import type { Command } from "@/lib/core/types";
import { mentionables } from "@/lib/group/participants";

export const hidetagCommand: Command = {
  name: "hidetag",
  description: "Mention every group member without listing them",
  groupOnly: true,
  adminOnly: true,
  run: async ({ sock, msg, reply }) => {
    const meta = msg.groupMetadata;
    if (!meta) {
      await reply("🚩 Group metadata is unavailable right now.");
      return;
    }

    const mentions = mentionables(sock, meta.participants).map(
      (participant) => participant.id,
    );

    await reply({ text: msg.text.trim() || "Attention:", mentions });
  },
};

export default hidetagCommand;
