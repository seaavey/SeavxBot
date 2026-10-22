import { describe, expect, test } from "bun:test";
import {
  assignRoles,
  countLiving,
  evaluateWin,
  FACTION,
  getComposition,
  kill,
  livingPlayers,
  nightVictim,
  tallyVotes,
  type Player,
  type Role,
  type Session,
} from "@/lib/games/werewolf/rules";

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

function makeRoster(count: number): Player[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    pn: `${index + 1}@s.whatsapp.net`,
    lid: `lid${index + 1}`,
    name: `P${index + 1}`,
    number: index + 1,
    status: "alive" as const,
  }));
}

function makeSession(roles: Role[]): Session {
  const players = makeRoster(roles.length);
  for (const [index, player] of players.entries()) {
    player.role = roles[index];
  }

  return {
    id: "game",
    groupJid: "1@g.us",
    prefix: ".",
    hostId: "p1",
    phase: "NIGHT_ACTIONS",
    round: 1,
    players,
    night: new Map(),
    votes: new Map(),
    tied: [],
    deadline: 0,
    deaths: [],
  };
}

const VILLAGERS: Role[] = ["VILLAGER", "VILLAGER", "VILLAGER", "VILLAGER"];

describe("composition", () => {
  test("getComposition returns the documented table", () => {
    expect(getComposition(5)).toEqual({
      werewolf: 1,
      seer: 1,
      doctor: 1,
      villager: 2,
    });
    expect(getComposition(6)).toEqual({
      werewolf: 2,
      seer: 1,
      doctor: 1,
      villager: 2,
    });
    expect(getComposition(9)).toEqual({
      werewolf: 3,
      seer: 1,
      doctor: 1,
      villager: 4,
    });
    expect(getComposition(12)).toEqual({
      werewolf: 4,
      seer: 1,
      doctor: 1,
      villager: 6,
    });
  });

  test("getComposition throws outside 5..12", () => {
    expect(() => getComposition(4)).toThrow();
    expect(() => getComposition(13)).toThrow();
    expect(() => getComposition(7.5)).toThrow();
  });

  test("every row keeps the village ahead of parity", () => {
    for (let count = 5; count <= 12; count += 1) {
      const row = getComposition(count);
      const village = row.seer + row.doctor + row.villager;
      expect(row.werewolf + village).toBe(count);
      expect(row.werewolf).toBeGreaterThanOrEqual(1);
      expect(village).toBeGreaterThanOrEqual(row.werewolf + 1);
    }
  });
});

describe("assignRoles", () => {
  test("assignRoles deals the exact multiset once", () => {
    const players = makeRoster(7);
    assignRoles(players, seededRandom(3));

    const roles = players.map((player) => player.role);
    expect(roles.filter((role) => role === "WEREWOLF")).toHaveLength(2);
    expect(roles.filter((role) => role === "SEER")).toHaveLength(1);
    expect(roles.filter((role) => role === "DOCTOR")).toHaveLength(1);
    expect(roles.filter((role) => role === "VILLAGER")).toHaveLength(3);
    expect(roles.every((role) => role !== undefined)).toBe(true);
  });

  test("assignRoles is deterministic under a seed", () => {
    const first = makeRoster(8);
    const second = makeRoster(8);
    assignRoles(first, seededRandom(11));
    assignRoles(second, seededRandom(11));

    expect(first.map((player) => player.role)).toEqual(
      second.map((player) => player.role),
    );
    expect(first.every((player) => FACTION[player.role ?? "VILLAGER"])).toBe(
      true,
    );
  });
});

describe("nightVictim", () => {
  test("nightVictim returns the unique plurality", () => {
    const session = makeSession(["WEREWOLF", "WEREWOLF", ...VILLAGERS, "SEER"]);

    expect(
      nightVictim(
        session,
        new Map([
          ["p1", "p3"],
          ["p2", "p3"],
        ]),
      ),
    ).toBe("p3");
  });

  test("nightVictim returns null on a tie", () => {
    const session = makeSession(["WEREWOLF", "WEREWOLF", ...VILLAGERS]);

    expect(
      nightVictim(
        session,
        new Map([
          ["p1", "p3"],
          ["p2", "p4"],
        ]),
      ),
    ).toBeNull();
  });

  test("nightVictim returns null with no votes", () => {
    expect(
      nightVictim(makeSession(["WEREWOLF", ...VILLAGERS]), new Map()),
    ).toBe(null);
  });

  test("nightVictim ignores a dead wolf", () => {
    const session = makeSession(["WEREWOLF", "WEREWOLF", ...VILLAGERS]);
    const dead = session.players[1];
    if (!dead) throw new Error("fixture lost a player");
    dead.status = "dead";

    expect(
      nightVictim(
        session,
        new Map([
          ["p2", "p4"],
          ["p1", "p3"],
        ]),
      ),
    ).toBe("p3");
  });

  test("nightVictim drops a vote for a werewolf", () => {
    const session = makeSession(["WEREWOLF", "WEREWOLF", ...VILLAGERS]);

    expect(nightVictim(session, new Map([["p1", "p2"]]))).toBeNull();
  });
});

