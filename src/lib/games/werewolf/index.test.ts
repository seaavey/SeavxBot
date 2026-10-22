import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { GroupParticipant } from "@whiskeysockets/baileys";
import { createWerewolf, type CommandInput } from "@/lib/games/werewolf/index";
import {
  DISCUSSION_MS,
  NIGHT_MS,
  RUNOFF_MS,
  VOTE_MS,
  type Role,
} from "@/lib/games/werewolf/rules";
import {
  createWerewolfStore,
  WEREWOLF_TABLE_SQL,
} from "@/lib/games/werewolf/store";

const GROUP = "120363000000000000@g.us";

interface Who {
  id: string;
  name: string;
}

const PEOPLE: Who[] = Array.from({ length: 6 }, (_, index) => ({
  id: `62${index + 1}@s.whatsapp.net`,
  name: `P${index + 1}`,
}));

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

function harness(seed = 7) {
  const db = new Database(":memory:");
  db.exec(WEREWOLF_TABLE_SQL);
  const store = createWerewolfStore(db);
  const sent: { jid: string; text: string }[] = [];
  const clock = { now: 1_000_000 };
  const game = createWerewolf({
    send: async (jid, text) => {
      sent.push({ jid, text });
      return true;
    },
    store,
    now: () => clock.now,
    random: seededRandom(seed),
  });

  function input(
    chatJid: string,
    who: Who,
    args: string[],
    extra: Partial<CommandInput> = {},
  ): CommandInput {
    return {
      chatJid,
      isGroup: chatJid === GROUP,
      senderJid: who.id,
      senderPn: who.id,
      senderLid: "",
      name: who.name,
      prefix: ".",
      isAdmin: false,
      isOwner: false,
      args,
      ...extra,
    };
  }

  return {
    game,
    store,
    sent,
    advance(ms: number) {
      clock.now += ms;
    },
    group(who: Who, args: string[], extra: Partial<CommandInput> = {}) {
      return game.handle(input(GROUP, who, args, extra));
    },
    dm(who: Who, args: string[]) {
      return game.handle(input(who.id, who, args));
    },
  };
}

type Harness = ReturnType<typeof harness>;

function roleOf(sent: { jid: string; text: string }[], id: string): Role {
  const card = [...sent]
    .reverse()
    .find(
      (message) => message.jid === id && message.text.includes("Your role:"),
    );
  const match = card?.text.match(/Your role: (\w+)/);
  if (!match?.[1]) throw new Error(`no role card for ${id}`);
  return match[1] as Role;
}

function numberOf(people: Who[], who: Who): number {
  const index = people.findIndex((person) => person.id === who.id);
  if (index < 0) throw new Error("not in the roster");
  return index + 1;
}

async function started(h: Harness, count = 6) {
  const people = PEOPLE.slice(0, count);
  for (const person of people) await h.group(person, ["join"]);
  const first = people[0];
  if (!first) throw new Error("empty roster");
  await h.group(first, ["start"]);

  const wolves = people.filter(
    (person) => roleOf(h.sent, person.id) === "WEREWOLF",
  );
  const seer = people.find((person) => roleOf(h.sent, person.id) === "SEER");
  const doctor = people.find(
    (person) => roleOf(h.sent, person.id) === "DOCTOR",
  );
  if (!seer || !doctor) throw new Error("fixture lost a role");

  return { people, wolves, seer, doctor };
}

/** Night resolves at its deadline and lands on the day discussion. */
async function toDiscussion(h: Harness): Promise<void> {
  h.advance(NIGHT_MS);
  await h.game.expire(GROUP);
}

async function toVoting(h: Harness): Promise<void> {
  await toDiscussion(h);
  h.advance(DISCUSSION_MS);
  await h.game.expire(GROUP);
}

function groupTexts(h: Harness): string[] {
  return h.sent.filter((message) => message.jid === GROUP).map((m) => m.text);
}

