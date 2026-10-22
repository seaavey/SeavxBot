import { describe, expect, test } from "bun:test";
import {
  clueTokens,
  clueWordCount,
  containsSecret,
  EDGE_PUNCTUATION,
  normalizeSecretWord,
  pickFrom,
  pickWordPair,
  WORD_PAIRS,
} from "@/lib/games/undercover/word";

describe("normalizeSecretWord", () => {
  test("lowercases with a locale-independent casing", () => {
    expect(normalizeSecretWord("KOPI")).toBe("kopi");
    expect(normalizeSecretWord("Kopi")).toBe("kopi");
    expect(normalizeSecretWord("kopi")).toBe("kopi");
  });

  test("applies NFKC so full-width Latin folds", () => {
    expect(normalizeSecretWord("ＫＯＰＩ")).toBe("kopi");
  });

  test("keeps diacritics distinct", () => {
    expect(normalizeSecretWord("Café")).toBe("café");
    expect(normalizeSecretWord("Cafe")).not.toBe(normalizeSecretWord("Café"));
  });

  test("collapses every Unicode whitespace run to one space", () => {
    expect(normalizeSecretWord("  Es   Teh  ")).toBe("es teh");
    expect(normalizeSecretWord("es\tteh")).toBe("es teh");
    expect(normalizeSecretWord("es\nteh")).toBe("es teh");
    expect(normalizeSecretWord("es\u00A0teh")).toBe("es teh");
  });

  test("strips ASCII and Unicode punctuation at the edges", () => {
    expect(normalizeSecretWord("Kopi!")).toBe("kopi");
    expect(normalizeSecretWord("...kopi...")).toBe("kopi");
    expect(normalizeSecretWord("“Kopi!”")).toBe("kopi");
    expect(normalizeSecretWord("_Kopi_")).toBe("kopi");
  });

  test("keeps punctuation that sits inside the word", () => {
    expect(normalizeSecretWord("Ice-Cream")).toBe("ice-cream");
    expect(normalizeSecretWord("don't")).toBe("don't");
    expect(normalizeSecretWord("don't")).not.toBe(normalizeSecretWord("dont"));
  });

  test("preserves symbols and emoji", () => {
    expect(normalizeSecretWord("$Kopi$")).toBe("$kopi$");
    expect(normalizeSecretWord("🔥Kopi🔥")).toBe("🔥kopi🔥");
  });

  test("returns an empty form for empty or punctuation-only input", () => {
    expect(normalizeSecretWord("")).toBe("");
    expect(normalizeSecretWord("   ")).toBe("");
    expect(normalizeSecretWord("!!!")).toBe("");
    expect(normalizeSecretWord("…_)).")).toBe("");
  });

  test("uses one shared edge-punctuation constant", () => {
    expect(EDGE_PUNCTUATION.test("(kopi)")).toBe(true);
    EDGE_PUNCTUATION.lastIndex = 0;
  });
});

describe("strict exact matching", () => {
  const matches = (guess: string, secret: string): boolean =>
    normalizeSecretWord(guess) === normalizeSecretWord(secret);

  test("accepts the same word in another casing or spacing", () => {
    expect(matches("KOPI", "Kopi")).toBe(true);
    expect(matches(" kopi ", "Kopi")).toBe(true);
    expect(matches("“Kopi!”", "Kopi")).toBe(true);
    expect(matches("es   teh", "Es Teh")).toBe(true);
  });

  test("rejects near misses, phrases, symbols and other languages", () => {
    expect(matches("Kopii", "Kopi")).toBe(false);
    expect(matches("Minuman kopi", "Kopi")).toBe(false);
    expect(matches("Coffee", "Kopi")).toBe(false);
    expect(matches("Kopi susu", "Kopi")).toBe(false);
    expect(matches("Café", "Cafe")).toBe(false);
    expect(matches("Ice-Cream", "Ice Cream")).toBe(false);
    expect(matches("$Kopi$", "Kopi")).toBe(false);
    expect(matches("🔥Kopi🔥", "Kopi")).toBe(false);
  });
});

describe("clue tokens", () => {
  test("counts whitespace-separated words", () => {
    expect(clueWordCount("hitam pahit")).toBe(2);
    expect(clueWordCount("kopi hitam pahit")).toBe(3);
    expect(clueWordCount("hitam pahit enak sekali")).toBe(4);
    expect(clueWordCount("")).toBe(0);
  });

  test("does not count a punctuation-only token as a word", () => {
    expect(clueWordCount("kopi !!!")).toBe(1);
    expect(clueTokens("kopi !!!")).toEqual(["kopi"]);
  });

  test("normalizes each token", () => {
    expect(clueTokens("KOPI, Pahit!")).toEqual(["kopi", "pahit"]);
  });
});

describe("containsSecret", () => {
  test("rejects a clue that holds the word as a whole token", () => {
    expect(containsSecret("kopi hitam pahit", "Kopi")).toBe(true);
    expect(containsSecret("ini kopi", "Kopi")).toBe(true);
    expect(containsSecret("kopi!", "Kopi")).toBe(true);
    expect(containsSecret("KOPI enak", "Kopi")).toBe(true);
  });

  test("rejects a multi-word secret only as a contiguous run", () => {
    expect(containsSecret("es teh manis", "Es Teh")).toBe(true);
    expect(containsSecret("teh es", "Es Teh")).toBe(false);
    expect(containsSecret("es-teh", "Es Teh")).toBe(false);
  });

  test("accepts a clue that does not contain the word", () => {
    expect(containsSecret("hitam pahit", "Kopi")).toBe(false);
    expect(containsSecret("pahit, hitam", "Kopi")).toBe(false);
  });

  test("is false when either side is empty", () => {
    expect(containsSecret("", "Kopi")).toBe(false);
    expect(containsSecret("kopi", "")).toBe(false);
    expect(containsSecret("!!!", "Kopi")).toBe(false);
  });
});

describe("word bank", () => {
  test("every pair is short, non-empty and different", () => {
    expect(WORD_PAIRS.length).toBeGreaterThanOrEqual(20);

    for (const pair of WORD_PAIRS) {
      expect(pair.civilian.codePointAt(0)).toBeDefined();
      expect(normalizeSecretWord(pair.civilian)).not.toBe("");
      expect(normalizeSecretWord(pair.undercover)).not.toBe("");
      expect(normalizeSecretWord(pair.civilian)).not.toBe(
        normalizeSecretWord(pair.undercover),
      );
    }
  });

  test("ids are unique", () => {
    const ids = WORD_PAIRS.map((pair) => pair.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("picks uniformly without repeating the avoided pair", () => {
    const avoid = WORD_PAIRS[0]!.id;
    for (const value of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(pickWordPair(() => value, avoid)?.id).not.toBe(avoid);
    }
  });

  test("falls back to the avoided pair when it is the only one left", () => {
    const only = WORD_PAIRS[0]!;
    expect(pickFrom([only], () => 0, only.id)).toEqual(only);
  });

  test("returns null when the bank is empty", () => {
    expect(pickFrom([], () => 0)).toBeNull();
    expect(pickFrom([], () => 0, "kopi-teh")).toBeNull();
  });
});
