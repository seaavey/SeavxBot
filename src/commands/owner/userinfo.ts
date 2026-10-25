import type { Command } from "@/lib/core/types";
import { getUsers } from "@/lib/core/db";
import { resolveTargets } from "@/lib/group/ops";
import {
  isPhoneJid,
  labelFor,
  sameUser,
  userPart,
} from "@/lib/message/identity";
import { profileBody } from "@/lib/user/profile";

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

    // The device comes from the current message, so it only describes the
    // sender — showing it for another user would be a lie.
    const device = sameUser(user.jid, msg.senderJid) ? msg.device : undefined;

    const lines = [
      `*${header}*`,
      user.name ? `Name: ${user.name}` : "",
      ...profileBody(user, device),
    ];

    await reply({
      text: lines.filter(Boolean).join("\n"),
      ...(phone ? { mentions: [`${number}@s.whatsapp.net`] } : {}),
    });
  },
};

export default userinfoCommand;
