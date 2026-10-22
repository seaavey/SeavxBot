import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  aesEncryptGCM,
  hmacSign,
  proto,
  sha256,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { createUndercover, type CommandInput } from "@/lib/games/undercover";
import {
  createUndercoverStore,
  UNDERCOVER_TABLE_SQL,
} from "@/lib/games/undercover/store";
import {
  CLUE_MS,
  GUESS_MS,
  LOBBY_IDLE_MS,
  REVOTE_MS,
  VOTE_MS,
} from "@/lib/games/undercover/rules";

const GROUP = "120363000000000000@g.us";
const OTHER_GROUP = "120363000000000001@g.us";
const BOT_PN = "628111111111@s.whatsapp.net";
const BOT_LID = "98037510705262@lid";

interface TestPlayer {
  jid: string;
  lid: string;
  number: number;
  name: string;
}

interface SentMessage {
  jid: string;
  text: string;
}

interface TestPoll {
  id: string;
  jid: string;
  name: string;
  values: string[];
  secret: Uint8Array;
}

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

function roster(size: number): TestPlayer[] {
  return Array.from({ length: size }, (_value, index) => ({
    jid: `6280000000${String(index + 10)}@s.whatsapp.net`,
    lid: `1000000000000${index}@lid`,
    number: index + 1,
    name: `P${index + 1}`,
  }));
}

function harness(seed = 1) {
  const db = new Database(":memory:");
  db.exec(UNDERCOVER_TABLE_SQL);
  const store = createUndercoverStore(db);
  const sent: SentMessage[] = [];
  const polls: TestPoll[] = [];
  let clock = 1_000_000;
  let counter = 0;
  let failDmFor: string | null = null;

  const game = createUndercover({
    send: async (jid, text) => {
      if (failDmFor && jid === failDmFor) return false;
      sent.push({ jid, text });
      return true;
    },
    poll: async (request) => {
      counter += 1;
      const id = `poll-${counter}`;
      polls.push({ ...request, id });
      return id;
    },
    store,
    now: () => clock,
    random: seeded(seed),
  });

  const sock = { user: { id: BOT_PN, lid: BOT_LID } } as unknown as WASocket;

  function input(
    player: TestPlayer,
    sub: string,
    ...rest: string[]
  ): CommandInput {
    return {
      sock,
      chatJid: GROUP,
      isGroup: true,
      senderJid: player.jid,
      senderPn: player.jid,
      senderLid: player.lid,
      name: player.name,
      prefix: ".",
      isAdmin: false,
      isOwner: false,
      args: [sub, ...rest],
    };
  }

  function dm(
    player: TestPlayer,
    sub: string,
    ...rest: string[]
  ): CommandInput {
    return {
      ...input(player, sub, ...rest),
      chatJid: player.jid,
      isGroup: false,
    };
  }

  function advance(ms: number): void {
    clock += ms;
  }

  function lastGroup(text: string): SentMessage | undefined {
    return [...sent]
      .reverse()
      .find((message) => message.jid === GROUP && message.text.includes(text));
  }

  function lastGroupMessage(): SentMessage | undefined {
    return [...sent].reverse().find((message) => message.jid === GROUP);
  }

  function roles(): Map<string, { role: string; word?: string }> {
    const found = new Map<string, { role: string; word?: string }>();
    for (const message of sent) {
      const role = /Your role: (.+)/.exec(message.text)?.[1];
      if (!role) continue;
      found.set(message.jid, {
        role: role.trim(),
        word: /Your word: (.+)/.exec(message.text)?.[1]?.trim(),
      });
    }
    return found;
  }

  function turnPlayer(players: TestPlayer[]): TestPlayer | undefined {
    const prompt = lastGroupMessage();
    if (!prompt?.text.includes("clue turn")) return undefined;
    const line = prompt.text.split("\n")[2] ?? "";
    const number = Number(/^(\d+)\./.exec(line)?.[1]);
    return players.find((player) => player.number === number);
  }

  async function castVote(
    poll: TestPoll,
    voter: TestPlayer,
    target: TestPlayer,
  ): Promise<boolean> {
    const label = poll.values.find((value) =>
      value.startsWith(`${target.number}.`),
    );
    if (!label) throw new Error("target is not on the poll");

    const plain = proto.Message.PollVoteMessage.encode({
      selectedOptions: [sha256(Buffer.from(label))],
    }).finish();
    const sign = Buffer.concat([
      Buffer.from(poll.id),
      Buffer.from(BOT_LID),
      Buffer.from(voter.lid),
      Buffer.from("Poll Vote"),
      new Uint8Array([1]),
    ]);
    const key0 = hmacSign(
      Buffer.from(poll.secret),
      new Uint8Array(32),
      "sha256",
    );
    const key = hmacSign(sign, key0, "sha256");
    const iv = new Uint8Array(12).fill(5);
    const aad = Buffer.from(`${poll.id}\u0000${voter.lid}`);

    const raw = {
      key: { remoteJid: GROUP, participant: voter.lid },
      message: {
        pollUpdateMessage: {
          pollCreationMessageKey: { id: poll.id },
          vote: { encPayload: aesEncryptGCM(plain, key, iv, aad), encIv: iv },
        },
      },
    } as unknown as WAMessage;

    return game.handlePollVote(sock, raw);
  }

  return {
    game,
    expire: game.expire,
    sock,
    store,
    sent,
    polls,
    input,
    dm,
    advance,
    lastGroup,
    roles,
    turnPlayer,
    castVote,
    failDm(jid: string | null): void {
      failDmFor = jid;
    },
  };
}

