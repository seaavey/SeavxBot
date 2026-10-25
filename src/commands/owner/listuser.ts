import type { Command } from "@/lib/core/types";
import { getUsers } from "@/lib/core/db";
import { isPhoneJid, labelFor, userPart } from "@/lib/message/identity";
import { isPremium } from "@/lib/user/users";
import { roleLabel, stamp } from "@/lib/user/profile";

const LIMIT = 20;

export const listUserCommand: Command = {
  name: "listuser",
  description: "List users by recent activity",
  aliases: ["users", "userlist"],
  ownerOnly: true,
  run: async ({ reply }) => {
    const store = getUsers();
    const users = store.list(LIMIT);

    if (users.length === 0) {
      await reply("🚩 No users recorded yet.");
      return;
    }

    const mentions: string[] = [];
    const lines = users.map((user) => {
      const phone = isPhoneJid(user.jid);
      const number = userPart(user.jid);
      if (phone) mentions.push(`${number}@s.whatsapp.net`);

      const label = phone ? `@${number}` : labelFor(user.jid);
      const star = isPremium(user) ? "⭐" : "•";
      return `${star} ${label} — ${roleLabel(user)} · ${user.messageCount} msgs · ${stamp(user.lastSeenAt)}`;
    });

    await reply({
      text: [
        `*Users* (${store.count()} total, most recently active first)`,
        ...lines,
      ].join("\n"),
      ...(mentions.length > 0 ? { mentions } : {}),
    });
  },
};

export default listUserCommand;
