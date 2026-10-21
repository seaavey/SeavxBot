import type { Command } from "@/lib/core/types";
import { getUsers } from "@/lib/core/db";
import { labelFor } from "@/lib/message/identity";
import { profileBody } from "@/lib/user/profile";

export const profileCommand: Command = {
  name: "profile",
  description: "Show your own role, premium expiry, and activity",
  run: async ({ msg, reply }) => {
    const user = getUsers().get(msg.senderJid);
    if (!user) {
      await reply("🚩 No profile record for you yet.");
      return;
    }

    // No mention: a self-profile must not ping the sender.
    const header = user.name || labelFor(user.jid);
    await reply({
      text: [`*${header}*`, ...profileBody(user, msg.device)].join("\n"),
    });
  },
};

export default profileCommand;