type Harness = ReturnType<typeof harness>;
type Started = Harness & { players: TestPlayer[] };

async function started(size = 5): Promise<Started> {
  const h = harness();
  const players = roster(size);
  for (const player of players) await h.game.handle(h.input(player, "join"));
  await h.game.handle(h.input(players[0]!, "start"));
  return { ...h, players };
}

async function giveClue(h: Harness, players: TestPlayer[], word = "zzz") {
  const player = h.turnPlayer(players);
  if (!player) throw new Error("no clue turn is open");
  await h.game.handle(h.input(player, "clue", word));
}

async function giveAllClues(h: Harness, players: TestPlayer[]) {
  for (let guard = 0; guard < 20; guard += 1) {
    if (h.turnPlayer(players)) {
      await giveClue(h, players);
      continue;
    }
    return;
  }
  throw new Error("clue phase never ended");
}

describe("lobby", () => {
  test("the first join creates the lobby and names the host", async () => {
    const h = harness();
    const players = roster(3);

    const reply = await h.game.handle(h.input(players[0]!, "join"));

    expect(reply).toContain("Players: 1/12");
    expect(reply).toContain("Host: P1");
    expect(reply).toContain("1. P1");
  });

  test("joining twice is refused", async () => {
    const h = harness();
    const [first] = roster(2);

    await h.game.handle(h.input(first!, "join"));
    const again = await h.game.handle(h.input(first!, "join"));

    expect(again).toContain("already joined");
  });

  test("a thirteenth player is refused", async () => {
    const h = harness();
    const players = roster(13);

    for (const player of players.slice(0, 12)) {
      await h.game.handle(h.input(player, "join"));
    }
    const reply = await h.game.handle(h.input(players[12]!, "join"));

    expect(reply).toContain("full");
  });

  test("leaving hands the host over and an empty lobby closes", async () => {
    const h = harness();
    const players = roster(2);
    await h.game.handle(h.input(players[0]!, "join"));
    await h.game.handle(h.input(players[1]!, "join"));

    const afterLeave = await h.game.handle(h.input(players[0]!, "leave"));
    expect(afterLeave).toContain("Host: P2");

    const closed = await h.game.handle(h.input(players[1]!, "leave"));
    expect(closed).toContain("closed");
    expect(await h.game.handle(h.input(players[1]!, "status"))).toContain(
      "No Undercover game",
    );
  });

  test("player numbers stay 1..N after a leave", async () => {
    const h = harness();
    const players = roster(3);
    await h.game.handle(h.input(players[0]!, "join"));
    await h.game.handle(h.input(players[1]!, "join"));

    const afterLeave = await h.game.handle(h.input(players[0]!, "leave"));
    expect(afterLeave).toContain("1. P2");
    expect(afterLeave).not.toContain("2. P2");

    const afterRejoin = await h.game.handle(h.input(players[2]!, "join"));
    expect(afterRejoin).toContain("1. P2");
    expect(afterRejoin).toContain("2. P3");
  });

  test("a player cannot join a second group's lobby", async () => {
    const h = harness();
    const players = roster(2);
    await h.game.handle(h.input(players[0]!, "join"));

    const elsewhere = await h.game.handle({
      ...h.input(players[0]!, "join"),
      chatJid: OTHER_GROUP,
    });

    expect(elsewhere).toContain("already playing in another group");
  });

  test("group commands are refused in a DM", async () => {
    const h = harness();
    const [player] = roster(1);

    for (const sub of ["join", "start", "status", "clue", "cancel", "leave"]) {
      const reply = await h.game.handle(h.dm(player!, sub));
      expect(reply).toContain("Play this in the group");
    }
  });

  test("an idle lobby closes itself", async () => {
    const h = harness();
    const [player] = roster(1);
    await h.game.handle(h.input(player!, "join"));

    h.advance(LOBBY_IDLE_MS);
    await h.game.expire(GROUP);

    expect(h.lastGroup("cancelled")?.text).toContain("lobby idle");
  });
});

