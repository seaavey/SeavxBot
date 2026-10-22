import type { Command } from "@/lib/core/types";
import { commands } from "@/lib/core/commandLoader";
import { botName, prefixes } from "@/lib/core/config";

/** Section order; an unlisted category keeps insertion order at the end. */
const CATEGORY_ORDER = [
  "general",
  "games",
  "group",
  "media",
  "image",
  "downloader",
  "owner",
];

const rank = (category: string): number => {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
};

const lineFor = (cmd: Command, prefix: string): string => {
  const alias = cmd.aliases?.length ? ` _(${cmd.aliases.join(", ")})_` : "";
  return `│ ▸ *${prefix}${cmd.name}*${alias}`;
};

/** Plain text, so the whole menu renders without touching the socket. */
function renderMenu(list: Command[], prefix: string, title: string): string {
  const groups = new Map<string, Command[]>();

  for (const cmd of list) {
    const key = cmd.category ?? "general";
    const bucket = groups.get(key);
    if (bucket) bucket.push(cmd);
    else groups.set(key, [cmd]);
  }

  const sections = [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([category, group]) => {
      const lines = group
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((cmd) => lineFor(cmd, prefix));

      return [
        `┌─「 *${category.toUpperCase()}* 」`,
        ...lines,
        "└────────────────────",
      ].join("\n");
    });

  const header = [
    `╭─「 *${title}* 」`,
    `│ Prefixes: ${prefixes.join(" ")}`,
    `│ Commands: ${list.length}`,
    "╰────────────────────",
  ].join("\n");

  return [header, ...sections].join("\n\n");
}

export const menuCommand: Command = {
  name: "menu",
  description: "Display available bot commands",
  aliases: ["help"],
  run: async ({ reply, msg }) => {
    const prefix = msg.prefix || prefixes[0] || "!";
    await reply(renderMenu([...commands.values()], prefix, `${botName} Menu`));
  },
};

export default menuCommand;
