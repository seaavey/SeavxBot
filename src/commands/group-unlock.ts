import type { Command } from "@/lib/core/types";
import { runSettingOp } from "@/lib/group/ops";

export const unlockCommand: Command = {
  name: "unlock",
  description: "Allow all members to edit group info",
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply }) => {
    if (msg.groupMetadata?.restrict === false) {
      await reply("🚩 Group info is already unlocked — everyone can edit it.");
      return;
    }

    const text = await runSettingOp(
      msg.chatJid,
      () => sock.groupSettingUpdate(msg.chatJid, "unlocked"),
      () => "✅ Group info unlocked — everyone can edit it.",
      (meta) => ({ ...meta, restrict: false }),
    );

    await reply(text);
  },
};

export default unlockCommand;
