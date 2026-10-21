import { isPremium, type User } from "@/lib/users";

const stamp = (ms: number): string => {
  const date = new Date(ms);
  return `${date.toLocaleDateString("en-CA")} ${date.toLocaleTimeString("en-GB", { hour12: false })}`;
};

/** The shared body of a user profile: role, counters, and activity. */
export function profileBody(user: User): string[] {
  const role = isPremium(user)
    ? `premium (${user.premiumUntil === null ? "permanent" : stamp(user.premiumUntil)})`
    : "free";

  return [
    `Role: ${role}`,
    `Messages: ${user.messageCount}`,
    `Commands: ${user.commandCount}`,
    `First seen: ${stamp(user.firstSeenAt)}`,
    `Last seen: ${stamp(user.lastSeenAt)}`,
  ];
}