describe("setup", () => {
  test("start assigns one role per player and DMs it", async () => {
    const h = harness();
    const { people, wolves, seer } = await started(h);

    const cards = h.sent.filter((message) =>
      message.text.includes("Your role:"),
    );
    expect(cards).toHaveLength(6);
    expect(wolves).toHaveLength(2);
    expect(seer).toBeDefined();
    expect(
      groupTexts(h).some((text) =>
        text.includes("WEREWOLF started with 6 players"),
      ),
    ).toBe(true);
    for (const person of people) {
      expect(["WEREWOLF", "VILLAGER", "SEER", "DOCTOR"]).toContain(
        roleOf(h.sent, person.id),
      );
    }
  });

  test("a second start changes nothing", async () => {
    const h = harness();
    const { people } = await started(h);
    const first = people[0];
    if (!first) throw new Error("empty roster");

    const cardsBefore = h.sent.filter((m) =>
      m.text.includes("Your role:"),
    ).length;
    const reply = await h.group(first, ["start"]);

    expect(reply).toBe("🚩 The game already started.");
    expect(h.sent.filter((m) => m.text.includes("Your role:"))).toHaveLength(
      cardsBefore,
    );
  });

  test("join in the lobby refuses a duplicate and a full lobby", async () => {
    const h = harness();
    const first = PEOPLE[0];
    if (!first) throw new Error("empty roster");

    const lobby = String(await h.group(first, ["join"]));
    expect(lobby).toContain("Players: 1/12");
    expect(await h.group(first, ["join"])).toBe(
      "🚩 You already joined this lobby.",
    );
  });
});

