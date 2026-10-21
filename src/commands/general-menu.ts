import type { Command } from "@/lib/core/types";
import { commands } from "@/lib/core/commandLoader";
import { botName, prefixes } from "@/lib/core/config";

export const menuCommand: Command = {
  name: "menu",
  description: "Display available bot commands",
  aliases: ["help"],
  run: async ({ reply, msg }) => {
    const prefix = msg.prefix || prefixes[0] || "!";
    const list = Array.from(commands.values())
      .map(
        (c) =>
          `• ${prefix}${c.name}${c.description ? ` - ${c.description}` : ""}`,
      )
      .join("\n");

    const text = `*${botName} Menu*\n\nPrefixes: ${prefixes.join(" ")}\n\n${list}`;
    await reply(text);
  },
};

export default menuCommand;
