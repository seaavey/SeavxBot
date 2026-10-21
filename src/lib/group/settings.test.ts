import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  createSettingsStore,
  SETTINGS_TABLE_SQL,
  type SettingsStore,
} from "@/lib/group/settings";

const DEFAULTS = { welcome_text: "hi {name}", goodbye_text: "bye {name}" };

function store(): { db: Database; settings: SettingsStore } {
  const db = new Database(":memory:");
  db.exec(SETTINGS_TABLE_SQL);
  return { db, settings: createSettingsStore(db, DEFAULTS) };
}

describe("group settings store", () => {
  test("starts from the config defaults", () => {
    const { settings } = store();
    expect(settings.get("1@g.us")).toEqual({
      welcome: false,
      welcome_text: "hi {name}",
      goodbye: false,
      goodbye_text: "bye {name}",
      antilink: "off",
    });
  });

  test("a written key survives a re-read", () => {
    const { settings } = store();
    settings.set("1@g.us", "antilink", "delete");
    settings.set("1@g.us", "welcome", true);
    expect(settings.get("1@g.us").antilink).toBe("delete");
    expect(settings.get("1@g.us").welcome).toBe(true);
  });

  test("settings are per group", () => {
    const { settings } = store();
    settings.set("1@g.us", "welcome", true);
    expect(settings.get("2@g.us").welcome).toBe(false);
  });

  test("a stored value that fails its guard falls back to the default", () => {
    const { db, settings } = store();
    db.query(
      "INSERT INTO group_settings (jid, key, value) VALUES (?, ?, ?)",
    ).run("1@g.us", "antilink", JSON.stringify("nonsense"));
    db.query(
      "INSERT INTO group_settings (jid, key, value) VALUES (?, ?, ?)",
    ).run("1@g.us", "welcome", "not json");
    expect(settings.get("1@g.us").antilink).toBe("off");
    expect(settings.get("1@g.us").welcome).toBe(false);
  });

  test("an unknown key is ignored", () => {
    const { db, settings } = store();
    db.query(
      "INSERT INTO group_settings (jid, key, value) VALUES (?, ?, ?)",
    ).run("1@g.us", "future_key", JSON.stringify(true));
    expect(settings.get("1@g.us")).not.toHaveProperty("future_key");
  });

  test("the cache hands out copies", () => {
    const { settings } = store();
    const first = settings.get("1@g.us");
    first.antilink = "delete";
    expect(settings.get("1@g.us").antilink).toBe("off");
  });
});
