import {
  areJidsSameUser,
  type GroupParticipant,
  type WASocket,
} from "@whiskeysockets/baileys";

/** The digits of a value, e.g. `628123` out of `+62 812-3`. */
export const digits = (value?: string): string =>
  (value ?? "").replace(/\D/g, "");

/** The user part of a JID, e.g. `628123` out of `628123@s.whatsapp.net`. */
export const userPart = (jid: string): string => jid.split("@")[0] || jid;

const PHONE_JID_SUFFIXES = ["@s.whatsapp.net", "@hosted"];

/** A dialable phone identity (PN), as opposed to a LID or a group. */
export const isPhoneJid = (jid: string): boolean =>
  PHONE_JID_SUFFIXES.some((suffix) => jid.endsWith(suffix));

/**
 * `+628xxx` for a phone JID, `@123456` for anything else — a group, or a LID
 * that has no PN. A LID is an internal id; presenting it as `+628xxx` would
 * dress it up as a dialable number.
 */
export function labelFor(jid: string): string {
  const bare = userPart(jid);
  return isPhoneJid(jid) ? `+${digits(bare)}` : `@${bare}`;
}

/**
 * Identity comparison that refuses empty input. `areJidsSameUser("", "")` is
 * `true` — it only compares the decoded user part — so an absent identity
 * would otherwise match another absent one.
 */
export function sameUser(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return areJidsSameUser(left, right);
}

/** The phone JID of a group participant, when the group exposes one. */
export function participantJid(participant: GroupParticipant): string {
  return participant.phoneNumber || participant.id;
}

/** True when any of the identities belongs to the bot itself. */
export function isBot(
  sock: WASocket,
  ...jids: (string | null | undefined)[]
): boolean {
  return jids.some((jid) =>
    jid
      ? [sock.user?.id, sock.user?.lid].some((self) => sameUser(self, jid))
      : false,
  );
}
