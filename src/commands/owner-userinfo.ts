import type { Command } from "@/lib/types";
import { getUsers } from "@/lib/db";
import { isPremium } from "@/lib/users";
import { isPhoneJid, labelFor, resolveTargets, userPart } from "@/lib/group";

const stamp = (ms: number): string => {
  const date = new Date(ms);
  return `${date.toLocaleDateString("en-CA")} ${date.toLocaleTimeString("en-GB", { hour12: false })}`;
};

export const userinfoCommand: Command = {
  name: "userinfo",
  description: "Show a user's role, premium expiry, and activity",
  aliases: ["profile"],
  ownerOnly: true,
  run: async ({ sock, msg, reply }) => {
    const [target] = await resolveTargets(sock, msg, msg.args);
    const jid = target?.jid ?? msg.senderJid;

    const user = getUsers().get(jid);
    if (!user) {
      await reply(`🚩 No user record for ${labelFor(jid)}.`);
      return;
    }

    const role = isPremium(user)
      ? `premium (${user.premiumUntil === null ? "permanent" : stamp(user.premiumUntil)})`
      : "free";

    const phone = isPhoneJid(user.jid);
    const number = userPart(user.jid);
    const header = phone ? `@${number}` : labelFor(user.jid);

    const lines = [
      `*${header}*`,
      user.name ? `Name: ${user.name}` : "",
      `Role: ${role}`,
      `Messages: ${user.messageCount}`,
      `Commands: ${user.commandCount}`,
      `First seen: ${stamp(user.firstSeenAt)}`,
      `Last seen: ${stamp(user.lastSeenAt)}`,
    ];

    await reply({
      text: lines.filter(Boolean).join("\n"),
      ...(phone ? { mentions: [`${number}@s.whatsapp.net`] } : {}),
    });
  },
};

export default userinfoCommand;