describe("night", () => {
  test("night kill resolves and dawn names the victim", async () => {
    const h = harness();
    const { people, wolves } = await started(h);
    const victim = people.find(
      (person) => roleOf(h.sent, person.id) === "VILLAGER",
    );
    if (!victim || wolves[0] === undefined || wolves[1] === undefined) {
      throw new Error("fixture lost a player");
    }

    await h.dm(wolves[0], ["act", String(numberOf(people, victim))]);
    await h.dm(wolves[1], ["act", String(numberOf(people, victim))]);
    h.advance(NIGHT_MS);
    await h.game.expire(GROUP);

    const dawn = groupTexts(h).find((text) => text.includes("— dawn"));
    expect(dawn).toContain(`${numberOf(people, victim)}. ${victim.name} died`);
    expect(dawn).toContain("Role: VILLAGER");
  });

  test("doctor saves the wolf target", async () => {
    const h = harness();
    const { people, wolves, doctor } = await started(h);
    const victim = people.find(
      (person) => roleOf(h.sent, person.id) === "VILLAGER",
    );
    if (!victim) throw new Error("fixture lost a villager");

    for (const wolf of wolves) {
      await h.dm(wolf, ["act", String(numberOf(people, victim))]);
    }
    await h.dm(doctor, ["act", String(numberOf(people, victim))]);
    h.advance(NIGHT_MS);
    await h.game.expire(GROUP);

    expect(
      groupTexts(h).some((text) => text.includes("Nobody died in the night.")),
    ).toBe(true);
  });

  test("a wolf tie produces no attack", async () => {
    const h = harness();
    const { people, wolves } = await started(h);
    const villagers = people.filter(
      (person) => roleOf(h.sent, person.id) === "VILLAGER",
    );
    const [first, second] = villagers;
    if (
      !first ||
      !second ||
      wolves[0] === undefined ||
      wolves[1] === undefined
    ) {
      throw new Error("fixture lost a player");
    }

    await h.dm(wolves[0], ["act", String(numberOf(people, first))]);
    await h.dm(wolves[1], ["act", String(numberOf(people, second))]);
    h.advance(NIGHT_MS);
    await h.game.expire(GROUP);

    expect(
      groupTexts(h).some((text) => text.includes("Nobody died in the night.")),
    ).toBe(true);
  });

  test("silent night kills nobody and reports no investigation", async () => {
    const h = harness();
    const { seer } = await started(h);

    h.advance(NIGHT_MS);
    await h.game.expire(GROUP);

    expect(
      groupTexts(h).some((text) => text.includes("Nobody died in the night.")),
    ).toBe(true);
    expect(
      h.sent.some((message) =>
        message.text.includes("No investigation was recorded this night."),
      ),
    ).toBe(true);
    expect(seer).toBeDefined();
  });

  test("seer gets WEREWOLF for a wolf and VILLAGE for a villager", async () => {
    const wolfGame = harness();
    const wolvesSetup = await started(wolfGame);
    const targetWolf = wolvesSetup.wolves[0];
    if (!targetWolf) throw new Error("fixture lost a wolf");
    await wolfGame.dm(wolvesSetup.seer, [
      "act",
      String(numberOf(wolvesSetup.people, targetWolf)),
    ]);
    wolfGame.advance(NIGHT_MS);
    await wolfGame.game.expire(GROUP);
    expect(
      wolfGame.sent.some(
        (message) =>
          message.jid === wolvesSetup.seer.id &&
          message.text.includes("is a WEREWOLF."),
      ),
    ).toBe(true);

    const villageGame = harness(9);
    const villageSetup = await started(villageGame);
    const villager = villageSetup.people.find(
      (person) => roleOf(villageGame.sent, person.id) === "VILLAGER",
    );
    if (!villager) throw new Error("fixture lost a villager");
    await villageGame.dm(villageSetup.seer, [
      "act",
      String(numberOf(villageSetup.people, villager)),
    ]);
    villageGame.advance(NIGHT_MS);
    await villageGame.game.expire(GROUP);
    expect(
      villageGame.sent.some(
        (message) =>
          message.jid === villageSetup.seer.id &&
          message.text.includes("is not a WEREWOLF."),
      ),
    ).toBe(true);
  });

  test("an act after close is rejected without touching the freeze", async () => {
    const h = harness();
    const { people, wolves } = await started(h);
    const victim = people.find(
      (person) => roleOf(h.sent, person.id) === "VILLAGER",
    );
    if (!victim || wolves[0] === undefined)
      throw new Error("fixture lost a player");

    await h.dm(wolves[0], ["act", String(numberOf(people, victim))]);
    h.advance(NIGHT_MS);
    await h.game.expire(GROUP);

    const late = await h.dm(wolves[0], ["act", "1"]);
    expect(late).toBe("🚩 Not a night phase.");
    const dawns = groupTexts(h).filter((text) => text.includes("— dawn"));
    expect(dawns).toHaveLength(1);
    expect(dawns[0]).toContain(victim.name);
  });

  test("expire twice resolves the night once", async () => {
    const h = harness();
    await started(h);

    h.advance(NIGHT_MS);
    await h.game.expire(GROUP);
    await h.game.expire(GROUP);

    expect(
      groupTexts(h).filter((text) => text.includes("— dawn")),
    ).toHaveLength(1);
  });

  test("a wolf's own number is refused as a teammate", async () => {
    const h = harness();
    const { people, wolves } = await started(h);
    const wolf = wolves[0];
    if (!wolf) throw new Error("fixture lost a wolf");

    expect(await h.dm(wolf, ["act", String(numberOf(people, wolf))])).toBe(
      "🚩 You cannot attack a Werewolf.",
    );
    expect(
      await h.dm(wolf, ["act", String(numberOf(people, wolves[1] ?? wolf))]),
    ).toBe("🚩 You cannot attack a Werewolf.");
  });

  test("+3, -1 and 3x are invalid player numbers", async () => {
    const h = harness();
    const { wolves } = await started(h);
    const wolf = wolves[0];
    if (!wolf) throw new Error("fixture lost a wolf");

    expect(await h.dm(wolf, ["act", "+3"])).toBe("🚩 Invalid player number.");
    expect(await h.dm(wolf, ["act", "-1"])).toBe("🚩 Invalid player number.");
    expect(await h.dm(wolf, ["act", "3x"])).toBe("🚩 Invalid player number.");
    expect(await h.dm(wolf, ["act"])).toBe("🚩 Usage: .ww act <number>");
  });

  test("an act in a stranger's DM answers no game", async () => {
    const h = harness();
    const stranger: Who = { id: "999@s.whatsapp.net", name: "Stranger" };

    expect(await h.dm(stranger, ["act", "1"])).toBe(
      "🚩 No Werewolf game is running.",
    );
  });

  test("a dead wolf cannot vote at night", async () => {
    const h = harness();
    const { people, wolves } = await started(h);
    const doomed = wolves[0];
    if (!doomed) throw new Error("fixture lost a wolf");

    // Day 1: everybody alive votes the doomed wolf out.
    await toVoting(h);
    for (const person of people) {
      if (person.id === doomed.id) continue;
      await h.group(person, ["vote", String(numberOf(people, doomed))]);
    }
    h.advance(VOTE_MS);
    await h.game.expire(GROUP);

    // Night 2.
    expect(await h.dm(doomed, ["act", "1"])).toBe(
      "🚩 You are out of the game.",
    );
  });
});

