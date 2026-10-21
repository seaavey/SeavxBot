import { describe, expect, test } from "bun:test";
import { parseConfig } from "@/lib/core/configSchema";

const minimal = {
  bot_name: "Bot",
  prefixes: ["!"],
  owners: ["628123456789"],
};

describe("parseConfig", () => {
  test("accepts a minimal config and fills defaults", () => {
    const cfg = parseConfig(minimal);
    expect(cfg.bot_name).toBe("Bot");
    expect(cfg.auth.dir).toBe("auth_info");
    expect(cfg.logging.level).toBe("warn");
  });

  test("rejects a non-object file", () => {
    expect(() => parseConfig(null)).toThrow("empty or not a TOML object");
  });

  test("names every missing key at once", () => {
    expect(() => parseConfig({})).toThrow(
      /bot_name[\s\S]*prefixes[\s\S]*owners/,
    );
  });

  test("rejects an unknown log level", () => {
    expect(() =>
      parseConfig({ ...minimal, logging: { level: "loud" } }),
    ).toThrow("logging.level must be one of");
  });

  test("rejects a non-boolean read_message", () => {
    expect(() =>
      parseConfig({ ...minimal, features: { read_message: "yes" } }),
    ).toThrow("features.read_message must be true or false");
  });

  test("rejects an owner that is not a phone number", () => {
    expect(() => parseConfig({ ...minimal, owners: ["seaavey"] })).toThrow(
      "phone number",
    );
  });

  test("keeps the custom messages", () => {
    const cfg = parseConfig({
      ...minimal,
      messages: { owner_only: "nope" },
    });
    expect(cfg.messages?.owner_only).toBe("nope");
  });
});
