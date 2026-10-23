import type { GroupParticipant, WASocket } from "@whiskeysockets/baileys";
import { isBot } from "@/lib/message/identity";

/** Everyone a tag may address: the bot is a participant too. */
export function mentionables(
  sock: WASocket,
  participants: readonly GroupParticipant[],
): GroupParticipant[] {
  return participants.filter(
    (participant) =>
      !isBot(sock, participant.id, participant.lid, participant.phoneNumber),
  );
}
