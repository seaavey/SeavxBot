import type { Command } from "@/lib/types";
import { getUsers } from "@/lib/db";
import { isPremium } from "@/lib/users";
import { isPhoneJid, labelFor, userPart } from "@/lib/group";

const LIMIT = 20;

const stamp = (ms: number): string => {
  const date = new Date(ms);
  return `${date.toLocaleDateString("en-CA")} ${date.toLocaleTimeString("en-GB", { hour12: false })}`;
};

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
      const premium = isPremium(user);
      const role = premium
        ? `premium (${user.premiumUntil === null ? "permanent" : stamp(user.premiumUntil)})`
        : "free";

      const phone = isPhoneJid(user.jid);
      const number = userPart(user.jid);
      if (phone) mentions.push(`${number}@s.whatsapp.net`);

      const label = phone ? `@${number}` : labelFor(user.jid);
      return `${premium ? "⭐" : "•"} ${label} — ${role} · ${user.messageCount} msgs · ${stamp(user.lastSeenAt)}`;
    });

    await reply({
      text: [`*Users* (${store.count()} total, newest first)`, ...lines].join(
        "\n",
      ),
      ...(mentions.length > 0 ? { mentions } : {}),
    });
  },
};

export default listUserCommand;
