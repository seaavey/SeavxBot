import { isPremium, type User } from "@/lib/users";

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

/** The shared body of a user profile: role, counters, and activity. */
export function profileBody(user: User): string[] {
  return [
    `Role: ${roleLabel(user)}`,
    `Messages: ${user.messageCount}`,
    `Commands: ${user.commandCount}`,
    `First seen: ${stamp(user.firstSeenAt)}`,
    `Last seen: ${stamp(user.lastSeenAt)}`,
  ];
}
