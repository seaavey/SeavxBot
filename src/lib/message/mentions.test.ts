import { describe, expect, test } from "bun:test";
import { mentionPhones } from "@/lib/message/mentions";

const tagged = (input: string) => mentionPhones(input);

describe("mentionPhones", () => {
  test("plain number becomes a tag plus a mention", () => {
    expect(tagged("hallo 628123456789")).toEqual({
      text: "hallo @628123456789",
      mentions: ["628123456789@s.whatsapp.net"],
    });
  });

  test("+62 prefix is stripped", () => {
    expect(tagged("+628123456789")).toEqual({
      text: "@628123456789",
      mentions: ["628123456789@s.whatsapp.net"],
    });
  });

  test("0 prefix is normalized to 62", () => {
    expect(tagged("08123456789")).toEqual({
      text: "@628123456789",
      mentions: ["628123456789@s.whatsapp.net"],
    });
  });

  test("an existing tag is left alone", () => {
    expect(tagged("@628123456789")).toEqual({ text: "@628123456789" });
  });

  test("a wa.me link is left alone", () => {
    expect(tagged("https://wa.me/628123456789")).toEqual({
      text: "https://wa.me/628123456789",
    });
  });

  test("dashed numbers are not touched", () => {
    expect(tagged("0812-3456-7890")).toEqual({ text: "0812-3456-7890" });
  });

  test("two numbers get two mentions", () => {
    expect(tagged("628111111111 dan 628222222222").mentions).toHaveLength(2);
  });

  test("the same number twice is mentioned once", () => {
    expect(tagged("628123456789 628123456789")).toEqual({
      text: "@628123456789 @628123456789",
      mentions: ["628123456789@s.whatsapp.net"],
    });
  });

  test("plain text passes through", () => {
    expect(tagged("pong!")).toEqual({ text: "pong!" });
  });
});
