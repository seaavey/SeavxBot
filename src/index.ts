import {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidStatusBroadcast,
  isJidNewsletter,
  DEFAULT_CONNECTION_CONFIG,
  type CacheStore,
  type WAVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import NodeCache from "@cacheable/node-cache";
import pino from "pino";
import QRCode from "qrcode";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { authOptions, logLevel } from "@/lib/core/config";
import { loadCommands } from "@/lib/core/commandLoader";
import { handleMessage } from "@/lib/message/dispatch";
import { logToFile } from "@/lib/core/logger";
import {
  getGroupMetadata,
  invalidateGroupMetadata,
} from "@/lib/group/groupCache";
import { getGroupSettings, getUsers } from "@/lib/core/db";
import { handleParticipantsUpdate } from "@/lib/group/greeting";
import { syncGroupUsers } from "@/lib/group/userSync";
import { digits, isBot } from "@/lib/message/identity";

const PAIRING_CODE_DELAY_MS = 3000;
const PHONE_PROMPT = "Phone number (e.g. 628xxx): ";
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const VERSION_FETCH_TIMEOUT_MS = 5_000;

/** Backoff state, reset every time the connection opens. */
let reconnectAttempt = 0;

const logger = pino({ level: logLevel });
const msgRetryCounterCache = new NodeCache({
  stdTTL: 5 * 60,
  useClones: false,
}) as unknown as CacheStore;

type AuthMethod = "pairing" | "qr";

interface AuthChoice {
  method: AuthMethod;
  phone: string;
}

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

  const configured = authOptions.defaultMethod;
  let method: AuthMethod;

  if (configured === "pairing" || configured === "qr") {
    method = configured;
  } else {
    console.log("\nChoose authentication method:");
    console.log("1. Pairing Code");
    console.log("2. QR Code");
    method = (await promptLine("Select (1 or 2): ")) === "1" ? "pairing" : "qr";
  }

  const phone = digits(authOptions.phoneNumber);
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

/** raw.githubusercontent.com can stall for minutes on a cold link, and the
 *  handshake never needs it: Baileys ships a version WhatsApp accepts. */
async function resolveWaVersion(): Promise<{
  version: WAVersion;
  isLatest: boolean;
}> {
  const fallback = {
    version: DEFAULT_CONNECTION_CONFIG.version,
    isLatest: false,
  };
  return Promise.race([
    // A rejection that lands after the fallback won must not go unhandled.
    fetchLatestBaileysVersion().catch(() => fallback),
    Bun.sleep(VERSION_FETCH_TIMEOUT_MS).then(() => fallback),
  ]);
}

async function connect(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(authOptions.dir);
  const { version, isLatest } = await resolveWaVersion();
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
      reconnectAttempt = 0;
      console.log("Connected to WhatsApp successfully!");
      return;
    }
    if (connection !== "close") return;

    const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
      ?.statusCode;
    // 440 is another instance holding the same creds, not a dead session:
    // telling the owner to remove auth_info there would force a re-pair.
    if (statusCode === DisconnectReason.connectionReplaced) {
      console.log(
        "Connection closed (440): another instance is using this session. Stop it and restart.",
      );
      return;
    }
    // 401 logged out and 403 forbidden mean the creds are gone: reconnecting
    // only fights the other end.
    const terminal =
      statusCode === DisconnectReason.loggedOut ||
      statusCode === DisconnectReason.forbidden;

    if (terminal) {
      console.log(
        `Connection closed (${statusCode}). Session terminated; remove auth_info to re-authenticate.`,
      );
      return;
    }

    const wait = Math.min(
      RECONNECT_BASE_MS * 2 ** reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    reconnectAttempt += 1;
    console.log(
      `Connection closed (${statusCode}). Reconnecting in ${wait}ms (attempt ${reconnectAttempt}).`,
    );

    setTimeout(
      () =>
        void connect().catch((err) => console.error("Reconnect failed:", err)),
      wait,
    );
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
