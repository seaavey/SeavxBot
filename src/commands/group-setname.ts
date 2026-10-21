import type { Command } from "@/lib/core/types";
import { runSettingOp } from "@/lib/group/ops";

export const setNameCommand: Command = {
  name: "setname",
  description: "Change the group name",
  aliases: ["setsubject"],
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply }) => {
    const name = msg.text.trim();
    if (!name) {
      await reply(`🚩 Usage: ${msg.prefix}setname <new name>`);
      return;
    }

    if (msg.groupMetadata?.subject === name) {
      await reply(`🚩 The group name is already *${name}*.`);
      return;
    }

    const text = await runSettingOp(
      msg.chatJid,
      () => sock.groupUpdateSubject(msg.chatJid, name),
      () => `✅ Group name changed to *${name}*.`,
      (meta) => ({ ...meta, subject: name }),
    );

    await reply(text);
  },
};

export default setNameCommand;
