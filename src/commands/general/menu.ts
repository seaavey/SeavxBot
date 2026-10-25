import path from "node:path";
import type { WASocket } from "@whiskeysockets/baileys";
import {
  generateWAMessageFromContent,
  prepareWAMessageMedia,
} from "@whiskeysockets/baileys";
import type { Command } from "@/lib/core/types";
import { commands } from "@/lib/core/commandLoader";
import {
  buildMenuMessage,
  formatUptime,
  greeting,
  jakartaTime,
  MENU_NODES,
  renderMenu,
} from "@/lib/core/menu";
import { botName, prefixes } from "@/lib/core/config";
import { getUsers } from "@/lib/core/db";
import { isPremium } from "@/lib/user/users";

/** The wordmark banner for the menu card header. */
const HEADER_IMAGE = path.resolve(import.meta.dir, "../../assets/headers.png");

/** Uploaded per call; the card header takes an already-uploaded image message. */
async function headerImage(sock: WASocket) {
  const bytes = await Bun.file(HEADER_IMAGE).arrayBuffer();
  const media = await prepareWAMessageMedia(
    { image: Buffer.from(bytes) },
    { upload: sock.waUploadToServer },
  );

  return media.imageMessage ?? undefined;
}

export const menuCommand: Command = {
  name: "menu",
  description: "Display available bot commands",
  aliases: ["help"],
  run: async ({ sock, msg, reply }) => {
    // Dispatch keeps a row per sender, so the profile lookup is a read hit.
    const users = getUsers();
    const user = users.get(msg.senderJid);
    const role = msg.isOwner
      ? "Owner"
      : user && isPremium(user)
        ? "Premium"
        : "Freemium";

    const info = [
      `${greeting()}${msg.pushName ? `, *${msg.pushName}*` : ""}`,
      `*Role:* ${role}`,
      `*Total Your Message:* ${user?.messageCount ?? 0} Messages`,
      `*Total Command:* ${user?.commandCount ?? 0}`,
      `*Total User:* ${users.count()}`,
      `*Uptime:* ${formatUptime(process.uptime())}`,
      `*Time:* ${jakartaTime()} (Asia/Jakarta)`,
    ];

    const list = [...commands.values()];
    const options = {
      title: `${botName} Menu`,
      prefix: msg.prefix || prefixes[0] || "!",
      info,
    };

    try {
      const full = await generateWAMessageFromContent(
        msg.chatJid,
        buildMenuMessage(list, options, await headerImage(sock)),
        { userJid: sock.user!.id, quoted: msg.raw },
      );

      await sock.relayMessage(msg.chatJid, full.message!, {
        messageId: full.key.id!,
        additionalNodes: MENU_NODES,
      });
    } catch (err) {
      // A client that rejects the native flow still gets a working menu.
      console.error("Interactive menu failed, sending text:", err);
      await reply(renderMenu(list, options));
    }
  },
};

export default menuCommand;
