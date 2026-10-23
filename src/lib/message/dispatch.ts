import type {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  WAMessage,
  WASocket,
} from "@whiskeysockets/baileys";
import { parseMessage, type ParsedMessage } from "@/lib/message/parseMessage";
import { logToFile } from "@/lib/core/logger";
import {
  guardMessages,
  ownerNumbers,
  prefixes,
  readMessages,
} from "@/lib/core/config";
import { getCommand } from "@/lib/core/commandLoader";
import { getGroupSettings, getUsers } from "@/lib/core/db";
import { handleAntilink } from "@/lib/group/antilink";
import { afkNotice, clearAfk } from "@/lib/group/afk";
import { mentionPhones } from "@/lib/message/mentions";
import type { Command } from "@/lib/core/types";

/**
 * Replies to the message that triggered the command. Phone numbers in a text
 * reply become real @tags; the sender is not tagged automatically, only
 * numbers the reply actually names.
 */
function createReply(sock: WASocket, msg: ParsedMessage) {
  return async (
    content: string | AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ) => {
    const res = await sock.sendMessage(
      msg.chatJid,
      typeof content === "string" ? mentionPhones(content) : content,
      { quoted: msg.raw, ...options },
    );
    logToFile("SENT_REPLY", { id: res?.key?.id, chatJid: msg.chatJid });
    return res;
  };
}

/** Reactions are cosmetic: a deleted message or refused reaction must not fail
 *  the command that sent it. */
function createReact(sock: WASocket, msg: ParsedMessage) {
  return (text: string) =>
    sock
      .sendMessage(msg.chatJid, { react: { text, key: msg.key } })
      .catch(() => {});
}

/** First unmet guard for `cmd`, or undefined when the sender may run it. */
function denyReason(cmd: Command, msg: ParsedMessage): string | undefined {
  if (cmd.ownerOnly && !msg.isOwner) return guardMessages.ownerOnly;
  if (cmd.groupOnly && !msg.isGroup) return guardMessages.groupOnly;
  if (cmd.adminOnly && !msg.isAdmin && !msg.isOwner) {
    return guardMessages.adminOnly;
  }
  if (cmd.botAdminOnly && !msg.isBotAdmin) return guardMessages.botAdminOnly;

  return undefined;
}

/** One console line per message: metadata only, never the text itself. */
function describeIncoming(msg: ParsedMessage): string {
  const cmd = msg.isCmd ? msg.command : "-";
  return (
    `[${msg.chatJid}] ${msg.pushName} (${msg.type}) [Cmd: ${cmd}] ` +
    `[Owner: ${msg.isOwner}, Admin: ${msg.isAdmin}, BotAdmin: ${msg.isBotAdmin}]`
  );
}

/**
 * The command pipeline for one inbound message: parse it, record the sender,
 * check the guards, run the command.
 */
export async function handleMessage(
  sock: WASocket,
  raw: WAMessage,
): Promise<void> {
  // Own messages (linked devices, peer-data echoes) never dispatch.
  if (raw.key?.fromMe) return;

  const msg = await parseMessage(sock, raw, { prefixes, ownerNumbers });
  if (!msg) return;

  if (readMessages) {
    await sock.readMessages([msg.key]);
  }

  console.log(describeIncoming(msg));

  try {
    const shouldAbort = await handleAntilink(
      sock,
      msg,
      getGroupSettings(msg.chatJid),
    );
    if (shouldAbort) return;
  } catch (err) {
    console.error("Antilink check failed:", err);
  }

  const reply = createReply(sock, msg);

  const cmd = msg.isCmd ? getCommand(msg.command) : undefined;
  try {
    const store = getUsers();
    store.touch(
      { jid: msg.senderJid, lid: msg.senderLid, name: msg.pushName },
      Boolean(cmd),
    );
    // The owner is premium by definition, so no `.premium` run is needed.
    if (msg.isOwner) store.ensurePremium(msg.senderJid, msg.senderJid);
  } catch (err) {
    // Activity counts must never stop the command that was about to run.
    console.error("Failed to record user activity:", err);
  }

  try {
    clearAfk(msg);
    const notice = afkNotice(msg);
    if (notice) await reply(notice);
  } catch (err) {
    console.error("AFK check failed:", err);
    logToFile("AFK_ERROR", { error: String(err) });
  }

  if (!cmd) return;

  const denial = denyReason(cmd, msg);

  if (denial) {
    await reply(denial);
    return;
  }

  try {
    await cmd.run({
      sock,
      msg,
      reply,
      react: createReact(sock, msg),
    });
  } catch (err) {
    console.error(`Error executing command [${cmd.name}]:`, err);
    logToFile("CMD_ERROR", { cmd: cmd.name, error: String(err) });
    await reply(guardMessages.error);
  }
}
