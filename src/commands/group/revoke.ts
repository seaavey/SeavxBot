import type { Command } from "@/lib/core/types";
import { runGroupOp } from "@/lib/group/ops";

export const revokeCommand: Command = {
  name: "revoke",
  description: "Reset the group invite link",
  aliases: ["resetlink"],
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply }) => {
    const text = await runGroupOp(
      () => sock.groupRevokeInvite(msg.chatJid),
      (code) =>
        code
          ? `✅ Invite link reset.\nhttps://chat.whatsapp.com/${code}`
          : "🚩 No invite link returned.",
    );

    await reply(text);
  },
};

export default revokeCommand;
