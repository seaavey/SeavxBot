import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  createUndercoverStore,
  UNDERCOVER_TABLE_SQL,
} from "@/lib/games/undercover/store";

function store() {
  const db = new Database(":memory:");
  db.exec(UNDERCOVER_TABLE_SQL);
  return { db, undercover: createUndercoverStore(db) };
}

describe("undercover store", () => {
  test("saves, lists, and drops a live session", () => {
    const { undercover } = store();
    undercover.save("1@g.us", "2@s.whatsapp.net", "LOBBY");
    expect(undercover.listLive()).toEqual([
      { groupJid: "1@g.us", hostJid: "2@s.whatsapp.net" },
    ]);

    undercover.drop("1@g.us");
    expect(undercover.listLive()).toEqual([]);
  });

  test("saving an existing session upserts its host and state", () => {
    const { db, undercover } = store();
    undercover.save("1@g.us", "2@s.whatsapp.net", "LOBBY");
    expect(() =>
      undercover.save("1@g.us", "3@s.whatsapp.net", "CLUE_PHASE"),
    ).not.toThrow();

    expect(undercover.listLive()).toEqual([
      { groupJid: "1@g.us", hostJid: "3@s.whatsapp.net" },
    ]);
    expect(
      db
        .query("SELECT state FROM undercover_sessions WHERE group_jid = ?")
        .get("1@g.us"),
    ).toEqual({ state: "CLUE_PHASE" });
    expect(
      db.query("SELECT COUNT(*) AS count FROM undercover_sessions").get(),
    ).toEqual({ count: 1 });
  });

  test("last pair round-trips and upserts", () => {
    const { db, undercover } = store();
    undercover.setLastPair("1@g.us", "kopi-teh");
    expect(undercover.lastPair("1@g.us")).toBe("kopi-teh");
    undercover.setLastPair("1@g.us", "es-teh-air-jeruk");
    expect(undercover.lastPair("1@g.us")).toBe("es-teh-air-jeruk");
    expect(
      db.query("SELECT COUNT(*) AS count FROM undercover_last_pair").get(),
    ).toEqual({ count: 1 });
  });

  test("unknown groups have no last pair", () => {
    const { undercover } = store();
    expect(undercover.lastPair("unknown@g.us")).toBeNull();
  });

  test("empty session lists and dropping a missing session are safe", () => {
    const { undercover } = store();
    expect(undercover.listLive()).toEqual([]);
    expect(() => undercover.drop("unknown@g.us")).not.toThrow();
  });
});
