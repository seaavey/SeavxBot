import type { Command } from "@/lib/core/types";
import { describeError } from "@/lib/group/ops";

export const leaveCommand: Command = {
  name: "leave",
  description: "Make the bot leave this group",
  aliases: ["out"],
  groupOnly: true,
  adminOnly: true,
  run: async ({ sock, msg, reply }) => {
    try {
      await sock.groupLeave(msg.chatJid);
    } catch (err) {
      await reply(describeError(err));
    }
  },
};

export default leaveCommand;