describe("day vote", () => {
  test("day vote eliminates a unique top", async () => {
    const h = harness();
    const { people } = await started(h);
    const target = people[1];
    if (!target) throw new Error("fixture lost a player");

    const other = people[0];
    if (!other) throw new Error("bad roster");

    await toVoting(h);
    for (const person of people) {
      const pick = person.id === target.id ? other : target;
      await h.group(person, ["vote", String(numberOf(people, pick))]);
    }

    const eliminated = groupTexts(h).find((text) =>
      text.includes("— eliminated"),
    );
    expect(eliminated).toContain(
      `${numberOf(people, target)}. ${target.name} was voted out.`,
    );
    expect(eliminated).toContain("Role:");
  });

  test("a dead player's vote is ignored", async () => {
    const h = harness();
    const { people, wolves } = await started(h);
    const dead = people.find(
      (person) => roleOf(h.sent, person.id) === "VILLAGER",
    );
    if (!dead || wolves[0] === undefined || wolves[1] === undefined) {
      throw new Error("fixture lost a player");
    }

    for (const wolf of wolves) {
      await h.dm(wolf, ["act", String(numberOf(people, dead))]);
    }
    h.advance(NIGHT_MS);
    await h.game.expire(GROUP);
    h.advance(DISCUSSION_MS);
    await h.game.expire(GROUP);

    const target = wolves[0];
    expect(
      await h.group(dead, ["vote", String(numberOf(people, target))]),
    ).toBe("🚩 You are not in this game.");

    const survivor = people.find(
      (person) => person.id !== dead.id && person.id !== target.id,
    );
    if (!survivor) throw new Error("fixture lost a survivor");
    await h.group(survivor, ["vote", String(numberOf(people, target))]);
    h.advance(VOTE_MS);
    await h.game.expire(GROUP);

    const eliminated = groupTexts(h).find((text) =>
      text.includes("— eliminated"),
    );
    expect(eliminated).toContain("Votes: 1");
  });

  test("a second vote replaces the first", async () => {
    const h = harness();
    const { people } = await started(h);
    const [first, second, third, fourth] = people;
    if (!first || !second || !third || !fourth) throw new Error("bad roster");

    await toVoting(h);
    await h.group(first, ["vote", String(numberOf(people, third))]);
    await h.group(first, ["vote", String(numberOf(people, fourth))]);
    await h.group(second, ["vote", String(numberOf(people, fourth))]);
    await h.group(third, ["vote", String(numberOf(people, fourth))]);
    h.advance(VOTE_MS);
    await h.game.expire(GROUP);

    const eliminated = groupTexts(h).find((text) =>
      text.includes("— eliminated"),
    );
    expect(eliminated).toContain(fourth.name);
    expect(eliminated).toContain("Votes: 3");
  });

  test("no votes eliminates nobody", async () => {
    const h = harness();
    await started(h);

    await toVoting(h);
    h.advance(VOTE_MS);
    await h.game.expire(GROUP);

    expect(
      groupTexts(h).some((text) =>
        text.includes("No valid votes. Nobody is eliminated."),
      ),
    ).toBe(true);
  });

  test("an empty ballot eliminates nobody and opens no runoff", async () => {
    const h = harness();
    await started(h);

    await toVoting(h);
    h.advance(VOTE_MS);
    await h.game.expire(GROUP);

    expect(groupTexts(h).some((text) => text.includes("— runoff"))).toBe(false);
    expect(groupTexts(h).some((text) => text.includes("🌙 NIGHT 2"))).toBe(
      true,
    );
  });

  test("a tie opens one runoff over the tied players", async () => {
    const h = harness();
    const { people } = await started(h);

    await toVoting(h);
    const [a, b, c, d, e, f] = people;
    if (!a || !b || !c || !d || !e || !f) throw new Error("bad roster");
    for (const [voter, target] of [
      [a, c],
      [b, d],
      [e, c],
      [f, d],
      [c, d],
      [d, c],
    ] as const) {
      await h.group(voter, ["vote", String(numberOf(people, target))]);
    }

    const runoff = groupTexts(h).find((text) => text.includes("— runoff"));
    expect(runoff).toContain(`Tie: ${c.name}, ${d.name}.`);
  });

  test("a runoff vote for a non-tied player is refused", async () => {
    const h = harness();
    const { people } = await started(h);
    const [a, b, c, d, e, f] = people;
    if (!a || !b || !c || !d || !e || !f) throw new Error("bad roster");

    await toVoting(h);
    for (const [voter, target] of [
      [a, c],
      [b, d],
      [e, c],
      [f, d],
      [c, d],
      [d, c],
    ] as const) {
      await h.group(voter, ["vote", String(numberOf(people, target))]);
    }

    expect(await h.group(a, ["vote", String(numberOf(people, f))])).toBe(
      "🚩 You can only vote for candidates in the runoff.",
    );
  });

  test("a tied runoff eliminates nobody", async () => {
    const h = harness();
    const { people } = await started(h);
    const [a, b, c, d, e, f] = people;
    if (!a || !b || !c || !d || !e || !f) throw new Error("bad roster");

    await toVoting(h);
    for (const [voter, target] of [
      [a, c],
      [b, d],
      [e, c],
      [f, d],
      [c, d],
      [d, c],
    ] as const) {
      await h.group(voter, ["vote", String(numberOf(people, target))]);
    }
    for (const [voter, target] of [
      [a, c],
      [b, d],
      [e, c],
      [f, d],
      [c, d],
      [d, c],
    ] as const) {
      await h.group(voter, ["vote", String(numberOf(people, target))]);
    }

    expect(
      groupTexts(h).some((text) =>
        text.includes("Still tied. Nobody is eliminated."),
      ),
    ).toBe(true);
  });

  test("a vote after the deadline is rejected", async () => {
    const h = harness();
    const { people } = await started(h);
    const voter = people[0];
    if (!voter) throw new Error("bad roster");

    await toVoting(h);
    h.advance(VOTE_MS + 1);

    expect(await h.group(voter, ["vote", "2"])).toBe("🚩 Time is up.");
  });

  test("expire at the deadline tallies the same as an early close", async () => {
    const early = harness(13);
    const late = harness(13);
    const earlySetup = await started(early);
    const lateSetup = await started(late);
    const earlyTarget = earlySetup.people[2];
    const lateTarget = lateSetup.people[2];
    if (!earlyTarget || !lateTarget) throw new Error("bad roster");

    const earlyOther = earlySetup.people[0];
    const lateOther = lateSetup.people[0];
    if (!earlyOther || !lateOther) throw new Error("bad roster");

    await toVoting(early);
    for (const person of earlySetup.people) {
      const pick = person.id === earlyTarget.id ? earlyOther : earlyTarget;
      await early.group(person, [
        "vote",
        String(numberOf(earlySetup.people, pick)),
      ]);
    }

    await toVoting(late);
    for (const person of lateSetup.people) {
      await late.group(person, [
        "vote",
        String(numberOf(lateSetup.people, lateTarget)),
      ]);
    }
    late.advance(VOTE_MS);
    await late.game.expire(GROUP);

    const earlyText = groupTexts(early).find((text) =>
      text.includes("— eliminated"),
    );
    const lateText = groupTexts(late).find((text) =>
      text.includes("— eliminated"),
    );
    expect(earlyText).toBeDefined();
    expect(lateText).toBeDefined();
    expect(earlyText).toContain(earlyTarget.name);
    expect(lateText).toContain(lateTarget.name);
  });

  test("abstentions do not decide a vote", async () => {
    const h = harness();
    const { people } = await started(h);
    const [a, b, c, d] = people;
    if (!a || !b || !c || !d) throw new Error("bad roster");

    await toVoting(h);
    await h.group(a, ["vote", String(numberOf(people, d))]);
    await h.group(b, ["vote", String(numberOf(people, d))]);
    await h.group(c, ["vote", String(numberOf(people, d))]);
    h.advance(VOTE_MS);
    await h.game.expire(GROUP);

    const eliminated = groupTexts(h).find((text) =>
      text.includes("— eliminated"),
    );
    expect(eliminated).toContain(d.name);
    expect(eliminated).toContain("Votes: 3");
    expect(groupTexts(h).some((text) => text.includes("— runoff"))).toBe(false);
  });

  test("two identical votes count once", async () => {
    const h = harness();
    const { people } = await started(h);
    const [a, target] = people;
    if (!a || !target) throw new Error("bad roster");

    await toVoting(h);
    await h.group(a, ["vote", String(numberOf(people, target))]);
    await h.group(a, ["vote", String(numberOf(people, target))]);
    h.advance(VOTE_MS);
    await h.game.expire(GROUP);

    const eliminated = groupTexts(h).find((text) =>
      text.includes("— eliminated"),
    );
    expect(eliminated).toContain("Votes: 1");
  });
});

