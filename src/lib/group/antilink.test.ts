import { describe, expect, test } from "bun:test";
import { containsGroupLink } from "@/lib/group/antilink";

describe("containsGroupLink", () => {
  test("chat.whatsapp.com invite", () => {
    expect(containsGroupLink("https://chat.whatsapp.com/ABC123")).toBe(true);
    expect(containsGroupLink("chat.whatsapp.com/invite/ABC123")).toBe(true);
  });

  test("wa.me share link with a number", () => {
    expect(containsGroupLink("https://wa.me/628123456789")).toBe(true);
  });

  test("api.whatsapp.com send link", () => {
    expect(
      containsGroupLink("https://api.whatsapp.com/send?phone=628123456789"),
    ).toBe(true);
  });

  test("wa.me settings link", () => {
    expect(containsGroupLink("https://wa.me/settings/username")).toBe(true);
  });

  test("unrelated links are allowed", () => {
    expect(containsGroupLink("https://example.com/ABC")).toBe(false);
    expect(containsGroupLink("hello world")).toBe(false);
    expect(containsGroupLink("wa.me")).toBe(false);
  });
});