describe("start", () => {
  test("needs five players", async () => {
    const h = harness();
    const players = roster(4);
    for (const player of players) {
      await h.game.handle(h.input(player, "join"));
    }

    const reply = await h.game.handle(h.input(players[0]!, "start"));

    expect(reply).toContain("at least 5 players");
  });

  test("only the host or an admin starts", async () => {
    const h = harness();
    const players = roster(5);
    for (const player of players) {
      await h.game.handle(h.input(player, "join"));
    }

    const reply = await h.game.handle(h.input(players[3]!, "start"));

    expect(reply).toContain("host or a group admin");
  });

  test("DMs one role each and Mr. White gets no word", async () => {
    const { players, roles, sent } = await started(5);
    const assigned = roles();

    expect(assigned.size).toBe(5);
    for (const player of players) {
      const entry = assigned.get(player.jid);
      expect(entry).toBeDefined();
      if (entry?.role === "MR. WHITE") {
        expect(entry.word).toBeUndefined();
      } else {
        expect(entry?.word?.length).toBeGreaterThan(0);
      }
    }

    const mrWhite = [...assigned.values()].filter(
      (entry) => entry.role === "MR. WHITE",
    );
    expect(mrWhite).toHaveLength(1);
    expect(
      sent.some((message) => message.text.includes("UNDERCOVER started")),
    ).toBe(true);
  });

  test("a failed role DM aborts the start and leaves nothing behind", async () => {
    const h = harness();
    const players = roster(5);
    for (const player of players) {
      await h.game.handle(h.input(player, "join"));
    }

    h.failDm(players[2]!.jid);
    const reply = await h.game.handle(h.input(players[0]!, "start"));

    expect(reply).toBeNull();
    expect(h.lastGroup("Start cancelled")).toBeDefined();
    expect(h.store.listLive()).toHaveLength(0);
    expect(await h.game.handle(h.input(players[0]!, "status"))).toContain(
      "No Undercover game",
    );
  });

  test("the same start twice does not create a second game", async () => {
    const h = harness();
    const players = roster(5);
    for (const player of players) {
      await h.game.handle(h.input(player, "join"));
    }

    await h.game.handle(h.input(players[0]!, "start"));
    const again = await h.game.handle(h.input(players[0]!, "start"));

    expect(again).toContain("already started");
  });
});

