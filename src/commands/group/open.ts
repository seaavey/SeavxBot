import type { Command } from "@/lib/core/types";
import { runSettingOp } from "@/lib/group/ops";

export const openCommand: Command = {
  name: "open",
  description: "Let every member send messages",
  aliases: ["unmute"],
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply }) => {
    // Metadata comes from the 30s cache, kept in sync by `runSettingOp`, so a
    // repeat call inside that window is still caught.
    if (msg.groupMetadata?.announce === false) {
      await reply(
        "🚩 This group is already open — everyone can send messages.",
      );
      return;
    }

    const text = await runSettingOp(
      msg.chatJid,
      () => sock.groupSettingUpdate(msg.chatJid, "not_announcement"),
      () => "✅ Group opened — everyone can send messages.",
      (meta) => ({ ...meta, announce: false }),
    );

    await reply(text);
  },
};

export default openCommand;
