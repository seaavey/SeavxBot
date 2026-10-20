import {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidStatusBroadcast,
  isJidNewsletter,
  type AnyMessageContent,
  type CacheStore,
  type MiscMessageGenerationOptions,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import NodeCache from "@cacheable/node-cache";
import pino from "pino";
import QRCode from "qrcode";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseMessage, type ParsedMessage } from "@/lib/parseMessage";
import { logToFile } from "@/lib/logger";
import { botConfig } from "@/lib/config";
import { loadCommands, getCommand } from "@/lib/commandLoader";
import { getGroupMetadata, invalidateGroupMetadata } from "@/lib/groupCache";
import { getGroupSettings, getUsers } from "@/lib/db";
import { handleParticipantsUpdate } from "@/lib/greeting";
import { isBot, syncGroupUsers } from "@/lib/userSync";
import { mentionPhones } from "@/lib/mentions";
import type { Command } from "@/lib/types";

const PAIRING_CODE_DELAY_MS = 3000;
const PHONE_PROMPT = "Phone number (e.g. 628xxx): ";

const logger = pino({ level: botConfig.logging.level || "warn" });
const msgRetryCounterCache = new NodeCache({
  stdTTL: 5 * 60,
  useClones: false,
}) as unknown as CacheStore;

type AuthMethod = "pairing" | "qr";

interface AuthChoice {
  method: AuthMethod;
  phone: string;
}

const digits = (value?: string): string => (value ?? "").replace(/\D/g, "");

/** Reads one line from the terminal; the interface is closed per call so no
 *  input stream lingers across reconnects. */
async function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Resolves how this run authenticates, prompting only for what config misses. */
async function resolveAuth(isRegistered: boolean): Promise<AuthChoice | null> {
  if (isRegistered) return null;

  const configured = botConfig.auth.default_method;
  let method: AuthMethod;

  if (configured === "pairing" || configured === "qr") {
    method = configured;
  } else {
    console.log("\nChoose authentication method:");
    console.log("1. Pairing Code");
    console.log("2. QR Code");
    method = (await promptLine("Select (1 or 2): ")) === "1" ? "pairing" : "qr";
  }

  const phone = digits(botConfig.auth.phone_number);
  const resolvedPhone =
    method === "pairing" && !phone
      ? digits(await promptLine(PHONE_PROMPT))
      : phone;

  return { method, phone: resolvedPhone };
}

async function renderQR(QR: string): Promise<void> {
  console.log("\nScan this QR code with WhatsApp:\n");
  try {
    const QRString = await QRCode.toString(QR, {
      type: "terminal",
      small: true,
      margin: 0,
      errorCorrectionLevel: "L",
    });
    console.log(QRString);
  } catch (err) {
    console.error("Failed to render terminal QR:", err);
  }
}

function createReply(sock: WASocket, msg: ParsedMessage) {
  return async (
    content: string | AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ) => {
    // Phone numbers in a text reply become real @tags; the sender is not
    // tagged automatically, only numbers the reply actually names.
    const res = await sock.sendMessage(
      msg.chatJid,
      typeof content === "string" ? mentionPhones(content) : content,
      { quoted: msg.raw, ...options },
    );
    logToFile("SENT_REPLY", res);
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
  const msgs = botConfig.messages;

  if (cmd.ownerOnly && !msg.isOwner) {
    return msgs?.owner_only || "🚩 Owner access required.";
  }
  if (cmd.groupOnly && !msg.isGroup) {
    return msgs?.group_only || "🚩 Group chat required.";
  }
  if (cmd.adminOnly && !msg.isAdmin && !msg.isOwner) {
    return msgs?.admin_only || "🚩 Group admin required.";
  }
  if (cmd.botAdminOnly && !msg.isBotAdmin) {
    return msgs?.bot_admin_only || "🚩 Bot admin privileges required.";
  }

  return undefined;
}

function describeIncoming(msg: ParsedMessage): string {
  const cmd = msg.isCmd ? msg.command : "-";
  return (
    `[${msg.chatJid}] ${msg.pushName} (${msg.type}) [Cmd: ${cmd}] ` +
    `[Owner: ${msg.isOwner}, Admin: ${msg.isAdmin}, BotAdmin: ${msg.isBotAdmin}]: ` +
    msg.body
  );
}

async function handleMessage(sock: WASocket, raw: WAMessage): Promise<void> {
  logToFile("RAW_UPSERT", raw);

  // Own messages (linked devices, peer-data echoes) never dispatch.
  if (raw.key?.fromMe) return;

  const msg = await parseMessage(sock, raw, {
    prefixes: botConfig.prefixes,
    ownerNumbers: botConfig.owners,
  });
  if (!msg) return;

  logToFile("PARSED_MSG", msg);

  if (botConfig.features?.read_message) {
    await sock.readMessages([msg.key]);
  }

  console.log(describeIncoming(msg));

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
    await reply(botConfig.messages?.error || "🚩 Command execution failed.");
  }
}

