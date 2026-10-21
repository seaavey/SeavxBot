import type { ParsedMessage } from "@/lib/message/parseMessage";
import { isPremium, type User } from "@/lib/user/users";

/** A local `YYYY-MM-DD HH:MM:SS` stamp — never a bare date. */
export const stamp = (ms: number): string => {
  const date = new Date(ms);
  return `${date.toLocaleDateString("en-CA")} ${date.toLocaleTimeString("en-GB", { hour12: false })}`;
};

/** The user's role, with the premium expiry when there is one. */
export function roleLabel(user: User): string {
  return isPremium(user)
    ? `premium (${user.premiumUntil === null ? "permanent" : stamp(user.premiumUntil)})`
    : "free";
}

/**
 * Friendly names for the device guessed from a message ID.
 *
 * `unknown` is absent on purpose: an unrecognised ID is not a device, so the
 * profile leaves the line out instead of naming one.
 */
export const DEVICE_LABELS: Partial<Record<ParsedMessage["device"], string>> = {
  web: "WhatsApp Web",
  ios: "iPhone",
  android: "Android",
  desktop: "WhatsApp Desktop",
};

/**
 * The shared body of a user profile: role, counters, and activity.
 *
 * The device is guessed from the ID of the message that triggered the profile,
 * so it is only meaningful for the sender themself — it is left out when the
 * guess failed or when the profile belongs to somebody else.
 */
export function profileBody(
  user: User,
  device?: ParsedMessage["device"],
): string[] {
  const label = device ? DEVICE_LABELS[device] : undefined;
  return [
    `Role: ${roleLabel(user)}`,
    `Messages: ${user.messageCount}`,
    `Commands: ${user.commandCount}`,
    `First seen: ${stamp(user.firstSeenAt)}`,
    `Last seen: ${stamp(user.lastSeenAt)}`,
    ...(label ? [`Device: ${label}`] : []),
  ];
}
