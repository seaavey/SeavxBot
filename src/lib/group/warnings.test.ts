import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createWarningsStore } from "@/lib/group/warnings";

function freshStore() {
  return createWarningsStore(new Database(":memory:"));
}

describe("warnings store", () => {
  test("a fresh member has zero warnings", () => {
    const store = freshStore();
    expect(store.get("123@g.us", "628111@s.whatsapp.net")).toBe(0);
  });

  test("increment raises the count and get reflects it", () => {
    const store = freshStore();
    expect(store.increment("123@g.us", "628111@s.whatsapp.net")).toBe(1);
    expect(store.get("123@g.us", "628111@s.whatsapp.net")).toBe(1);
    expect(store.increment("123@g.us", "628111@s.whatsapp.net")).toBe(2);
    expect(store.get("123@g.us", "628111@s.whatsapp.net")).toBe(2);
  });

  test("reset brings the count back to zero", () => {
    const store = freshStore();
    store.increment("123@g.us", "628111@s.whatsapp.net");
    store.reset("123@g.us", "628111@s.whatsapp.net");
    expect(store.get("123@g.us", "628111@s.whatsapp.net")).toBe(0);
    expect(store.increment("123@g.us", "628111@s.whatsapp.net")).toBe(1);
  });

  test("counts are isolated per group and per member", () => {
    const store = freshStore();
    store.increment("123@g.us", "628111@s.whatsapp.net");
    store.increment("456@g.us", "628111@s.whatsapp.net");
    expect(store.get("123@g.us", "628111@s.whatsapp.net")).toBe(1);
    expect(store.get("456@g.us", "628111@s.whatsapp.net")).toBe(1);
    expect(store.get("123@g.us", "628222@s.whatsapp.net")).toBe(0);
  });
});