async function connect(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(
    botConfig.auth.dir || "auth_info",
  );
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Using WA v${version.join(".")}, isLatest: ${isLatest}`);

  const isRegistered = Boolean(state.creds.registered || state.creds.me?.id);
  const auth = await resolveAuth(isRegistered);
  const pairingPhone = auth?.method === "pairing" ? auth.phone : "";

  const sock: WASocket = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    msgRetryCounterCache,
    generateHighQualityLinkPreview: true,
    // Status stories and channels are never bot input; dropping them here keeps
    // them out of the decrypt path, which otherwise errors on unknown senders.
    shouldIgnoreJid: (jid) => isJidStatusBroadcast(jid) || isJidNewsletter(jid),
    // Every group send needs the participant list for sender-key fan-out.
    // Serving it from the cache avoids a second IQ round trip per message.
    cachedGroupMetadata: (jid) => getGroupMetadata(sock, jid),
  });

  sock.ev.on("creds.update", saveCreds);

  if (pairingPhone) {
    // The socket must finish its handshake before it accepts this request.
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairingPhone);
        console.log(`\nYour Pairing Code: ${code}\n`);
      } catch (err) {
        console.error("Failed to request pairing code:", err);
      }
    }, PAIRING_CODE_DELAY_MS);
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr: QR }) => {
    if (QR && !isRegistered && auth?.method !== "pairing") void renderQR(QR);

    if (connection === "open") {
      console.log("Connected to WhatsApp successfully!");
      return;
    }
    if (connection !== "close") return;

    const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
      ?.statusCode;
    const reconnecting =
      statusCode !== DisconnectReason.loggedOut &&
      statusCode !== DisconnectReason.forbidden;

    console.log(
      `Connection closed (${statusCode}). Reconnecting: ${reconnecting}`,
    );

    if (!reconnecting) {
      console.log("Session terminated. Remove auth_info to re-authenticate.");
      return;
    }

    void connect().catch((err) => console.error("Reconnect failed:", err));
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const raw of messages) {
      try {
        await handleMessage(sock, raw);
      } catch (err) {
        console.error("Failed to handle message:", err);
        logToFile("MESSAGE_ERROR", { id: raw.key?.id, error: String(err) });
      }
    }
  });

  // A freshly created group (or one the bot was added to with full metadata)
  // seeds every member once, before anyone has sent a message.
  sock.ev.on("groups.upsert", (groups) => {
    for (const { id } of groups) {
      void syncGroupUsers(sock, id, getUsers()).catch((err) =>
        console.error(`Failed to sync members of ${id}:`, err),
      );
    }
  });

  // The cached participant list must never outlive a real membership change.
  const forget = ({ id }: { id: string }) => invalidateGroupMetadata(id);
  sock.ev.on("group-participants.update", (update) => {
    forget(update);
    // Joining an existing group arrives as an "add" of the bot itself. The
    // event only names the newcomers, so fetch the metadata and seed everyone.
    if (
      update.action === "add" &&
      update.participants.some((p) => isBot(sock, p.id, p.lid, p.phoneNumber))
    ) {
      void syncGroupUsers(sock, update.id, getUsers()).catch((err) =>
        console.error(`Failed to sync members of ${update.id}:`, err),
      );
    }
    // Runs after the invalidation so the greeting reads fresh metadata.
    void handleParticipantsUpdate(sock, getGroupSettings(), update).catch(
      (err) => console.error("Greeting handler failed:", err),
    );
  });
  sock.ev.on("groups.update", (updates) => {
    for (const { id } of updates) if (id) invalidateGroupMetadata(id);
  });
}

async function main(): Promise<void> {
  await loadCommands();
  await connect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
