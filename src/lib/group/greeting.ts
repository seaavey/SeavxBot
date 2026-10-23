import {
  type GroupParticipant,
  type ParticipantAction,
  type WASocket,
} from "@whiskeysockets/baileys";
import {
  getGroupMetadata,
  invalidateGroupMetadata,
} from "@/lib/group/groupCache";
import { labelFor, participantJid, userPart } from "@/lib/message/identity";
import type { SettingsStore } from "@/lib/group/settings";
import { mentionables } from "@/lib/group/participants";

export interface GreetingMember {
  jid: string;
  name: string;
}

export interface GreetingContext {
  group: string;
  count: number;
  members: GreetingMember[];
}

export interface ParticipantsUpdate {
  id: string;
  action: ParticipantAction;
  participants: GroupParticipant[];
}

/**
 * Fills the four supported placeholders. An unknown one is left in place: a
 * typo in a template should be visible to the admin who wrote it, not silently
 * dropped.
 */
function renderGreeting(template: string, context: GreetingContext): string {
  const mentions = context.members.map((m) => `@${userPart(m.jid)}`).join(" ");
  const names = context.members.map((m) => m.name).join(", ");

  return template
    .replaceAll("{mention}", mentions)
    .replaceAll("{name}", names)
    .replaceAll("{group}", context.group)
    .replaceAll("{count}", String(context.count));
}

/**
 * `name` is the name the bot's owner saved for the contact, `notify` the one
 * the member set for themselves; the number is the last resort when WhatsApp
 * sends neither. The fallback goes through `labelFor` so a LID stays an
 * `@id` instead of being rendered as a dialable number.
 */
function displayName(participant: GroupParticipant): string {
  return (
    participant.name ||
    participant.notify ||
    labelFor(participantJid(participant))
  );
}

export async function handleParticipantsUpdate(
  sock: WASocket,
  store: SettingsStore,
  update: ParticipantsUpdate,
): Promise<void> {
  try {
    if (update.action !== "add" && update.action !== "remove") return;

    const flag = update.action === "add" ? "welcome" : "goodbye";
    const key = update.action === "add" ? "welcome_text" : "goodbye_text";

    const settings = store.get(update.id);
    if (!settings[flag]) return;

    const members = mentionables(sock, update.participants).map(
      (participant) => ({
        jid: participant.id,
        name: displayName(participant),
      }),
    );

    if (members.length === 0) return;

    // The membership just changed, so the cached copy is stale by definition.
    invalidateGroupMetadata(update.id);
    const meta = await getGroupMetadata(sock, update.id);

    const text = renderGreeting(settings[key], {
      group: meta?.subject || "this group",
      count: meta?.participants.length ?? 0,
      members,
    });

    await sock.sendMessage(update.id, {
      text,
      mentions: members.map((member) => member.jid),
    });
  } catch (err) {
    // A failed greeting must never take down the event handler that called it.
    console.error(`Failed to greet in ${update.id}:`, err);
  }
}
