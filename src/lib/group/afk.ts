import type { ParsedMessage } from "@/lib/message/parseMessage";
import { pnFor } from "@/lib/group/ops";
import { sameUser, userPart } from "@/lib/message/identity";

interface AfkEntry {
  jid: string;
  lid: string;
  reason: string;
}

export interface AfkNotice {
  text: string;
  mentions: string[];
}

const DEFAULT_REASON = "No reason given.";
const MAX_REASON = 100;
const chats = new Map<string, AfkEntry[]>();

function find(chatJid: string, jid: string): AfkEntry | undefined {
  return chats
    .get(chatJid)
    ?.find((entry) => sameUser(entry.jid, jid) || sameUser(entry.lid, jid));
}

function remove(chatJid: string, entry: AfkEntry): void {
  const list = chats.get(chatJid);
  if (!list) return;
  const next = list.filter((item) => item !== entry);
  if (next.length === 0) chats.delete(chatJid);
  else chats.set(chatJid, next);
}

export function clearAfk(msg: ParsedMessage): void {
  const entry =
    find(msg.chatJid, pnFor(msg.groupMetadata, msg.senderJid)) ??
    find(msg.chatJid, msg.senderLid);
  if (entry) remove(msg.chatJid, entry);
}

/** Stores the sender's status and returns the reason that was stored. */
function setAfk(msg: ParsedMessage, reason: string): string {
  const stored = (reason || DEFAULT_REASON).slice(0, MAX_REASON);
  const entry: AfkEntry = {
    jid: pnFor(msg.groupMetadata, msg.senderJid),
    lid: msg.senderLid,
    reason: stored,
  };
  const list = chats.get(msg.chatJid) ?? [];
  const next = list.filter(
    (item) =>
      !sameUser(item.jid, entry.jid) &&
      !sameUser(item.jid, entry.lid) &&
      !sameUser(item.lid, entry.jid) &&
      !sameUser(item.lid, entry.lid),
  );
  next.push(entry);
  chats.set(msg.chatJid, next);
  return stored;
}

/** Applies `.afk` and returns the one line to show the sender. */
export function applyAfk(msg: ParsedMessage): string {
  const text = msg.text.trim();
  if (["off", "stop"].includes(text.toLowerCase())) {
    // Dispatch already cleared the entry; this only confirms it.
    return "✅ AFK cleared.";
  }
  return `💤 AFK set — ${setAfk(msg, text)}`;
}

export function afkNotice(msg: ParsedMessage): AfkNotice | undefined {
  if (!msg.isGroup || msg.isCmd) return;

  const candidates = [...msg.mentions];
  if (msg.quoted?.senderJid) candidates.push(msg.quoted.senderJid);

  const seen = new Set<AfkEntry>();
  const lines: string[] = [];
  const mentions: string[] = [];

  for (const jid of candidates) {
    if (sameUser(jid, msg.senderJid) || sameUser(jid, msg.senderLid)) continue;
    const entry = find(msg.chatJid, pnFor(msg.groupMetadata, jid));
    if (!entry || seen.has(entry)) continue;

    seen.add(entry);
    mentions.push(jid);
    lines.push(`💤 @${userPart(jid)} is AFK — ${entry.reason}`);
  }

  return lines.length > 0 ? { text: lines.join("\n"), mentions } : undefined;
}
