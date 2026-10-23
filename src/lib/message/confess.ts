import type { WASocket } from "@whiskeysockets/baileys";
import type { ParsedMessage } from "@/lib/message/parseMessage";
import { resolveTargets } from "@/lib/group/ops";
import { digits, isBot, sameUser, userPart } from "@/lib/message/identity";

const COOLDOWN_MS = 60_000;
const lastSent = new Map<string, number>();

/** Delivers one anonymous DM and returns the one line the sender sees. */
export async function deliverConfession(
  sock: WASocket,
  msg: ParsedMessage,
): Promise<string> {
  const first = msg.args[0] ?? "";
  const tagFirst = first.startsWith("@");
  const numberFirst = !tagFirst && digits(first).length >= 6;
  const explicit = tagFirst || numberFirst;

  // A LID tag token must be matched to its mention before pnFor rewrites it.
  const tagJid = tagFirst
    ? msg.mentions.find((jid) => userPart(jid) === digits(first))
    : undefined;

  // The token in front wins; a mention or quote deeper in the body does not.
  const scoped = explicit
    ? { ...msg, mentions: tagJid ? [tagJid] : [], quoted: undefined }
    : msg;
  const [target] = await resolveTargets(
    sock,
    scoped,
    explicit && !tagJid ? [first] : [],
  );

  if (!target) {
    return "🚩 Tag someone, reply to their message, or pass a phone number.";
  }
  if (
    target.jid.endsWith("@g.us") ||
    isBot(sock, target.jid) ||
    sameUser(target.jid, msg.senderJid) ||
    sameUser(target.jid, msg.senderLid)
  ) {
    return "🚩 You cannot confess to that target.";
  }

  const message = (explicit ? msg.args.slice(1) : msg.args).join(" ").trim();
  if (message.length === 0) {
    return "🚩 Add the confession text after the target.";
  }

  const now = Date.now();
  for (const [jid, at] of lastSent) {
    if (now - at >= COOLDOWN_MS) lastSent.delete(jid);
  }

  const senderIds = [...new Set([msg.senderJid, msg.senderLid])].filter(
    Boolean,
  );
  if (senderIds.some((jid) => lastSent.has(jid))) {
    return "🚩 Wait a minute before sending another confession.";
  }

  let delivered = false;
  try {
    delivered = Boolean(
      await sock.sendMessage(target.jid, {
        text: `💌 Someone confessed:\n\n${message}`,
      }),
    );
  } catch {
    // A blocked or deleted target rejects here; both are the same refusal.
  }

  if (!delivered) return "🚩 Could not deliver that confession.";

  for (const jid of senderIds) lastSent.set(jid, now);
  return "✅ Confession delivered.";
}