describe("clue phase", () => {
  test("only the turn player gives a clue", async () => {
    const { game, input, players, turnPlayer } = await started();
    const onTurn = turnPlayer(players)!;
    const other = players.find((player) => player.jid !== onTurn.jid)!;

    expect(await game.handle(input(other, "clue", "zzz"))).toContain(
      "not your turn",
    );
    expect(await game.handle(input(onTurn, "clue", "zzz"))).toBeNull();
  });

  test("a clue is one to three words", async () => {
    const { game, input, players, turnPlayer } = await started();
    const onTurn = turnPlayer(players)!;

    expect(await game.handle(input(onTurn, "clue"))).toContain("Send a clue");
    expect(
      await game.handle(input(onTurn, "clue", "a", "b", "c", "d")),
    ).toContain("at most 3 words");
  });

  test("a rejected clue keeps the same turn and deadline", async () => {
    const { game, input, players, turnPlayer, advance } = await started();
    const onTurn = turnPlayer(players)!;
    const deadline = onTurn.jid;

    expect(
      await game.handle(input(onTurn, "clue", "a", "b", "c", "d")),
    ).toContain("at most 3 words");
    advance(CLUE_MS - 1);
    expect(turnPlayer(players)!.jid).toBe(deadline);
    expect(await game.handle(input(onTurn, "clue", "zzz"))).toBeNull();
  });

  test("a clue containing the sender's own word is rejected, then accepted", async () => {
    const { game, input, players, turnPlayer, roles } = await started();
    const assigned = roles();
    const onTurn = turnPlayer(players)!;
    const own = assigned.get(onTurn.jid)?.word;

    if (own) {
      const reply = await game.handle(input(onTurn, "clue", own.toLowerCase()));
      expect(reply).toContain("secret word");
    }

    expect(await game.handle(input(onTurn, "clue", "zzz"))).toBeNull();
  });

  test("Mr. White's clue is only count-checked", async () => {
    const { game, input, players, roles, turnPlayer } = await started();
    const assigned = roles();
    const mrWhiteJid = [...assigned.entries()].find(
      ([, entry]) => entry.role === "MR. WHITE",
    )?.[0];
    const civilianWord = [...assigned.values()].find(
      (entry) => entry.role === "CIVILIAN",
    )?.word;

    // Play until it is Mr. White's turn, accepting every other clue.
    for (let guard = 0; guard < 10; guard += 1) {
      const onTurn = turnPlayer(players);
      if (!onTurn) break;
      if (onTurn.jid === mrWhiteJid) {
        expect(
          await game.handle(input(onTurn, "clue", civilianWord ?? "kopi")),
        ).toBeNull();
        return;
      }
      await game.handle(input(onTurn, "clue", "zzz"));
    }
  });

  test("a turn timeout skips without eliminating anyone", async () => {
    const { game, expire, players, turnPlayer, advance, lastGroup } =
      await started();
    const first = turnPlayer(players)!;

    advance(CLUE_MS);
    await expire(GROUP);

    expect(lastGroup("ran out of time")?.text).toContain(first.name);
    expect(lastGroup("clue turn")?.text).not.toContain(first.name);
  });

  test("the last clue opens the vote", async () => {
    const h = await started();
    await giveAllClues(h, h.players);

    expect(h.polls).toHaveLength(1);
    expect(h.polls[0]?.values).toHaveLength(5);
    expect(h.lastGroup("who is the impostor")?.text).toBeDefined();
  });
});

describe("status", () => {
  test("does not leak a living role or a word", async () => {
    const h = await started();
    const reply = (await h.game.handle(h.input(h.players[0]!, "status"))) ?? "";

    expect(reply).toContain("Round 1/10");
    expect(reply).not.toMatch(/— (CIVILIAN|UNDERCOVER|MR_WHITE)/);
    expect(reply).not.toContain("Your word");

    for (const entry of h.roles().values()) {
      if (entry.word)
        expect(reply.toLowerCase()).not.toContain(entry.word.toLowerCase());
    }
  });
});