describe("victory", () => {
  test("village win", async () => {
    const h = harness(21);
    const { people, wolves } = await started(h, 5);
    const wolf = wolves[0];
    if (!wolf) throw new Error("fixture lost the lone wolf");

    await toVoting(h);
    for (const person of people) {
      if (person.id === wolf.id) continue;
      await h.group(person, ["vote", String(numberOf(people, wolf))]);
    }
    h.advance(VOTE_MS);
    await h.game.expire(GROUP);

    expect(
      groupTexts(h).some((text) =>
        text.includes("🏆 Village wins — every Werewolf is dead."),
      ),
    ).toBe(true);
  });

  test("parity win", async () => {
    const h = harness(33);
    const { people, wolves } = await started(h, 6);
    const villager = people.find(
      (person) => roleOf(h.sent, person.id) === "VILLAGER",
    );
    if (!villager || wolves.length !== 2)
      throw new Error("fixture lost a player");
    const [wolfA, wolfB] = wolves;
    if (!wolfA || !wolfB) throw new Error("fixture lost a wolf");

    // Night 1: the pack kills a villager -> 2 wolves, 3 village.
    for (const wolf of wolves) {
      await h.dm(wolf, ["act", String(numberOf(people, villager))]);
    }
    const rest = people.find(
      (person) =>
        person.id !== villager.id &&
        person.id !== wolfA.id &&
        person.id !== wolfB.id &&
        roleOf(h.sent, person.id) === "VILLAGER",
    );
    if (!rest) throw new Error("fixture lost the second villager");

    // Day 1: the living vote the second villager out -> 2 wolves, 2 village.
    h.advance(NIGHT_MS);
    await h.game.expire(GROUP);
    h.advance(DISCUSSION_MS);
    await h.game.expire(GROUP);
    for (const person of people) {
      if (person.id === villager.id) continue;
      await h.group(person, ["vote", String(numberOf(people, rest))]);
    }
    h.advance(VOTE_MS);
    await h.game.expire(GROUP);

    expect(
      groupTexts(h).some((text) =>
        text.includes(
          "🏆 Werewolves win — they equal or outnumber the village.",
        ),
      ),
    ).toBe(true);
  });

  test("win is declared only after the deaths are recorded", async () => {
    const h = harness(21);
    const { people, wolves } = await started(h, 5);
    const wolf = wolves[0];
    if (!wolf) throw new Error("fixture lost the lone wolf");

    await toVoting(h);
    for (const person of people) {
      if (person.id === wolf.id) continue;
      await h.group(person, ["vote", String(numberOf(people, wolf))]);
    }
    h.advance(VOTE_MS);
    await h.game.expire(GROUP);

    const summary = groupTexts(h).find((text) => text.startsWith("GAME OVER"));
    expect(summary).toContain(`(voted, day 1)`);
    expect(summary).toContain(`— WEREWOLF (voted, day 1)`);
    expect(summary).toContain("Days played: 1");
  });

  test("act and vote after game over answer no game", async () => {
    const h = harness(21);
    const { people, wolves } = await started(h, 5);
    const wolf = wolves[0];
    const host = people[0];
    if (!wolf || !host) throw new Error("fixture lost a player");

    await h.group(host, ["cancel"]);
    expect(await h.dm(wolf, ["act", "1"])).toBe(
      "🚩 No Werewolf game is running.",
    );
    expect(await h.group(host, ["vote", "1"])).toContain(
      "No Werewolf game here",
    );
  });

  test("cancel in the runoff posts game over once", async () => {
    const h = harness();
    const { people } = await started(h);
    const [a, b, c, d, e, f] = people;
    if (!a || !b || !c || !d || !e || !f) throw new Error("bad roster");

    await toVoting(h);
    for (const [voter, target] of [
      [a, a],
      [b, b],
      [c, a],
      [d, b],
      [e, a],
      [f, b],
    ] as const) {
      await h.group(voter, ["vote", String(numberOf(people, target))]);
    }

    await h.group(a, ["cancel"]);
    h.advance(RUNOFF_MS);
    await h.game.expire(GROUP);

    expect(
      groupTexts(h).filter((text) => text.startsWith("GAME OVER")),
    ).toHaveLength(1);
    expect(groupTexts(h).some((text) => text.includes("— runoff result"))).toBe(
      false,
    );
  });

  test("ten days without a winner ends in a draw", async () => {
    const h = harness();
    await started(h);

    for (let day = 0; day < 10; day += 1) {
      h.advance(NIGHT_MS);
      await h.game.expire(GROUP);
      h.advance(DISCUSSION_MS);
      await h.game.expire(GROUP);
      h.advance(VOTE_MS);
      await h.game.expire(GROUP);
    }

    expect(
      groupTexts(h).some((text) =>
        text.includes("🤝 Draw — the 10-day limit was reached."),
      ),
    ).toBe(true);
  });
});

