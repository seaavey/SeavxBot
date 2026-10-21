import type { Command } from "@/lib/types";
import { getGroupSettings } from "@/lib/db";
import { settingsDefaults } from "@/lib/config";
import {
  ANTILINK_MODES,
  type AntilinkMode,
  type GroupSettings,
} from "@/lib/settings";

const MAX_TEXT = 500;

const usage = (prefix: string): string =>
  [
    "🚩 Usage:",
    `• ${prefix}settings`,
    `• ${prefix}settings welcome on|off`,
    `• ${prefix}settings welcometext <text>`,
    `• ${prefix}settings goodbye on|off`,
    `• ${prefix}settings goodbyetext <text>`,
    `• ${prefix}settings antilink off|warn|delete`,
    "",
    "Use `default` as the text to restore the bot default.",
  ].join("\n");

const onOff = (value: boolean): string => (value ? "on" : "off");

function panel(settings: GroupSettings, subject: string, prefix: string) {
  return [
    `*Settings — ${subject}*`,
    "",
    `Welcome: ${onOff(settings.welcome)}`,
    `  ${settings.welcome_text}`,
    `Goodbye: ${onOff(settings.goodbye)}`,
    `  ${settings.goodbye_text}`,
    `Antilink: ${settings.antilink}`,
    "",
    "Placeholders: {mention} {name} {group} {count}",
    "",
    "Change with:",
    `• ${prefix}settings welcome on|off`,
    `• ${prefix}settings welcometext <text>`,
    `• ${prefix}settings antilink off|warn|delete`,
  ].join("\n");
}

/** Accepts only on/off, so a typo never silently disables a setting. */
function parseToggle(value: string): boolean | undefined {
  if (value === "on") return true;
  if (value === "off") return false;
  return undefined;
}

export const settingsCommand: Command = {
  name: "settings",
  description: "View or change this group's settings",
  aliases: ["set"],
  groupOnly: true,
  adminOnly: true,
  run: async ({ msg, reply }) => {
    const store = getGroupSettings();
    const subject = msg.groupMetadata?.subject || "this group";
    const [sub = "", ...rest] = msg.args;
    const value = rest.join(" ").trim();

    if (!sub) {
      await reply(panel(store.get(msg.chatJid), subject, msg.prefix));
      return;
    }

    switch (sub) {
      case "welcome":
      case "goodbye": {
        const next = parseToggle(value);
        if (next === undefined) {
          await reply(`🚩 Use: ${msg.prefix}settings ${sub} on|off`);
          return;
        }
        store.set(msg.chatJid, sub, next);
        const label = sub === "welcome" ? "Welcome" : "Goodbye";
        await reply(`✅ ${label} ${onOff(next)}.`);
        return;
      }

      case "welcometext":
      case "goodbyetext": {
        const key = sub === "welcometext" ? "welcome_text" : "goodbye_text";
        const defaults = settingsDefaults;

        if (!value) {
          await reply(`🚩 Use: ${msg.prefix}settings ${sub} <text>|default`);
          return;
        }
        if (value.length > MAX_TEXT) {
          await reply(`🚩 Text is too long (${value.length}/${MAX_TEXT}).`);
          return;
        }

        const text = value === "default" ? defaults[key] : value;
        store.set(msg.chatJid, key, text);
        await reply(`✅ Saved:\n\n${text}`);
        return;
      }

      case "antilink": {
        if (!ANTILINK_MODES.includes(value as AntilinkMode)) {
          await reply(`🚩 Use: ${msg.prefix}settings antilink off|warn|delete`);
          return;
        }
        store.set(msg.chatJid, "antilink", value as AntilinkMode);
        await reply(`✅ Antilink ${value}.`);
        return;
      }

      default:
        await reply(usage(msg.prefix));
    }
  },
};

export default settingsCommand;
