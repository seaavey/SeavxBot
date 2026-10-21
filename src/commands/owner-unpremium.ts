import type { Command } from "@/lib/types";
import { getUsers } from "@/lib/db";
import { resolveTargets } from "@/lib/group";
import { labelFor } from "@/lib/identity";

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