describe("voting", () => {
  test("a full ballot eliminates the leader and closes the phase early", async () => {
    const h = await started();
    await giveAllClues(h, h.players);
    const poll = h.polls[0]!;
    const target = h.players[2]!;
    const assigned = h.roles();

    for (const voter of h.players) {
      const voted = voter.jid === target.jid ? h.players[0]! : target;
      expect(await h.castVote(poll, voter, voted)).toBe(true);
    }

    const eliminated = h.lastGroup("was voted out")?.text ?? "";
    expect(eliminated).toContain(target.name);
    expect(eliminated).toContain(assigned.get(target.jid)!.role);
    expect(eliminated).toContain("Votes: 4");
  });

  test("a self-vote is ignored", async () => {
    const h = await started();
    await giveAllClues(h, h.players);
    const poll = h.polls[0]!;
    const voter = h.players[0]!;

    await h.castVote(poll, voter, voter);
    const status = await h.game.handle(h.input(voter, "status"));

    expect(status).toContain("Votes: 0/5");
  });

  test("a duplicate vote is ignored", async () => {
    const h = await started();
    await giveAllClues(h, h.players);
    const poll = h.polls[0]!;
    const voter = h.players[0]!;

    await h.castVote(poll, voter, h.players[1]!);
    await h.castVote(poll, voter, h.players[2]!);

    expect(await h.game.handle(h.input(voter, "status"))).toContain(
      "Votes: 1/5",
    );
  });

  test("a non-player cannot vote", async () => {
    const h = await started();
    await giveAllClues(h, h.players);
    const poll = h.polls[0]!;
    const outsider = roster(6)[5]!;

    await h.castVote(poll, outsider, h.players[0]!);

    expect(await h.game.handle(h.input(h.players[0]!, "status"))).toContain(
      "Votes: 0/5",
    );
  });

  test("no votes means no elimination and the next round", async () => {
    const h = await started();
    await giveAllClues(h, h.players);

    h.advance(VOTE_MS);
    await h.game.expire(GROUP);

    expect(h.lastGroup("No valid votes")?.text).toBeDefined();
    expect(h.lastGroup("clue turn")?.text).toContain("Round 2");
  });

  test("a tie opens exactly one revote and a second tie eliminates nobody", async () => {
    const h = await started();
    await giveAllClues(h, h.players);
    const first = h.polls[0]!;
    const [p1, p2, p3, p4, p5] = h.players as [
      TestPlayer,
      TestPlayer,
      TestPlayer,
      TestPlayer,
      TestPlayer,
    ];

    await h.castVote(first, p1, p3);
    await h.castVote(first, p2, p3);
    await h.castVote(first, p3, p5);
    await h.castVote(first, p4, p5);
    await h.castVote(first, p5, p1);

    const revote = h.polls[1]!;
    expect(h.lastGroup("Tie:")?.text).toContain(p3.name);
    expect(revote.values).toHaveLength(2);

    await h.castVote(revote, p1, p3);
    await h.castVote(revote, p2, p3);
    await h.castVote(revote, p3, p5);
    await h.castVote(revote, p4, p5);
    await h.castVote(revote, p5, p3);

    expect(h.lastGroup("was voted out")?.text).toContain(p3.name);
    expect(h.polls).toHaveLength(2);
  });

  test("a revote that ties again ends the round without an elimination", async () => {
    const h = await started();
    await giveAllClues(h, h.players);
    const first = h.polls[0]!;
    const [p1, p2, p3, p4, p5] = h.players as [
      TestPlayer,
      TestPlayer,
      TestPlayer,
      TestPlayer,
      TestPlayer,
    ];

    await h.castVote(first, p1, p3);
    await h.castVote(first, p2, p3);
    await h.castVote(first, p3, p5);
    await h.castVote(first, p4, p5);
    await h.castVote(first, p5, p1);

    const revote = h.polls[1]!;
    await h.castVote(revote, p1, p3);
    await h.castVote(revote, p2, p3);
    await h.castVote(revote, p3, p5);
    await h.castVote(revote, p4, p5);

    // The last voter abstains instead of breaking the tie.
    h.advance(REVOTE_MS);
    await h.game.expire(GROUP);

    expect(h.lastGroup("Still tied")?.text).toBeDefined();
    expect(h.lastGroup("clue turn")?.text).toContain("Round 2");
  });
});

