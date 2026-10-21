import type { Command } from "@/lib/types";
import { getUsers } from "@/lib/db";
import { resolveTargets } from "@/lib/group";
import { labelFor } from "@/lib/identity";

const DAY = 86_400_000;

export const premiumCommand: Command = {
  name: "premium",
  description: "Grant premium to a user (7d, 30d, or permanent)",
  aliases: ["upgrade"],
  ownerOnly: true,
  run: async ({ sock, msg, reply }) => {
    const duration = msg.args.find((arg) =>
      ["7d", "30d", "permanent"].includes(arg),
    );
    if (!duration) {
      await reply(
        "🚩 Usage: premium 7d|30d|permanent [reply, mention, or number]",
      );
      return;
    }

    const [target] = await resolveTargets(sock, msg, msg.args);
    const jid = target?.jid ?? msg.senderJid;
    const until =
      duration === "permanent"
        ? null
        : Date.now() + Number(duration.slice(0, -1)) * DAY;

    const user = getUsers().grantPremium(jid, until, msg.senderJid);
    const label = labelFor(user.jid);

    await reply(
      until === null
        ? `✅ Premium permanent for ${label}.`
        : `✅ Premium ${duration} for ${label} — until ${new Date(until).toLocaleDateString("en-CA")}.`,
    );
  },
};

export default premiumCommand;
