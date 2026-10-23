import { describe, expect, test } from "bun:test";
import type { GroupParticipant, WASocket } from "@whiskeysockets/baileys";
import { mentionables } from "@/lib/group/participants";

const BOT = { id: "628123@s.whatsapp.net", lid: "628123@lid" };

function sock(): WASocket {
  return {
    user: { id: BOT.id, lid: BOT.lid },
  } as unknown as WASocket;
}

function participant(
  overrides: Partial<GroupParticipant> = {},
): GroupParticipant {
  return {
    id: "628999@lid",
    phoneNumber: "628999@s.whatsapp.net",
    ...overrides,
  } as unknown as GroupParticipant;
}

describe("mentionables", () => {
  test("filters out the bot when it appears as the phone JID", () => {
    const members = [
      participant({ id: BOT.id, phoneNumber: BOT.id }),
      participant({ id: "628111@lid", phoneNumber: "628111@s.whatsapp.net" }),
    ];

    const filtered = mentionables(sock(), members);
    expect(filtered).toHaveLength(1);
    expect(filtered.map((p) => p.id)).toEqual(["628111@lid"]);
  });

  test("filters out the bot when only the LID is exposed", () => {
    const members = [
      participant({ id: BOT.lid, phoneNumber: BOT.id }),
      participant({ id: "628111@lid", phoneNumber: "628111@s.whatsapp.net" }),
    ];

    const filtered = mentionables(sock(), members);
    expect(filtered).toHaveLength(1);
    expect(filtered.map((p) => p.id)).toEqual(["628111@lid"]);
  });

  test("keeps ordinary members and is not confused by number suffixes", () => {
    const members = [
      participant({ id: "628111@lid", phoneNumber: "628111@s.whatsapp.net" }),
      participant({ id: "628222@lid", phoneNumber: "628222@s.whatsapp.net" }),
    ];

    expect(mentionables(sock(), members)).toHaveLength(2);
  });
});
