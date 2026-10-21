import type { Command } from "@/lib/core/types";
import { runGroupOp } from "@/lib/group/ops";

export const linkCommand: Command = {
  name: "link",
  description: "Get the group invite link",
  aliases: ["invite"],
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply }) => {
    const text = await runGroupOp(
      () => sock.groupInviteCode(msg.chatJid),
      (code) =>
        code
          ? `https://chat.whatsapp.com/${code}`
          : "🚩 No invite link returned.",
    );

    await reply(text);
  },
};

export default linkCommand;