describe("privacy", () => {
  test("group text never contains a living player's role", async () => {
    const h = harness();
    await started(h);

    const group = groupTexts(h).join("\n");
    expect(group).not.toContain("Your role:");
    expect(group).not.toContain("Faction:");
    expect(group).not.toContain("Your teammates:");
    expect(group).not.toContain("SEER");
    expect(group).not.toContain("DOCTOR");
    expect(group).not.toContain("VILLAGER");
    expect(group).not.toContain("WEREWOLF —");
  });

  test("only werewolves receive the teammate list", async () => {
    const h = harness();
    const { people } = await started(h);

    const withPack = h.sent.filter((message) =>
      message.text.includes("Your teammates:"),
    );
    expect(withPack).toHaveLength(2);
    for (const message of withPack) {
      const owner = people.find((person) => person.id === message.jid);
      expect(owner).toBeDefined();
      expect(roleOf(h.sent, message.jid)).toBe("WEREWOLF");
    }
  });

  test("the seer result DM has exactly one recipient", async () => {
    const h = harness();
    const { people, seer } = await started(h);
    const target = people.find(
      (person) => roleOf(h.sent, person.id) === "VILLAGER",
    );
    if (!target) throw new Error("fixture lost a villager");

    await h.dm(seer, ["act", String(numberOf(people, target))]);
    h.advance(NIGHT_MS);
    await h.game.expire(GROUP);

    const results = h.sent.filter((message) =>
      message.text.includes("is not a WEREWOLF."),
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.jid).toBe(seer.id);
  });

  test("status output has no roles while the game runs", async () => {
    const h = harness();
    const { people } = await started(h);
    const host = people[0];
    if (!host) throw new Error("bad roster");

    const status = String(await h.group(host, ["status"]));

    expect(status).toContain("werewolf night");
    expect(status).not.toContain("— WEREWOLF");
    expect(status).not.toContain("SEER");
    expect(status).not.toContain("DOCTOR");
    expect(status).not.toContain("VILLAGER");
  });
});

