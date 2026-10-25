import type { Command } from "@/lib/core/types";
import { getUserGroups, getUsers } from "@/lib/core/db";
import { describeError } from "@/lib/group/ops";
import { isBot } from "@/lib/message/identity";
import { isPremium } from "@/lib/user/users";

export const joinCommand: Command = {
  name: "join",
  description: "Join a group via an invite link (owner or premium)",
  premiumOnly: true,
  run: async ({ sock, msg, reply }) => {
    const raw = msg.args[0];
    if (!raw) {
      await reply(
        "🚩 Send an invite link: .join https://chat.whatsapp.com/xxxxx",
      );
      return;
    }

    const code = raw.replace(/^https?:\/\/chat\.whatsapp\.com\//, "").trim();

    let meta;
    try {
      meta = await sock.groupGetInviteInfo(code);
    } catch {
      await reply("🚩 Invalid or expired invite link.");
      return;
    }

    const already = meta.participants.some((participant) =>
      isBot(sock, participant.id, participant.lid, participant.phoneNumber),
    );
    if (already) {
      await reply("🚩 I'm already in that group.");
      return;
    }

    // denyReason already rejects non-owner non-premium, so here the sender
    // is either the owner (unlimited) or premium (capped at 3).
    if (!msg.isOwner) {
      const groups = getUserGroups();
      if (groups.count(msg.senderJid) >= 3) {
        await reply(
          "🚩 Premium limit reached: you can have the bot in 3 groups max.",
        );
        return;
      }
    }

    try {
      await sock.groupAcceptInvite(code);
      if (!msg.isOwner) {
        getUserGroups().add(msg.senderJid, meta.id);
      }
      await reply("✅ Joined the group.");
    } catch (err) {
      await reply(`🚩 Failed to join: ${describeError(err)}`);
    }
  },
};

export default joinCommand;
