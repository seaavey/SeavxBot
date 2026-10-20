import {
  areJidsSameUser,
  isLidUser,
  type GroupParticipant,
  type WASocket,
} from "@whiskeysockets/baileys";
import { getGroupMetadata } from "@/lib/groupCache";
import type { UserIdentity, UserStore } from "@/lib/users";

/** True when any of the identities belongs to the bot itself. */
export function isBot(
  sock: WASocket,
  ...jids: (string | null | undefined)[]
): boolean {
  return jids.some((jid) =>
    jid
      ? [sock.user?.id, sock.user?.lid].some(
          (self) => self && areJidsSameUser(self, jid),
        )
      : false,
  );
}

const identityOf = (participant: GroupParticipant): UserIdentity => ({
  jid: participant.phoneNumber || participant.id,
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
