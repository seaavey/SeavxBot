import type { Command } from "@/lib/core/types";
import { resolveTargets } from "@/lib/group/ops";
import { getGroupSettings, getWarnings } from "@/lib/core/db";

export const warnCommand: Command = {
  name: "warn",
  description: "Warn a member; kick at the group warn limit",
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

    const settings = getGroupSettings(msg.chatJid).get(msg.chatJid);
    const warnings = getWarnings(msg.chatJid);
    const count = warnings.increment(msg.chatJid, target.jid);

    if (count < settings.warn_limit) {
      await reply(
        `⚠️ Warned ${target.label} (${count}/${settings.warn_limit}).`,
      );
      return;
    }

    // At the limit: kick and reset. The kick is a group mutation, so a
    // failure (bot is not admin, member already left) is reported but the
    // count is intentionally left intact (spec D4).
    try {
      await sock.groupParticipantsUpdate(msg.chatJid, [target.jid], "remove");
      warnings.reset(msg.chatJid, target.jid);
      await reply(
        `🚩 ${target.label} kicked — warn limit (${settings.warn_limit}) reached.`,
      );
    } catch (err) {
      await reply(
        `⚠️ Warned ${target.label} (${count}/${settings.warn_limit}). Kick failed: ${String(err)}.`,
      );
    }
  },
};

export default warnCommand;
