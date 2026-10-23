import { describe, expect, test } from "bun:test";
import type { GroupMetadata, WASocket } from "@whiskeysockets/baileys";
import type { ParsedMessage } from "@/lib/message/parseMessage";
import { deliverConfession } from "@/lib/message/confess";

interface Sent {
  jid: string;
  text: string;
}

const META = {
  participants: [{ id: "999111@lid", phoneNumber: "628111@s.whatsapp.net" }],
} as unknown as GroupMetadata;

function fakeSock(sent: Sent[], deliver: boolean = true): WASocket {
  return {
    sendMessage: async (jid: string, content: { text: string }) => {
      if (!deliver) return undefined;
      sent.push({ jid, text: content.text });
      return { key: { id: "m1" } };
    },
    onWhatsApp: async (...numbers: string[]) =>
      numbers.map((number) => ({
        exists: true,
        jid: `${number}@s.whatsapp.net`,
      })),
  } as unknown as WASocket;
}

function msg(fields: Partial<ParsedMessage>): ParsedMessage {
  return {
    chatJid: "1@g.us",
    isGroup: true,
    senderJid: "628999@s.whatsapp.net",
    senderLid: "",
    args: [],
    mentions: [],
    quoted: undefined,
    groupMetadata: META,
    ...fields,
  } as unknown as ParsedMessage;
}

function quoted(senderJid: string): ParsedMessage["quoted"] {
  return { senderJid } as ParsedMessage["quoted"];
}

describe("confess", () => {
  test("a number in front wins over a later mention", async () => {
    const sent: Sent[] = [];
    const line = await deliverConfession(
      fakeSock(sent),
      msg({
        senderJid: "628901@s.whatsapp.net",
        args: ["628123456789", "hi", "@628111"],
        mentions: ["628111@s.whatsapp.net"],
      }),
    );

    expect(line).toBe("✅ Confession delivered.");
    expect(sent).toEqual([
      {
        jid: "628123456789@s.whatsapp.net",
        text: "💌 Someone confessed:\n\nhi @628111",
      },
    ]);
  });

  test("a tag token is stripped and a tag-only message is refused", async () => {
    const sent: Sent[] = [];
    const line = await deliverConfession(
      fakeSock(sent),
      msg({ args: ["@999111"], mentions: ["999111@lid"] }),
    );

    expect(line).toBe("🚩 Add the confession text after the target.");
    expect(sent).toHaveLength(0);
  });

  test("a refused target is reported before a missing text", async () => {
    const sent: Sent[] = [];
    const line = await deliverConfession(
      fakeSock(sent),
      msg({
        senderJid: "628111@s.whatsapp.net",
        quoted: quoted("628111@s.whatsapp.net"),
      }),
    );

    expect(line).toBe("🚩 You cannot confess to that target.");
    expect(sent).toHaveLength(0);
  });

  test("the DM carries no sender identity", async () => {
    const sent: Sent[] = [];
    await deliverConfession(
      fakeSock(sent),
      msg({
        senderJid: "628902@s.whatsapp.net",
        senderLid: "999902@lid",
        args: ["hello"],
        quoted: quoted("628222@s.whatsapp.net"),
      }),
    );

    expect(sent[0]?.text).toBe("💌 Someone confessed:\n\nhello");
    expect(sent[0]?.text.includes("628902")).toBe(false);
    expect(sent[0]?.text.includes("999902")).toBe(false);
  });

  test("a quoted author is delivered to the bare JID", async () => {
    const sent: Sent[] = [];
    await deliverConfession(
      fakeSock(sent),
      msg({
        senderJid: "628903@s.whatsapp.net",
        args: ["hello"],
        quoted: quoted("628222:5@s.whatsapp.net"),
      }),
    );

    expect(sent[0]?.jid).toBe("628222@s.whatsapp.net");
  });

  test("refuses a message with no target", async () => {
    const sent: Sent[] = [];
    const line = await deliverConfession(
      fakeSock(sent),
      msg({ args: ["hello"] }),
    );

    expect(line).toBe(
      "🚩 Tag someone, reply to their message, or pass a phone number.",
    );
    expect(sent).toHaveLength(0);
  });

  test("both sender identities share the cooldown", async () => {
    const sent: Sent[] = [];
    const sock = fakeSock(sent);
    const first = await deliverConfession(
      sock,
      msg({
        senderJid: "628904@s.whatsapp.net",
        senderLid: "999904@lid",
        args: ["hello"],
        quoted: quoted("628222@s.whatsapp.net"),
      }),
    );
    const second = await deliverConfession(
      sock,
      msg({
        senderJid: "999904@lid",
        args: ["again"],
        quoted: quoted("628222@s.whatsapp.net"),
      }),
    );

    expect(first).toBe("✅ Confession delivered.");
    expect(second).toBe("🚩 Wait a minute before sending another confession.");
    expect(sent).toHaveLength(1);
  });

  test("a failed delivery does not start the cooldown", async () => {
    const line = await deliverConfession(
      fakeSock([], false),
      msg({
        senderJid: "628905@s.whatsapp.net",
        args: ["hello"],
        quoted: quoted("628222@s.whatsapp.net"),
      }),
    );
    expect(line).toBe("🚩 Could not deliver that confession.");

    const sent: Sent[] = [];
    const retry = await deliverConfession(
      fakeSock(sent),
      msg({
        senderJid: "628905@s.whatsapp.net",
        args: ["hello"],
        quoted: quoted("628222@s.whatsapp.net"),
      }),
    );
    expect(retry).toBe("✅ Confession delivered.");
  });
});
