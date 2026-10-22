import { describe, expect, test } from "bun:test";
import {
  activePlayers,
  assignRoles,
  countRole,
  evaluateWin,
  getRoleCounts,
  type Player,
  type Role,
  type Session,
} from "@/lib/games/undercover/rules";

/** Deterministic PRNG so a failing distribution is reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roster(size: number): Player[] {
  return Array.from({ length: size }, (_value, index) => ({
    id: `${index + 1}@s.whatsapp.net`,
    pn: `${index + 1}@s.whatsapp.net`,
    lid: "",
    name: `Player ${index + 1}`,
    number: index + 1,
    status: "active" as const,
  }));
}

function withRoles(roles: Role[]): Session {
  return {
    id: "session",
    groupJid: "1@g.us",
    prefix: ".",
    hostId: "1@s.whatsapp.net",
    phase: "CLUE_PHASE",
    round: 1,
    players: roles.map((role, index) => ({
      ...roster(1)[0]!,
      id: `${index + 1}@s.whatsapp.net`,
      pn: `${index + 1}@s.whatsapp.net`,
      number: index + 1,
      role,
    })),
    turnOrder: roles.map((_role, index) => `${index + 1}@s.whatsapp.net`),
    turn: 0,
    clues: [],
    revoted: false,
    tied: [],
    deadline: 0,
    eliminations: [],
  };
}

describe("getRoleCounts", () => {
  const TABLE: [number, number, number, number][] = [
    [5, 3, 1, 1],
    [6, 4, 1, 1],
    [7, 4, 2, 1],
    [8, 5, 2, 1],
    [9, 6, 2, 1],
    [10, 6, 3, 1],
    [11, 7, 3, 1],
    [12, 8, 3, 1],
  ];

  test("matches the reference table for every valid player count", () => {
    for (const [players, civilian, undercover, mrWhite] of TABLE) {
      expect(getRoleCounts(players)).toEqual({ civilian, undercover, mrWhite });
    }
  });

  test("keeps the invariants for every valid player count", () => {
    for (const [players] of TABLE) {
      const counts = getRoleCounts(players);
      expect(counts.civilian + counts.undercover + counts.mrWhite).toBe(
        players,
      );
      expect(counts.mrWhite).toBe(1);
      expect(counts.undercover).toBeGreaterThanOrEqual(1);
      expect(counts.civilian).toBeGreaterThanOrEqual(1);
    }
  });

  test("rejects counts outside 5..12 and non-integers", () => {
    for (const bad of [0, 4, 13, 5.5, Number.NaN]) {
      expect(() => getRoleCounts(bad)).toThrow();
    }
  });
});

describe("assignRoles", () => {
  test("gives every player exactly one role and one Mr. White", () => {
    for (let size = 5; size <= 12; size += 1) {
      const players = roster(size);
      assignRoles(players, seeded(size));

      expect(players.every((player) => player.role !== undefined)).toBe(true);
      expect(players.filter((p) => p.role === "MR_WHITE")).toHaveLength(1);

      const counts = getRoleCounts(size);
      expect(players.filter((p) => p.role === "CIVILIAN")).toHaveLength(
        counts.civilian,
      );
      expect(players.filter((p) => p.role === "UNDERCOVER")).toHaveLength(
        counts.undercover,
      );
    }
  });

  test("is driven by the injected random, not Math.random", () => {
    const first = roster(8);
    const second = roster(8);
    assignRoles(first, seeded(7));
    assignRoles(second, seeded(7));

    expect(first.map((p) => p.role)).toEqual(second.map((p) => p.role));
  });

  test("leaves assigned roles alone when the round advances", () => {
    const players = roster(12);
    assignRoles(players, seeded(3));
    const before = players.map((player) => player.role);

    const session = withRoles([]);
    session.players = players;
    session.round += 1;
    evaluateWin(session);

    expect(players.map((player) => player.role)).toEqual(before);
  });
});

describe("counts", () => {
  test("counts only active players", () => {
    const session = withRoles([
      "CIVILIAN",
      "CIVILIAN",
      "UNDERCOVER",
      "MR_WHITE",
    ]);
    session.players[0]!.status = "eliminated";
    session.players[3]!.status = "departed";

    expect(activePlayers(session)).toHaveLength(2);
    expect(countRole(session, "CIVILIAN")).toBe(1);
    expect(countRole(session, "UNDERCOVER")).toBe(1);
    expect(countRole(session, "MR_WHITE")).toBe(0);
  });
});

describe("evaluateWin", () => {
  test("civilians win once no undercover or Mr. White is active", () => {
    const session = withRoles([
      "CIVILIAN",
      "CIVILIAN",
      "UNDERCOVER",
      "MR_WHITE",
    ]);
    session.players[2]!.status = "eliminated";
    session.players[3]!.status = "eliminated";

    expect(evaluateWin(session)).toEqual({ type: "WIN", team: "CIVILIAN" });
  });

  test("civilians do not win while Mr. White is still active", () => {
    const session = withRoles([
      "CIVILIAN",
      "CIVILIAN",
      "UNDERCOVER",
      "MR_WHITE",
    ]);
    session.players[2]!.status = "eliminated";

    expect(evaluateWin(session)).toBeNull();
  });

  test("undercover wins at parity and beyond", () => {
    const parity = withRoles(["CIVILIAN", "UNDERCOVER", "MR_WHITE"]);
    parity.players[2]!.status = "eliminated";
    expect(evaluateWin(parity)).toEqual({ type: "WIN", team: "UNDERCOVER" });

    const majority = withRoles(["CIVILIAN", "UNDERCOVER", "MR_WHITE"]);
    majority.players[0]!.status = "eliminated";
    expect(evaluateWin(majority)).toEqual({ type: "WIN", team: "UNDERCOVER" });
  });

  test("undercover does not win below parity", () => {
    const session = withRoles([
      "CIVILIAN",
      "CIVILIAN",
      "CIVILIAN",
      "UNDERCOVER",
      "MR_WHITE",
    ]);
    session.players[4]!.status = "eliminated";

    expect(evaluateWin(session)).toBeNull();
  });

  test("an empty table is a draw, not a victory", () => {
    const session = withRoles(["CIVILIAN", "UNDERCOVER", "MR_WHITE"]);
    for (const player of session.players) player.status = "departed";

    expect(evaluateWin(session)).toEqual({
      type: "DRAW",
      reason: "NO_ACTIVE_PLAYERS",
    });
  });

  test("returns null while both teams still have a live player", () => {
    const session = withRoles([
      "CIVILIAN",
      "CIVILIAN",
      "UNDERCOVER",
      "MR_WHITE",
    ]);
    session.players[3]!.status = "eliminated";

    expect(evaluateWin(session)).toBeNull();
  });
});
