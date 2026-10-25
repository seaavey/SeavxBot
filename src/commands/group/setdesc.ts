import type { Command } from "@/lib/core/types";
import { runSettingOp } from "@/lib/group/ops";

export const setDescCommand: Command = {
  name: "setdesc",
  description: "Change the group description",
  aliases: ["setdescription"],
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply }) => {
    const description = msg.text.trim();
    if (!description) {
      await reply(`🚩 Usage: ${msg.prefix}setdesc <new description>`);
      return;
    }

    if (msg.groupMetadata?.desc === description) {
      await reply("🚩 The group description is already set to that text.");
      return;
    }

    const text = await runSettingOp(
      msg.chatJid,
      () => sock.groupUpdateDescription(msg.chatJid, description),
      () => "✅ Group description updated.",
      (meta) => ({ ...meta, desc: description }),
    );

    await reply(text);
  },
};

export default setDescCommand;