describe("tallyVotes", () => {
  test("tallyVotes counts a unique top", () => {
    const session = makeSession(VILLAGERS);
    const { counts, leaders } = tallyVotes(
      session,
      new Map([
        ["p1", "p2"],
        ["p2", "p2"],
        ["p3", "p4"],
      ]),
    );

    expect(counts.get("p2")).toBe(2);
    expect(counts.get("p4")).toBe(1);
    expect(leaders).toEqual(["p2"]);
  });

  test("tallyVotes returns every leader on a tie", () => {
    const session = makeSession(VILLAGERS);
    const { leaders } = tallyVotes(
      session,
      new Map([
        ["p1", "p2"],
        ["p2", "p3"],
      ]),
    );

    expect([...leaders].sort()).toEqual(["p2", "p3"]);
  });

  test("tallyVotes ignores a dead voter and a dead target", () => {
    const session = makeSession(VILLAGERS);
    kill(session, "p1", "NIGHT", 1);
    kill(session, "p4", "NIGHT", 1);

    const { counts, leaders } = tallyVotes(
      session,
      new Map([
        ["p1", "p2"],
        ["p2", "p4"],
      ]),
    );

    expect(counts.size).toBe(0);
    expect(leaders).toEqual([]);
  });

  test("tallyVotes respects an allowed set", () => {
    const session = makeSession(VILLAGERS);
    const { counts, leaders } = tallyVotes(
      session,
      new Map([
        ["p1", "p2"],
        ["p2", "p3"],
        ["p3", "p3"],
      ]),
      new Set(["p3"]),
    );

    expect(counts.get("p2")).toBeUndefined();
    expect(counts.get("p3")).toBe(2);
    expect(leaders).toEqual(["p3"]);
  });
});

describe("evaluateWin", () => {
  test("evaluateWin: village wins when the last wolf dies", () => {
    const session = makeSession(["WEREWOLF", "VILLAGER", "SEER"]);
    expect(evaluateWin(session)).toBeNull();

    kill(session, "p1", "VOTE", 1);

    expect(evaluateWin(session)).toEqual({ type: "WIN", team: "VILLAGE" });
  });

  test("evaluateWin: wolves win at parity", () => {
    const session = makeSession(["WEREWOLF", "VILLAGER"]);

    expect(countLiving(session)).toEqual({ werewolf: 1, village: 1 });
    expect(evaluateWin(session)).toEqual({ type: "WIN", team: "WEREWOLF" });
  });

  test("evaluateWin: wolves win with a majority", () => {
    const session = makeSession(["WEREWOLF", "WEREWOLF", "VILLAGER"]);

    expect(evaluateWin(session)).toEqual({ type: "WIN", team: "WEREWOLF" });
  });

  test("evaluateWin: draw when nobody is alive", () => {
    const session = makeSession(["WEREWOLF", "VILLAGER"]);
    kill(session, "p1", "NIGHT", 1);
    kill(session, "p2", "NIGHT", 1);

    expect(livingPlayers(session)).toEqual([]);
    expect(evaluateWin(session)).toEqual({ type: "DRAW", reason: "NO_LIVING" });
  });

  test("evaluateWin: no outcome while both factions live", () => {
    const session = makeSession(["WEREWOLF", "VILLAGER", "VILLAGER"]);

    expect(evaluateWin(session)).toBeNull();
  });
});

describe("kill", () => {
  test("kill marks a player dead once and records the cause", () => {
    const session = makeSession(["WEREWOLF", ...VILLAGERS]);
    const victim = kill(session, "p2", "NIGHT", 1);

    expect(victim?.status).toBe("dead");
    expect(session.deaths).toEqual([
      { number: 2, name: "P2", role: "VILLAGER", cause: "NIGHT", round: 1 },
    ]);

    expect(kill(session, "p2", "NIGHT", 1)).toBeNull();
    expect(session.deaths).toHaveLength(1);
  });

  test("kill refuses a player who is not alive", () => {
    const session = makeSession(VILLAGERS);
    const player = session.players[0];
    if (!player) throw new Error("fixture lost a player");
    player.status = "dead";

    expect(kill(session, "p1", "VOTE", 2)).toBeNull();
    expect(kill(session, "missing", "VOTE", 2)).toBeNull();
    expect(session.deaths).toHaveLength(0);
  });
});
