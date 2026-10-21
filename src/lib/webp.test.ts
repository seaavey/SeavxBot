import { describe, expect, test } from "bun:test";
import { isAnimatedWebp } from "@/lib/webp";

const webp = (chunk: string, flags: number): Buffer =>
  Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBP"),
    Buffer.from(chunk),
    Buffer.from([10, 0, 0, 0, flags, 0, 0, 0, 255, 0, 0, 255, 0, 0]),
  ]);

describe("isAnimatedWebp", () => {
  test("VP8X animation flag set", () => {
    expect(isAnimatedWebp(webp("VP8X", 0x0a))).toBe(true);
  });

  test("VP8X without animation flag", () => {
    expect(isAnimatedWebp(webp("VP8X", 0x10))).toBe(false);
  });

  test("plain lossy WebP has no VP8X chunk", () => {
    expect(isAnimatedWebp(webp("VP8 ", 0x02))).toBe(false);
  });

  test("not a WebP", () => {
    expect(isAnimatedWebp(Buffer.from("GIF89a...."))).toBe(false);
  });
});
