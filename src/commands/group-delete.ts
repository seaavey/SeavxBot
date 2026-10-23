import type { Command } from "@/lib/core/types";

export const deleteCommand: Command = {
  name: "delete",
  description: "Delete the message you replied to",
  aliases: ["del"],
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply, react }) => {
    const quoted = msg.quoted;
    if (!quoted) {
      await reply("🚩 Reply to the message you want to delete.");
      return;
    }

    // Works on someone else's message only as a group admin with the bot
    // as admin; outside the revoke window WhatsApp simply refuses it.
    try {
      await sock.sendMessage(msg.chatJid, { delete: quoted.key });
    } catch {
      await reply("🚩 Could not delete that message.");
      return;
    }

    await react("✅");
  },
};

export default deleteCommand;
