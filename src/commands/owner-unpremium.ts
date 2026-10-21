import type { Command } from "@/lib/core/types";
import { getUsers } from "@/lib/core/db";
import { resolveTargets } from "@/lib/group/ops";
import { labelFor } from "@/lib/message/identity";

export const unpremiumCommand: Command = {
  name: "unpremium",
  description: "Revoke premium from a user",
  aliases: ["downgrade"],
  ownerOnly: true,
  run: async ({ sock, msg, reply }) => {
    const [target] = await resolveTargets(sock, msg, msg.args);
    const jid = target?.jid ?? msg.senderJid;

    const user = getUsers().revokePremium(jid);
    await reply(
      user
        ? `✅ ${labelFor(user.jid)} is back to free.`
        : `🚩 No user record for ${labelFor(jid)}.`,
    );
  },
};

export default unpremiumCommand;
