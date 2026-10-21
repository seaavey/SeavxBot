import type { Command } from "@/lib/core/types";
import { runSettingOp } from "@/lib/group/ops";

export const closeCommand: Command = {
  name: "close",
  description: "Restrict messages to admins only",
  aliases: ["mute"],
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply }) => {
    // Metadata comes from the 30s cache, kept in sync by `runSettingOp`, so a
    // repeat call inside that window is still caught.
    if (msg.groupMetadata?.announce === true) {
      await reply(
        "🚩 This group is already closed — only admins can send messages.",
      );
      return;
    }

    const text = await runSettingOp(
      msg.chatJid,
      () => sock.groupSettingUpdate(msg.chatJid, "announcement"),
      () => "✅ Group closed — admins only.",
      (meta) => ({ ...meta, announce: true }),
    );

    await reply(text);
  },
};

export default closeCommand;
