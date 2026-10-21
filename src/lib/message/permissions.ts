import {
  type WASocket,
  type GroupMetadata,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import { getGroupMetadata } from "@/lib/group/groupCache";
import { sameUser } from "@/lib/message/identity";

export interface ResolvedPermissions {
  isOwner: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isBotAdmin: boolean;
  groupMetadata?: GroupMetadata;
}

export interface ResolvePermissionsParams {
  sock: WASocket;
  chatJid: string;
  senderJid: string;
  senderLid: string;
  senderPn: string;
  fromMe: boolean;
  isGroup: boolean;
  ownerNumbers?: string[];
}

export async function resolvePermissions({
  sock,
  chatJid,
  senderJid,
  senderLid,
  senderPn,
  fromMe,
  isGroup,
  ownerNumbers = [],
}: ResolvePermissionsParams): Promise<ResolvedPermissions> {
  const senderNumber = senderPn.split("@")[0]?.split(":")[0] || "";

  const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : "";
  const botLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : "";

  const ownerList = ownerNumbers.map((num) => num.replace(/\D/g, ""));
  const isOwner = Boolean(
    fromMe ||
    (senderNumber && ownerList.includes(senderNumber)) ||
    (botJid && sameUser(senderJid, botJid)),
  );

  let isAdmin = false;
  let isSuperAdmin = false;
  let isBotAdmin = false;
  let groupMetadata: GroupMetadata | undefined;

  if (isGroup) {
    try {
      groupMetadata = await getGroupMetadata(sock, chatJid);
      const participants = groupMetadata?.participants || [];

      for (const p of participants) {
        // Baileys builds a participant as `{ id, phoneNumber, lid, … }`: `id` is
        // whichever form the group addresses members by, and the other identity
        // rides along in `phoneNumber` / `lid`. None of the three is guaranteed,
        // so every known identity is compared against every known sender one.
        const participantIds = [p.id, p.phoneNumber, p.lid];
        const senderIds = [senderJid, senderPn, senderLid];

        const isSenderMatch = participantIds.some((participantJid) =>
          senderIds.some((senderId) => sameUser(participantJid, senderId)),
        );

        if (isSenderMatch) {
          if (p.admin === "admin") isAdmin = true;
          if (p.admin === "superadmin") {
            isAdmin = true;
            isSuperAdmin = true;
          }
        }

        const isBotMatch = participantIds.some(
          (participantJid) =>
            sameUser(participantJid, botJid) ||
            sameUser(participantJid, botLid),
        );

        if (isBotMatch && (p.admin === "admin" || p.admin === "superadmin")) {
          isBotAdmin = true;
        }
      }
    } catch {
      // Non-admin or metadata fetch failure
    }
  }

  return {
    isOwner,
    isAdmin,
    isSuperAdmin,
    isBotAdmin,
    groupMetadata,
  };
}
