import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  createWerewolfStore,
  WEREWOLF_TABLE_SQL,
} from "@/lib/games/werewolf/store";

function store() {
  const db = new Database(":memory:");
  db.exec(WEREWOLF_TABLE_SQL);
  return { db, werewolf: createWerewolfStore(db) };
}

describe("werewolf store", () => {
  test("saves and lists a live session", () => {
    const { werewolf } = store();
    werewolf.save("1@g.us", "2@s.whatsapp.net", "LOBBY", 1);

    expect(werewolf.listLive()).toEqual([
      { groupJid: "1@g.us", hostJid: "2@s.whatsapp.net" },
    ]);
  });

  test("save twice upserts phase and round", () => {
    const { db, werewolf } = store();
    werewolf.save("1@g.us", "2@s.whatsapp.net", "LOBBY", 1);
    werewolf.save("1@g.us", "3@s.whatsapp.net", "NIGHT_ACTIONS", 4);

    expect(
      db
        .query("SELECT phase, round FROM werewolf_sessions WHERE group_jid = ?")
        .get("1@g.us"),
    ).toEqual({ phase: "NIGHT_ACTIONS", round: 4 });
    expect(
      db.query("SELECT COUNT(*) AS count FROM werewolf_sessions").get(),
    ).toEqual({ count: 1 });
  });

  test("drop removes the row", () => {
    const { werewolf } = store();
    werewolf.save("1@g.us", "2@s.whatsapp.net", "LOBBY", 1);
    werewolf.drop("1@g.us");

    expect(werewolf.listLive()).toEqual([]);
  });

  test("an empty list and a missing drop are safe", () => {
    const { werewolf } = store();

    expect(werewolf.listLive()).toEqual([]);
    expect(() => werewolf.drop("unknown@g.us")).not.toThrow();
  });

  test("the table survives being created twice", () => {
    const { db } = store();

    expect(() => db.exec(WEREWOLF_TABLE_SQL)).not.toThrow();
  });
});
