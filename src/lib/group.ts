import {
  jidNormalizedUser,
  type GroupMetadata,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import type { ParsedMessage } from "@/lib/parseMessage";
import { patchGroupMetadata } from "@/lib/groupCache";
import { digits, labelFor, sameUser, userPart } from "@/lib/identity";

export type MemberAction = "add" | "remove" | "promote" | "demote";

export interface Target {
  jid: string;
  label: string;
}

type ParticipantResult = { status: string; jid: string | undefined };

export const NO_TARGET =
  "🚩 Mention someone, reply to their message, or pass a phone number.";

/** WhatsApp answers each participant with a numeric status string. */
const STATUS_TEXT: Record<string, string> = {
  "200": "done",
  "401": "not authorized",
  "403": "not authorized",
  "404": "not on WhatsApp",
  "408": "not in this group",
  "409": "already in this group",
};

const ACTION_LABEL: Record<MemberAction, string> = {
  add: "Added",
  remove: "Removed",
  promote: "Promoted",
  demote: "Demoted",
};

/**
 * Baileys surfaces group IQ failures as `new Boom(text, { data: code })`, so the
 * numeric code usually lives on `data`. Other call sites put a node or a message
 * there instead, so only a numeric `data` is a code; the rest fall back to the
 * status, which is otherwise a generic 500.
 */
function statusOf(err: unknown): number | undefined {
  const boom = err as Boom | undefined;

  if (typeof boom?.data === "number") return boom.data;

  const statusCode = boom?.output?.statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

/** Turns a socket rejection into something worth showing a group admin. */
export function describeError(err: unknown): string {
  const status = statusOf(err);

  if (status === 401 || status === 403) {
    return "🚩 WhatsApp refused the request — I likely need to be a group admin.";
  }
  if (status === 404) return "🚩 Group not found.";

  return `🚩 ${err instanceof Error ? err.message : String(err)}`;
}

/** Runs a group mutation and formats either its result or its failure. */
export async function runGroupOp<T>(
  action: () => Promise<T>,
  format: (value: T) => string,
): Promise<string> {
  try {
    return format(await action());
  } catch (err) {
    return describeError(err);
  }
}

/**
 * Runs a group setting change and keeps the cached metadata in sync. Without
 * this, a second `.close` within the 30s TTL still sees the old state and the
 * "already closed" guard never fires.
 */
export async function runSettingOp(
  jid: string,
  action: () => Promise<unknown>,
  format: () => string,
  patch: (meta: GroupMetadata) => GroupMetadata,
): Promise<string> {
  try {
    await action();
    patchGroupMetadata(jid, patch);
    return format();
  } catch (err) {
    return describeError(err);
  }
}

/**
 * Phone JIDs for a participant. LID-addressed groups identify members by `@lid`,
 * which is an internal id the user has never seen — resolve to `phoneNumber`
 * (PN) whenever the metadata carries it, and only fall back to the LID itself.
 */
function pnFor(meta: GroupMetadata | undefined, jid: string): string {
  const participant = meta?.participants.find((p) => sameUser(p.id, jid));
  return participant?.phoneNumber || jid;
}

/**
 * Who the command acts on: mentions first, then the quoted author, then phone
 * numbers from the arguments. Duplicates collapse onto the first label seen.
 */
export async function resolveTargets(
  sock: WASocket,
  msg: ParsedMessage,
  args: string[],
): Promise<Target[]> {
  const targets = new Map<string, Target>();
  const add = (jid: string): void => {
    const pn = pnFor(msg.groupMetadata, jid);
    targets.set(pn, { jid: pn, label: labelFor(pn) });
  };

  for (const jid of msg.mentions) add(jid);

  if (targets.size === 0 && msg.quoted?.senderJid) {
    add(msg.quoted.senderJid);
  }

  const known = new Set([...targets.keys()].map(userPart));
  const numbers = args
    .map(digits)
    .filter((value) => value.length >= 6 && !known.has(value));

  if (numbers.length > 0) {
    try {
      const found = (await sock.onWhatsApp(...numbers)) ?? [];
      for (const entry of found) {
        if (!entry.exists) continue;
        const jid = jidNormalizedUser(entry.jid);
        targets.set(jid, { jid, label: labelFor(jid) });
      }
    } catch (err) {
      // Best effort — mentions and the quoted author are already resolved.
      console.error("Failed to resolve phone numbers:", err);
    }
  }

  return [...targets.values()];
}

/** Applies a participant action and reports the per-member outcome. */
export async function runMemberAction(
  sock: WASocket,
  msg: ParsedMessage,
  action: MemberAction,
): Promise<string> {
  let targets = await resolveTargets(sock, msg, msg.args);
  if (targets.length === 0) return NO_TARGET;

  if (action === "remove") {
    // Removing ourselves succeeds silently and strands the bot outside the
    // group, so drop self before the request ever leaves the process.
    const self = [sock.user?.id, sock.user?.lid].filter((jid): jid is string =>
      Boolean(jid),
    );
    targets = targets.filter(
      (target) => !self.some((jid) => sameUser(jid, target.jid)),
    );
    if (targets.length === 0) return "🚩 I won't remove myself.";
  }

  let results: ParticipantResult[];
  try {
    results = await sock.groupParticipantsUpdate(
      msg.chatJid,
      targets.map((target) => target.jid),
      action,
    );
  } catch (err) {
    return describeError(err);
  }

  const lines = results.map((result) => {
    const jid = result.jid ?? "";
    // The server echoes back whichever identity it addressed the member by, so
    // a LID-group answer arrives as `@lid` even though we sent the PN. Match on
    // identity first, then fall back to the metadata mapping — never label the
    // raw LID, which is an internal id the admin has never seen.
    const known = targets.find((target) => sameUser(target.jid, jid));
    const label = known?.label ?? labelFor(pnFor(msg.groupMetadata, jid));
    const ok = result.status === "200";
    const outcome = STATUS_TEXT[result.status] ?? `error ${result.status}`;
    return `${ok ? "✅" : "🚩"} ${label} — ${outcome}`;
  });

  return [`${ACTION_LABEL[action]} ${results.length} member(s)`, ...lines].join(
    "\n",
  );
}

/** Renders group metadata the bot already fetched while resolving permissions. */
export function describeGroup(meta: GroupMetadata): string {
  const admins = meta.participants.filter(
    (participant) =>
      participant.admin === "admin" || participant.admin === "superadmin",
  ).length;

  // Local date: group creation is an absolute instant, and an admin reading
  // "created" expects their own calendar day, not UTC's.
  const created = meta.creation
    ? new Date(meta.creation * 1000).toLocaleDateString("en-CA")
    : "unknown";

  const lines = [
    `*${meta.subject}*`,
    `ID: ${meta.id}`,
    `Created: ${created}`,
    `Members: ${meta.participants.length} (${admins} admin)`,
    `Messages: ${meta.announce ? "admins only" : "everyone"}`,
    `Edit info: ${meta.restrict ? "admins only" : "everyone"}`,
  ];

  if (meta.desc) lines.push("", meta.desc);

  return lines.join("\n");
}