describe("Mr. White", () => {
  async function eliminateMrWhite(h: Started) {
    const assigned = h.roles();
    const mrWhiteJid = [...assigned.entries()].find(
      ([, entry]) => entry.role === "MR. WHITE",
    )![0];
    const mrWhite = h.players.find((player) => player.jid === mrWhiteJid)!;
    const civilianWord = [...assigned.values()].find(
      (entry) => entry.role === "CIVILIAN",
    )!.word!;

    await giveAllClues(h, h.players);
    const poll = h.polls[0]!;
    const fallback = h.players.find((player) => player.jid !== mrWhite.jid)!;
    for (const voter of h.players) {
      const target = voter.jid === mrWhite.jid ? fallback : mrWhite;
      await h.castVote(poll, voter, target);
    }

    return { mrWhite, civilianWord };
  }

  test("elimination opens the guess, reveals the role and not the word", async () => {
    const h = await started();
    const { mrWhite } = await eliminateMrWhite(h);

    const announced = h.lastGroup("was voted out")?.text ?? "";
    expect(announced).toContain("MR. WHITE");
    expect(announced).not.toContain(
      h.roles().values().next().value?.word ?? "¬",
    );

    expect(
      h.sent.some(
        (message) =>
          message.jid === mrWhite.jid && message.text.includes("MR. WHITE!"),
      ),
    ).toBe(true);
  });

  test("the correct Civilian word wins immediately", async () => {
    const h = await started();
    const { mrWhite, civilianWord } = await eliminateMrWhite(h);

    const reply = await h.game.handle(
      h.dm(mrWhite, "guess", civilianWord.toLowerCase()),
    );

    expect(reply).toBe("");
    const summary = h.lastGroup("Mr. White wins")?.text ?? "";
    expect(summary).toContain(civilianWord);
    expect(summary).toContain("Mr. White's guess: correct");
    expect(summary).toContain("MR. WHITE");
    expect(await h.game.handle(h.input(h.players[0]!, "status"))).toContain(
      "No Undercover game",
    );
  });

  test("the Undercover word is a wrong guess", async () => {
    const h = await started();
    const { mrWhite } = await eliminateMrWhite(h);
    const undercoverWord = [...h.roles().values()].find(
      (entry) => entry.role === "UNDERCOVER",
    )!.word!;

    await h.game.handle(h.dm(mrWhite, "guess", undercoverWord));

    expect(h.lastGroup("Wrong guess")?.text).toBeUndefined();
    expect(
      h.sent.some(
        (message) =>
          message.jid === mrWhite.jid && message.text.includes("Wrong guess"),
      ),
    ).toBe(true);
    expect(h.lastGroup("clue turn")?.text).toContain("Round 2");
  });

  test("empty and over-long guesses do not consume the attempt", async () => {
    const h = await started();
    const { mrWhite, civilianWord } = await eliminateMrWhite(h);

    expect(await h.game.handle(h.dm(mrWhite, "guess"))).toContain(
      "Send a guess",
    );
    expect(
      await h.game.handle(h.dm(mrWhite, "guess", "a".repeat(101))),
    ).toContain("at most 100");

    expect(await h.game.handle(h.dm(mrWhite, "guess", civilianWord))).toBe("");
    expect(h.lastGroup("Mr. White wins")?.text).toBeDefined();
  });

  test("a second guess is refused", async () => {
    const h = await started();
    const { mrWhite } = await eliminateMrWhite(h);

    await h.game.handle(h.dm(mrWhite, "guess", "wrong one"));
    const again = await h.game.handle(h.dm(mrWhite, "guess", "another"));

    expect(again).toContain("No guess is open");
  });

  test("a guess from the group or from another player is refused", async () => {
    const h = await started();
    const { mrWhite, civilianWord } = await eliminateMrWhite(h);
    const other = h.players.find((player) => player.jid !== mrWhite.jid)!;

    expect(
      await h.game.handle(h.input(mrWhite, "guess", civilianWord)),
    ).toContain("in a DM");
    expect(await h.game.handle(h.dm(other, "guess", civilianWord))).toContain(
      "No guess is open",
    );
  });

  test("a guess timeout moves on without a win", async () => {
    const h = await started();
    const { mrWhite } = await eliminateMrWhite(h);

    h.advance(GUESS_MS);
    await h.game.expire(GROUP);

    expect(h.lastGroup("ran out of time")?.text).toBeDefined();
    expect(h.lastGroup("clue turn")?.text).toContain("Round 2");
    expect(h.sent.some((message) => message.text.includes("wins"))).toBe(false);
  });
});