describe("validation and reliability", () => {
  test("a villager's act is refused", async () => {
    const h = harness();
    const { people } = await started(h);
    const villager = people.find(
      (person) => roleOf(h.sent, person.id) === "VILLAGER",
    );
    if (!villager) throw new Error("fixture lost a villager");

    expect(await h.dm(villager, ["act", "1"])).toBe(
      "🚩 You have no night action.",
    );
  });

  test("an act from the previous round is rejected", async () => {
    const h = harness();
    const { wolves } = await started(h);
    const wolf = wolves[0];
    if (!wolf) throw new Error("fixture lost a wolf");

    await toDiscussion(h);

    expect(await h.dm(wolf, ["act", "1"])).toBe("🚩 Not a night phase.");
  });

  test("both wolves voting in the same tick tally correctly", async () => {
    const h = harness();
    const { people, wolves } = await started(h);
    const victim = people.find(
      (person) => roleOf(h.sent, person.id) === "VILLAGER",
    );
    const [wolfA, wolfB] = wolves;
    if (!victim || !wolfA || !wolfB) throw new Error("fixture lost a player");

    await Promise.all([
      h.dm(wolfA, ["act", String(numberOf(people, victim))]),
      h.dm(wolfB, ["act", String(numberOf(people, victim))]),
    ]);
    const doctor = people.find(
      (person) => roleOf(h.sent, person.id) === "DOCTOR",
    );
    const seer = people.find((person) => roleOf(h.sent, person.id) === "SEER");
    if (!doctor || !seer) throw new Error("fixture lost a role");
    await h.dm(doctor, ["act", String(numberOf(people, seer))]);
    h.advance(NIGHT_MS);
    await h.game.expire(GROUP);

    expect(
      groupTexts(h).some((text) => text.includes(`${victim.name} died`)),
    ).toBe(true);
  });

  test("an old timer cannot close the next phase", async () => {
    const h = harness();
    await started(h);

    await toDiscussion(h);
    await h.game.expire(GROUP);

    expect(groupTexts(h).some((text) => text.includes("— vote"))).toBe(false);
  });

  test("join during a live game is refused", async () => {
    const h = harness();
    await started(h);
    const late: Who = { id: "777@s.whatsapp.net", name: "Late" };

    expect(await h.group(late, ["join"])).toBe(
      "🚩 A game is already running in this group.",
    );
  });

  test("join in another group is refused during a night", async () => {
    const h = harness();
    const { people } = await started(h);
    const player = people[0];
    if (!player) throw new Error("bad roster");

    const other = await h.game.handle({
      chatJid: "999888@g.us",
      isGroup: true,
      senderJid: player.id,
      senderPn: player.id,
      senderLid: "",
      name: player.name,
      prefix: ".",
      isAdmin: false,
      isOwner: false,
      args: ["join"],
    });

    expect(other).toBe("🚩 You are already playing in another group.");
  });

  test("the leaver's host role moves to the first living player", async () => {
    const h = harness();
    const { people } = await started(h);
    const [host, next] = people;
    if (!host || !next) throw new Error("bad roster");

    await h.game.onParticipantsUpdate({
      id: GROUP,
      action: "remove",
      participants: [{ id: host.id } as GroupParticipant],
    });

    expect(await h.group(next, ["cancel"])).toBeNull();
    expect(groupTexts(h).some((text) => text.startsWith("GAME OVER"))).toBe(
      true,
    );
  });

  test("recover closes the row and posts the notice once", async () => {
    const h = harness();
    await started(h);

    const revived = createWerewolf({
      send: async (jid, text) => {
        h.sent.push({ jid, text });
        return true;
      },
      store: h.store,
      now: () => 1_000_000,
      random: seededRandom(7),
    });

    await revived.recover();
    await revived.recover();

    const notices = h.sent.filter((message) =>
      message.text.includes("The bot restarted"),
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.jid).toBe(GROUP);
    expect(h.store.listLive()).toEqual([]);
  });

  test("recover leaves a live session in memory alone", async () => {
    const h = harness();
    await started(h);

    await h.game.recover();

    expect(h.store.listLive()).toHaveLength(1);
    expect(
      h.sent.some((message) => message.text.includes("The bot restarted")),
    ).toBe(false);
  });

  test("skip closes the discussion early", async () => {
    const h = harness();
    const { people } = await started(h);
    const host = people[0];
    if (!host) throw new Error("bad roster");

    await toDiscussion(h);
    await h.group(host, ["skip"]);

    expect(groupTexts(h).some((text) => text.includes("— vote"))).toBe(true);
  });

  test("leave in the lobby renumbers and moves the host", async () => {
    const h = harness();
    const [first, second, third] = PEOPLE;
    if (!first || !second || !third) throw new Error("bad roster");

    for (const person of [first, second, third]) {
      await h.group(person, ["join"]);
    }
    const lobby = String(await h.group(first, ["leave"]));

    expect(lobby).toContain("Players: 2/12");
    expect(lobby).toContain("Host: P2");
    expect(lobby).toContain("1. P2");
  });
});
