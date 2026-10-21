import type { WASocket } from "@whiskeysockets/baileys";
import type { ParsedMessage } from "@/lib/message/parseMessage";
import type { SettingsStore } from "@/lib/group/settings";

// Group invites and share links: chat.whatsapp.com/<code>, wa.me/<number>,
// api.whatsapp.com/send?phone=<number>, wa.me/settings/<name>.
const WHATSAPP_GROUP_LINK =
  /(?:https?:\/\/)?(?:chat\.whatsapp\.com\/(?:invite\/)?[\w-]+|wa\.me\/\d{6,}|api\.whatsapp\.com\/send\?\S*phone=\d+|wa\.me\/settings\/[\w-]+)/i;

export function containsGroupLink(text: string): boolean {
  return WHATSAPP_GROUP_LINK.test(text);
}

/**
 * Handles antilink enforcement for non-admin members.
 * Returns true if the message was handled and further dispatch should abort.
 */
export async function handleAntilink(
  sock: WASocket,
  msg: ParsedMessage,
  store: SettingsStore,
): Promise<boolean> {
  if (!msg.isGroup || msg.isAdmin || msg.isOwner) return false;

  const mode = store.get(msg.chatJid).antilink;
  if (mode === "off") return false;

  if (!containsGroupLink(msg.body)) return false;

  if (mode === "delete") {
    if (msg.isBotAdmin) {
      await sock.sendMessage(msg.chatJid, { delete: msg.key }).catch(() => {});
    }
    await sock
      .sendMessage(msg.chatJid, {
        text: "🚩 Link detected. Links are not allowed in this group.",
      })
      .catch(() => {});
    return true;
  }

  if (mode === "warn") {
    await sock
      .sendMessage(
        msg.chatJid,
        {
          text: "🚩 Warning: Do not share group links here.",
        },
        { quoted: msg.raw },
      )
      .catch(() => {});
    return false;
  }

  return false;
}
