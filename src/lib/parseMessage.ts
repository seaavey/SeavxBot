import {
  type WAMessage,
  type WASocket,
  type GroupMetadata,
  type proto,
  isPnUser,
  isLidUser,
  isHostedPnUser,
  isHostedLidUser,
} from "@whiskeysockets/baileys";
import {
  unwrapMessageContent,
  extractMessageBody,
  extractCommand,
} from "@/lib/messageContent";
import { resolvePermissions } from "@/lib/permissions";

export interface QuotedMessage {
  key: proto.IMessageKey;
  id: string;
  senderJid: string;
  body: string;
  type: string;
  content?: proto.IMessage;
}

export interface ParsedMessage {
  raw: WAMessage;
  key: proto.IMessageKey;
  id: string;
  fromMe: boolean;
  chatJid: string;
  senderJid: string;
  senderPn: string;
  senderLid: string;
  isGroup: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isBotAdmin: boolean;
  pushName: string;
  timestamp: number;
  type: string;
  body: string;
  prefix: string;
  command: string;
  args: string[];
  text: string;
  isCmd: boolean;
  mentions: string[];
  groupMetadata?: GroupMetadata;
  quoted?: QuotedMessage;
}

export interface ParseMessageOptions {
  prefixes?: string[];
  ownerNumbers?: string[];
}

export async function parseMessage(
  sock: WASocket,
  msg: WAMessage,
  options?: ParseMessageOptions,
): Promise<ParsedMessage | null> {
  const key = msg.key;
  const chatJid = key?.remoteJid;
  if (!msg.message || !chatJid || !key) return null;

  const isGroup = chatJid.endsWith("@g.us");

  // Baileys v7 exposes both identities per message: whichever one is *not* used
  // to address the stanza lands in an `*Alt` field. A LID-addressed DM therefore
  // has remoteJid = 2024…@lid and remoteJidAlt = 628…@s.whatsapp.net, while the
  // reverse happens for PN-addressed chats. Pick by suffix instead of by chat
  // type so the owner check always receives a phone number, never a LID.
  const candidates = [
    key.participantAlt,
    key.remoteJidAlt,
    key.participant,
    chatJid,
  ].filter((jid): jid is string => Boolean(jid));

  // `@hosted` / `@hosted.lid` are the hosted-account forms of the same two
  // identities, so they are matched here too — otherwise a hosted sender falls
  // through to the chat JID and every sender in the chat looks identical.
  const senderPn =
    candidates.find((jid) => isPnUser(jid) || isHostedPnUser(jid)) ?? "";
  const senderLid =
    candidates.find((jid) => isLidUser(jid) || isHostedLidUser(jid)) ?? "";

  const senderJid = senderPn || senderLid || chatJid;
  const fromMe = Boolean(key.fromMe);

  // 1. Resolve permissions & roles
  const perms = await resolvePermissions({
    sock,
    chatJid,
    senderJid,
    senderLid,
    senderPn,
    fromMe,
    isGroup,
    ownerNumbers: options?.ownerNumbers,
  });

  // 2. Extract content & body
  const content = unwrapMessageContent(msg.message);
  const type = content ? Object.keys(content)[0] || "" : "";
  const body = extractMessageBody(content);

  // 3. Extract command and args
  const cmd = extractCommand(body, options?.prefixes);

  // 4. Extract context, mentions, and quoted message
  const contextInfo =
    content?.extendedTextMessage?.contextInfo ||
    content?.imageMessage?.contextInfo ||
    content?.videoMessage?.contextInfo ||
    content?.documentMessage?.contextInfo ||
    content?.interactiveMessage?.contextInfo;

  const mentions = contextInfo?.mentionedJid || [];

  let quoted: QuotedMessage | undefined;
  if (contextInfo?.quotedMessage && contextInfo.stanzaId) {
    const quotedContent = unwrapMessageContent(contextInfo.quotedMessage);
    const quotedType = quotedContent ? Object.keys(quotedContent)[0] || "" : "";
    const quotedBody = extractMessageBody(quotedContent);

    quoted = {
      key: {
        remoteJid: chatJid,
        id: contextInfo.stanzaId,
        participant: contextInfo.participant || undefined,
        fromMe: contextInfo.participant === undefined,
      },
      id: contextInfo.stanzaId,
      senderJid: contextInfo.participant || chatJid,
      body: quotedBody,
      type: quotedType,
      content: quotedContent,
    };
  }

  const timestamp =
    typeof msg.messageTimestamp === "number"
      ? msg.messageTimestamp
      : Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000);

  return {
    raw: msg,
    key,
    id: key.id || "",
    fromMe,
    chatJid,
    senderJid,
    senderPn,
    senderLid,
    isGroup,
    isOwner: perms.isOwner,
    isAdmin: perms.isAdmin,
    isSuperAdmin: perms.isSuperAdmin,
    isBotAdmin: perms.isBotAdmin,
    groupMetadata: perms.groupMetadata,
    pushName: msg.pushName || "",
    timestamp,
    type,
    body,
    prefix: cmd.prefix,
    command: cmd.command,
    args: cmd.args,
    text: cmd.text,
    isCmd: cmd.isCmd,
    mentions,
    quoted,
  };
}
