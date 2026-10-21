import type { Command } from "@/lib/types";
import { getUsers } from "@/lib/db";
import { isPhoneJid, labelFor, resolveTargets, userPart } from "@/lib/group";
import { profileBody } from "@/lib/profile";

export const userinfoCommand: Command = {
  name: "userinfo",
  description: "Show a user's role, premium expiry, and activity",
  ownerOnly: true,
  run: async ({ sock, msg, reply }) => {
    const [target] = await resolveTargets(sock, msg, msg.args);
    const jid = target?.jid ?? msg.senderJid;

    const user = getUsers().get(jid);
    if (!user) {
      await reply(`🚩 No user record for ${labelFor(jid)}.`);
      return;
    }

    const phone = isPhoneJid(user.jid);
    const number = userPart(user.jid);
    const header = phone ? `@${number}` : labelFor(user.jid);

    const lines = [
      `*${header}*`,
      user.name ? `Name: ${user.name}` : "",
      ...profileBody(user),
    ];

    await reply({
      text: lines.filter(Boolean).join("\n"),
      ...(phone ? { mentions: [`${number}@s.whatsapp.net`] } : {}),
    });
  },
};

export default userinfoCommand;
