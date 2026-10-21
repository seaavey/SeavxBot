import {
  isLidUser,
  type GroupParticipant,
  type WASocket,
} from "@whiskeysockets/baileys";
import { getGroupMetadata } from "@/lib/groupCache";
import { isBot, participantJid } from "@/lib/identity";
import type { UserIdentity, UserStore } from "@/lib/users";

const identityOf = (participant: GroupParticipant): UserIdentity => ({
  jid: participantJid(participant),
  lid: participant.lid || (isLidUser(participant.id) ? participant.id : null),
  name: participant.notify || participant.name || null,
});

/** Records every member of a group the bot just joined. */
export async function syncGroupUsers(
  sock: WASocket,
  groupJid: string,
  store: UserStore,
): Promise<void> {
  const meta = await getGroupMetadata(sock, groupJid);
  if (!meta) return;

  store.ensureMany(
    meta.participants
      .filter(
        (participant) =>
          !isBot(
            sock,
            participant.id,
            participant.lid,
            participant.phoneNumber,
          ),
      )
      .map(identityOf),
  );
}
