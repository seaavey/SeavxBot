import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createUserGroupsStore } from "@/lib/group/userGroups";

function freshStore() {
  return createUserGroupsStore(new Database(":memory:"));
}

describe("userGroups store", () => {
  test("a fresh user has zero groups", () => {
    const store = freshStore();
    expect(store.count("628111@s.whatsapp.net")).toBe(0);
  });

  test("add increments the count and has reflects it", () => {
    const store = freshStore();
    store.add("628111@s.whatsapp.net", "123@g.us");
    expect(store.count("628111@s.whatsapp.net")).toBe(1);
    expect(store.has("628111@s.whatsapp.net", "123@g.us")).toBe(true);
    store.add("628111@s.whatsapp.net", "456@g.us");
    expect(store.count("628111@s.whatsapp.net")).toBe(2);
  });

  test("adding the same group twice does not double-count", () => {
    const store = freshStore();
    store.add("628111@s.whatsapp.net", "123@g.us");
    store.add("628111@s.whatsapp.net", "123@g.us");
    expect(store.count("628111@s.whatsapp.net")).toBe(1);
  });

  test("counts are isolated per user", () => {
    const store = freshStore();
    store.add("628111@s.whatsapp.net", "123@g.us");
    expect(store.count("628222@s.whatsapp.net")).toBe(0);
  });
});