describe("departures", () => {
  test("the leaver's turn is skipped immediately", async () => {
    const h = await started();
    const onTurn = h.turnPlayer(h.players)!;

    await h.game.onParticipantsUpdate({
      id: GROUP,
      action: "remove",
      participants: [{ id: onTurn.lid, phoneNumber: onTurn.jid } as never],
    });

    expect(h.lastGroup("turn skipped")?.text).toContain(onTurn.name);
    expect(h.turnPlayer(h.players)?.jid).not.toBe(onTurn.jid);
  });

  test("a departed voter no longer holds the vote open", async () => {
    const h = await started();
    await giveAllClues(h, h.players);
    const poll = h.polls[0]!;
    const [p1, p2, p3, p4] = h.players as [
      TestPlayer,
      TestPlayer,
      TestPlayer,
      TestPlayer,
    ];

    await h.castVote(poll, p1, p2);
    await h.castVote(poll, p2, p3);
    await h.castVote(poll, p3, p2);
    await h.castVote(poll, p4, p2);
    expect(h.lastGroup("was voted out")).toBeUndefined();

    await h.game.onParticipantsUpdate({
      id: GROUP,
      action: "remove",
      participants: [{ id: h.players[4]!.lid } as never],
    });

    expect(h.lastGroup("was voted out")?.text).toContain(p2.name);
  });

  test("a duplicate remove event changes nothing", async () => {
    const h = await started();
    const onTurn = h.turnPlayer(h.players)!;
    const participants = [{ id: onTurn.lid } as never];

    await h.game.onParticipantsUpdate({
      id: GROUP,
      action: "remove",
      participants,
    });
    const afterFirst = h.sent.length;
    await h.game.onParticipantsUpdate({
      id: GROUP,
      action: "remove",
      participants,
    });

    expect(h.sent.length).toBe(afterFirst);
  });

  test("a mid-game host departure hands over cancel rights", async () => {
    const h = await started();
    const host = h.players[0]!;
    const heir = h.players[1]!;

    await h.game.onParticipantsUpdate({
      id: GROUP,
      action: "remove",
      participants: [{ id: host.lid } as never],
    });

    expect(await h.game.handle(h.input(heir, "cancel"))).toBeNull();
    expect(h.lastGroup("cancelled")?.text).toBeDefined();
  });
});

describe("terminal states", () => {
  test("the host can cancel", async () => {
    const h = await started();

    expect(await h.game.handle(h.input(h.players[0]!, "cancel"))).toBeNull();
    expect(h.lastGroup("cancelled")?.text).toBeDefined();
    expect(h.store.listLive()).toHaveLength(0);
  });

  test("a finished game rejects further actions", async () => {
    const h = await started();
    await h.game.handle(h.input(h.players[0]!, "cancel"));

    expect(await h.game.handle(h.input(h.players[1]!, "status"))).toContain(
      "No Undercover game",
    );
    expect(
      await h.game.handle(h.input(h.players[1]!, "clue", "zzz")),
    ).toContain("No Undercover game");
  });

  test("ten rounds without a winner is a draw", async () => {
    const h = await started();
    const words = new Map(
      [...h.roles().entries()].map(([jid, entry]) => [jid, entry.word]),
    );

    for (let round = 1; round <= 10; round += 1) {
      await giveAllClues(h, h.players);
      h.advance(VOTE_MS);
      await h.game.expire(GROUP);
      // Keep the secret words out of a retried clue: nothing else to do here.
      void words;
    }

    const summary = h.lastGroup("GAME OVER")?.text ?? "";
    expect(summary).toContain("Draw");
    expect(summary).toContain("10-round limit");
  });

  test("restart recovery closes a live session", async () => {
    const h = harness();
    h.store.save(GROUP, "1@s.whatsapp.net", "CLUE_PHASE");

    await h.game.recover();

    expect(h.lastGroup("bot restarted")?.text).toBeDefined();
    expect(h.store.listLive()).toHaveLength(0);
  });

  test("recovery leaves a game still live in this process alone", async () => {
    const h = harness();
    const [player] = roster(1);
    await h.game.handle(h.input(player!, "join"));

    await h.game.recover();

    expect(h.lastGroup("bot restarted")).toBeUndefined();
    expect(h.store.listLive()).toHaveLength(1);
  });
});
