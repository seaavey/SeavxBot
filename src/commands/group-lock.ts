import type { Command } from "@/lib/types";
import { runSettingOp } from "@/lib/group";

export const lockCommand: Command = {
  name: "lock",
  description: "Restrict group info edits to admins only",
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply }) => {
    if (msg.groupMetadata?.restrict === true) {
      await reply(
        "🚩 Group info is already locked — only admins can edit it.",
      );
      return;
    }

    const text = await runSettingOp(
      msg.chatJid,
      () => sock.groupSettingUpdate(msg.chatJid, "locked"),
      () => "✅ Group info locked — admins only.",
      (meta) => ({ ...meta, restrict: true }),
    );

    await reply(text);
  },
};

export default lockCommand;
