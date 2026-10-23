import { describe, expect, test } from "bun:test";
import type { GroupMetadata, WASocket } from "@whiskeysockets/baileys";
import type { ParsedMessage } from "@/lib/message/parseMessage";
import { pnFor, resolveTargets } from "@/lib/group/ops";

const META = {
  participants: [{ id: "628123@lid", phoneNumber: "628123@s.whatsapp.net" }],
} as unknown as GroupMetadata;

describe("pnFor", () => {
  test("maps a LID participant to its phone number", () => {
    expect(pnFor(META, "628123@lid")).toBe("628123@s.whatsapp.net");
  });

  test("returns an unknown JID unchanged", () => {
    expect(pnFor(META, "628999@lid")).toBe("628999@lid");
  });

  test("maps a LID to its phone JID when the metadata prefers the PN", () => {
    const meta = {
      participants: [{ id: "628123@s.whatsapp.net", lid: "999123@lid" }],
    } as unknown as GroupMetadata;

    expect(pnFor(meta, "999123@lid")).toBe("628123@s.whatsapp.net");
  });
});

// onWhatsApp is never reached: the quoted author already fills the set.
const SOCK = { onWhatsApp: async () => undefined } as unknown as WASocket;

function quoted(senderJid: string): ParsedMessage {
  return {
    mentions: [],
    args: [],
    groupMetadata: undefined,
    quoted: { senderJid },
  } as unknown as ParsedMessage;
}

describe("resolveTargets", () => {
  test("strips the device suffix from a quoted author", async () => {
    const targets = await resolveTargets(
      SOCK,
      quoted("628123:2@s.whatsapp.net"),
      [],
    );

    expect(targets).toEqual([
      { jid: "628123@s.whatsapp.net", label: "+628123" },
    ]);
  });
});
