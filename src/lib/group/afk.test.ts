import { describe, expect, test } from "bun:test";
import type { GroupMetadata } from "@whiskeysockets/baileys";
import type { ParsedMessage } from "@/lib/message/parseMessage";
import { afkNotice, applyAfk, clearAfk } from "@/lib/group/afk";

const META = {
  participants: [
    { id: "999111@lid", phoneNumber: "628111@s.whatsapp.net" },
    { id: "999222@lid", phoneNumber: "628222@s.whatsapp.net" },
    { id: "999333@lid", phoneNumber: "628333@s.whatsapp.net" },
  ],
} as unknown as GroupMetadata;

function msg(fields: Partial<ParsedMessage>): ParsedMessage {
  return {
    chatJid: "1@g.us",
    senderJid: "628111@s.whatsapp.net",
    senderLid: "",
    text: "",
    isGroup: true,
    isCmd: false,
    mentions: [],
    groupMetadata: META,
    ...fields,
  } as unknown as ParsedMessage;
}

describe("afk", () => {
  test("stores the default reason when no text is given", () => {
    expect(applyAfk(msg({ chatJid: "default@g.us" }))).toBe(
      "💤 AFK set — No reason given.",
    );
  });

  test("off stores nothing and only confirms the clear", () => {
    const chat = "off@g.us";
    expect(applyAfk(msg({ chatJid: chat, text: "off" }))).toBe(
      "✅ AFK cleared.",
    );

    const notice = afkNotice(
      msg({
        chatJid: chat,
        senderJid: "628999@s.whatsapp.net",
        mentions: ["628111@s.whatsapp.net"],
      }),
    );
    expect(notice).toBeUndefined();
  });

  test("caps the reason at 100 characters", () => {
    expect(applyAfk(msg({ chatJid: "cap@g.us", text: "x".repeat(150) }))).toBe(
      `💤 AFK set — ${"x".repeat(100)}`,
    );
  });

  test("collapses a PN stanza and a LID stanza onto one row", () => {
    const chat = "collapse@g.us";
    applyAfk(
      msg({
        chatJid: chat,
        senderJid: "628111@s.whatsapp.net",
        text: "first",
      }),
    );
    applyAfk(
      msg({
        chatJid: chat,
        senderJid: "999111@lid",
        senderLid: "999111@lid",
        text: "second",
      }),
    );

    const notice = afkNotice(
      msg({
        chatJid: chat,
        senderJid: "628999@s.whatsapp.net",
        mentions: ["628111@s.whatsapp.net", "999111@lid"],
      }),
    );
    expect(notice?.text).toBe("💤 @628111 is AFK — second");
    expect(notice?.mentions).toEqual(["628111@s.whatsapp.net"]);
  });

  test("matches a LID mention against a PN-keyed entry", () => {
    const chat = "lidmention@g.us";
    applyAfk(
      msg({
        chatJid: chat,
        senderJid: "999222@lid",
        senderLid: "999222@lid",
        text: "brb",
      }),
    );

    const notice = afkNotice(
      msg({
        chatJid: chat,
        senderJid: "628999@s.whatsapp.net",
        mentions: ["999222@lid"],
      }),
    );
    expect(notice?.text).toBe("💤 @999222 is AFK — brb");
    expect(notice?.mentions).toEqual(["999222@lid"]);
  });

  test("keeps the status per group", () => {
    applyAfk(msg({ chatJid: "g1@g.us", text: "away" }));

    const notice = afkNotice(
      msg({
        chatJid: "g2@g.us",
        senderJid: "628999@s.whatsapp.net",
        mentions: ["628111@s.whatsapp.net"],
      }),
    );
    expect(notice).toBeUndefined();
  });

  test("a message from the sender clears the status", () => {
    const chat = "clear@g.us";
    applyAfk(msg({ chatJid: chat, text: "away" }));
    clearAfk(msg({ chatJid: chat, text: "back" }));

    const notice = afkNotice(
      msg({
        chatJid: chat,
        senderJid: "628999@s.whatsapp.net",
        mentions: ["628111@s.whatsapp.net"],
      }),
    );
    expect(notice).toBeUndefined();
  });

  test("skips a command message", () => {
    const chat = "cmd@g.us";
    applyAfk(msg({ chatJid: chat, text: "away" }));

    const notice = afkNotice(
      msg({
        chatJid: chat,
        senderJid: "628999@s.whatsapp.net",
        isCmd: true,
        mentions: ["628111@s.whatsapp.net"],
      }),
    );
    expect(notice).toBeUndefined();
  });

  test("aggregates two AFK members into one notice", () => {
    const chat = "aggregate@g.us";
    applyAfk(
      msg({ chatJid: chat, senderJid: "628111@s.whatsapp.net", text: "one" }),
    );
    applyAfk(
      msg({ chatJid: chat, senderJid: "628222@s.whatsapp.net", text: "two" }),
    );

    const notice = afkNotice(
      msg({
        chatJid: chat,
        senderJid: "628999@s.whatsapp.net",
        mentions: ["628111@s.whatsapp.net", "628222@s.whatsapp.net"],
      }),
    );
    expect(notice?.text).toBe(
      "💤 @628111 is AFK — one\n💤 @628222 is AFK — two",
    );
    expect(notice?.mentions).toEqual([
      "628111@s.whatsapp.net",
      "628222@s.whatsapp.net",
    ]);
  });

  test("names the quoted author", () => {
    const chat = "quoted@g.us";
    applyAfk(
      msg({ chatJid: chat, senderJid: "628222@s.whatsapp.net", text: "lunch" }),
    );

    const notice = afkNotice(
      msg({
        chatJid: chat,
        senderJid: "628999@s.whatsapp.net",
        quoted: {
          senderJid: "628222@s.whatsapp.net",
        } as ParsedMessage["quoted"],
      }),
    );
    expect(notice?.text).toBe("💤 @628222 is AFK — lunch");
  });

  test("skips a self-mention", () => {
    const chat = "self@g.us";
    applyAfk(msg({ chatJid: chat, text: "away" }));

    const notice = afkNotice(
      msg({ chatJid: chat, mentions: ["628111@s.whatsapp.net"] }),
    );
    expect(notice).toBeUndefined();
  });
});
