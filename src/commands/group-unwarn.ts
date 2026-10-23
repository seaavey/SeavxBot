import type { Command } from "@/lib/core/types";
import { resolveTargets } from "@/lib/group/ops";
import { getWarnings } from "@/lib/core/db";

export const unwarnCommand: Command = {
  name: "unwarn",
  description: "Clear a member's warnings",
  groupOnly: true,
  adminOnly: true,
  run: async ({ sock, msg, reply }) => {
    const targets = await resolveTargets(sock, msg, msg.args);
    const target = targets[0];
    if (!target) {
      await reply(
        "🚩 Mention someone, reply to their message, or pass a phone number.",
      );
      return;
    }

    const warnings = getWarnings(msg.chatJid);
    warnings.reset(msg.chatJid, target.jid);

    await reply(`✅ Cleared warnings for ${target.label}.`);
  },
};

export default unwarnCommand;
