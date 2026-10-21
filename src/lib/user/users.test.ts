import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createUserStore, USERS_TABLE_SQL } from "@/lib/user/users";

const fresh = () => {
  const db = new Database(":memory:");
  db.exec(USERS_TABLE_SQL);
  return createUserStore(db);
};

describe("user store", () => {
  test("touch creates a row and counts", () => {
    const users = fresh();
    users.touch({ jid: "628@s.whatsapp.net", name: "A" }, false);
    users.touch({ jid: "628@s.whatsapp.net", name: "A" }, true);

    const user = users.get("628@s.whatsapp.net");
    expect(user?.messageCount).toBe(2);
    expect(user?.commandCount).toBe(1);
    expect(users.count()).toBe(1);
  });

  test("a group jid never becomes a user", () => {
    const users = fresh();
    users.touch({ jid: "123@g.us" }, true);
    users.ensure({ jid: "123@g.us" });
    expect(users.count()).toBe(0);
  });

  test("a LID-first row adopts the phone number", () => {
    const users = fresh();
    users.touch({ jid: "999@lid", lid: "999@lid" }, false);
    users.touch({ jid: "628@s.whatsapp.net", lid: "999@lid" }, false);

    expect(users.count()).toBe(1);
    const user = users.get("628@s.whatsapp.net");
    expect(user?.lid).toBe("999@lid");
    expect(user?.messageCount).toBe(2);
  });

  test("premium grant, permanent grant and revoke", () => {
    const users = fresh();
    users.grantPremium("628@s.whatsapp.net", null, "owner");
    expect(users.get("628@s.whatsapp.net")?.role).toBe("premium");

    users.grantPremium("628@s.whatsapp.net", Date.now() - 1, "owner");
    expect(users.get("628@s.whatsapp.net")?.role).toBe("free");

    users.grantPremium("628@s.whatsapp.net", Date.now() + 60_000, "owner");
    expect(users.get("628@s.whatsapp.net")?.role).toBe("premium");

    users.revokePremium("628@s.whatsapp.net");
    expect(users.get("628@s.whatsapp.net")?.role).toBe("free");
  });

  test("ensurePremium does not rewrite a permanent grant", () => {
    const users = fresh();
    const first = users.ensurePremium("628@s.whatsapp.net", "owner");
    const second = users.ensurePremium("628@s.whatsapp.net", "other");
    expect(second.premiumSince).toBe(first.premiumSince);
    expect(second.premiumGrantedBy).toBe("owner");
  });

  test("list is ordered by last activity", () => {
    const users = fresh();
    users.touch({ jid: "1@s.whatsapp.net" }, false);
    users.touch({ jid: "2@s.whatsapp.net" }, false);
    users.touch({ jid: "1@s.whatsapp.net" }, false);
    expect(users.list(10)[0]?.jid).toBe("1@s.whatsapp.net");
  });
});
