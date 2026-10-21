import { describe, expect, test } from "bun:test";
import { extractFirstUrl } from "@/lib/media/extractUrl";

describe("extractFirstUrl", () => {
  test("finds an http url", () => {
    expect(extractFirstUrl("look https://example.com/a.jpg now")).toBe(
      "https://example.com/a.jpg",
    );
  });

  test("finds an https url without a path", () => {
    expect(extractFirstUrl("https://example.com")).toBe("https://example.com");
  });

  test("ignores non-http protocols", () => {
    expect(extractFirstUrl("mailto:a@b.c tel:123")).toBeNull();
  });

  test("ignores bare words and numbers", () => {
    expect(extractFirstUrl("628123456789 example.com")).toBeNull();
  });

  test("returns null for empty text", () => {
    expect(extractFirstUrl("")).toBeNull();
  });

  test("returns the first of several urls", () => {
    expect(extractFirstUrl("https://a.example https://b.example")).toBe(
      "https://a.example",
    );
  });
});
