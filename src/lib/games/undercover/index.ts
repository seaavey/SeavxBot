/**
 * The Undercover game engine: one session per group, an explicit phase machine,
 * poll voting and a per-group serialization queue. Everything the game says
 * goes through `deps.send`; the socket is only needed for polls and for
 * decrypting a vote.
 */
import { randomBytes } from "node:crypto";
import {
  decryptPollVote,
  jidNormalizedUser,
  sha256,
  type GroupParticipant,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { getUndercover } from "@/lib/core/db";
import { logToFile } from "@/lib/core/logger";
import { labelFor, sameUser } from "@/lib/message/identity";
import { unwrapMessageContent } from "@/lib/message/messageContent";
import {
  CLUE_MS,
  GUESS_MS,
  LOBBY_IDLE_MS,
  MAX_CLUE_WORDS,
  MAX_GUESS_CODE_POINTS,
  MAX_PLAYERS,
  MAX_ROUNDS,
  MIN_PLAYERS,
  REVOTE_MS,
  VOTE_MS,
  activePlayers,
  assignRoles,
  evaluateWin,
  type Ballot,
  type GameOutcome,
  type Player,
  type Session,
} from "@/lib/games/undercover/rules";
import {
  clueTokens,
  containsSecret,
  normalizeSecretWord,
  pickWordPair,
} from "@/lib/games/undercover/word";
import type { UndercoverStore } from "@/lib/games/undercover/store";

export interface CommandInput {
  sock: WASocket;
  chatJid: string;
  isGroup: boolean;
  /** Always set: `pn || lid || chatJid` (parseMessage.ts:95). */
  senderJid: string;
  senderPn: string;
  senderLid: string;
  name: string;
  prefix: string;
  isAdmin: boolean;
  isOwner: boolean;
  args: string[];
}

interface PollRequest {
  jid: string;
  name: string;
  values: string[];
  secret: Uint8Array;
}

export interface GameDeps {
  /** Test seam; the default sends through the socket. False = not sent. */
  send?: (jid: string, text: string) => Promise<boolean>;
  /** Test seam; returns the poll's message id, null when it could not be sent. */
  poll?: (request: PollRequest) => Promise<string | null>;
  store?: UndercoverStore;
  now?: () => number;
  random?: () => number;
}

const GROUP_ONLY = "🚩 Play this in the group, not in a DM.";

/** Prefixes come from config.toml, so every hint carries the caller's own. */
function noSession(prefix: string): string {
  return `🚩 No Undercover game here. Start one with ${prefix}uc join.`;
}

function helpText(prefix: string): string {
  return [
    "🕵️ UNDERCOVER — how to play",
    "",
    `${prefix}uc join — create or join a lobby`,
    `${prefix}uc leave — leave a lobby before the start`,
    `${prefix}uc start — host/admin starts the game (5-12 players)`,
    `${prefix}uc status — round, players, whose turn`,
    `${prefix}uc clue <1-3 words> — your clue on your turn`,
    `${prefix}uc guess <word> — Mr. White, in DM, after elimination`,
    `${prefix}uc cancel — host/admin cancels the game`,
    "",
    "Civilians share one word, Undercover players share another,",
    "Mr. White has none. Vote out the odd ones out.",
  ].join("\n");
}

const PHASE_LABEL: Record<Session["phase"], string> = {
  LOBBY: "lobby",
  ROLE_ASSIGNMENT: "assigning roles",
  CLUE_PHASE: "clue phase",
  VOTING_PHASE: "voting",
  REVOTE_PHASE: "revote",
  MR_WHITE_GUESS: "Mr. White's guess",
  GAME_OVER: "game over",
};

export function createUndercover(deps: GameDeps = {}) {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const store = (): UndercoverStore => deps.store ?? getUndercover();

  const sessions = new Map<string, Session>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const queues = new Map<string, Promise<unknown>>();
  let socket: WASocket | undefined;

  /** One message at a time per group: state never interleaves at an await. */
  function queued<T>(groupJid: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(groupJid) ?? Promise.resolve();
    const next = previous.then(task, task);
    queues.set(
      groupJid,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  async function sendText(jid: string, text: string): Promise<boolean> {
    try {
      if (deps.send) return await deps.send(jid, text);
      if (!socket) return false;
      const sent = await socket.sendMessage(jid, { text });
      return Boolean(sent);
    } catch (err) {
      logToFile("UC_SEND_FAILED", { jid, error: String(err) });
      return false;
    }
  }

  async function sendPoll(request: PollRequest): Promise<string | null> {
    try {
      if (deps.poll) return await deps.poll(request);
      if (!socket) return null;
      const sent = await socket.sendMessage(request.jid, {
        poll: {
          name: request.name,
          values: request.values,
          selectableCount: 1,
          messageSecret: request.secret,
        },
      });
      return sent?.key?.id ?? null;
    } catch (err) {
      logToFile("UC_POLL_FAILED", {
        jid: request.jid,
        error: String(err),
      });
      return null;
    }
  }

  function clearTimer(groupJid: string): void {
    const timer = timers.get(groupJid);
    if (timer) clearTimeout(timer);
    timers.delete(groupJid);
  }

  function arm(session: Session): void {
    clearTimer(session.groupJid);
    const delay = Math.max(0, session.deadline - now());
    timers.set(
      session.groupJid,
      setTimeout(() => {
        void expire(session.groupJid);
      }, delay),
    );
  }

  function persist(session: Session): void {
    try {
      store().save(session.groupJid, session.hostId, session.phase);
    } catch (err) {
      // A lost row only costs the restart notice; the game must keep playing.
      console.error("Undercover persist failed:", err);
    }
  }

  function forget(session: Session): void {
    sessions.delete(session.groupJid);
    clearTimer(session.groupJid);
    try {
      store().drop(session.groupJid);
    } catch (err) {
      console.error("Undercover drop failed:", err);
    }
  }

  function findPlayer(session: Session, jid: string): Player | undefined {
    return session.players.find(
      (player) =>
        sameUser(player.id, jid) ||
        sameUser(player.pn, jid) ||
        sameUser(player.lid, jid),
    );
  }

  function playerById(session: Session, id: string): Player | undefined {
    return session.players.find((player) => player.id === id);
  }

  function currentTurnPlayer(session: Session): Player | undefined {
    for (
      let index = session.turn;
      index < session.turnOrder.length;
      index += 1
    ) {
      const id = session.turnOrder[index];
      const player = id ? playerById(session, id) : undefined;
      if (player && player.status === "active") {
        session.turn = index;
        return player;
      }
    }

    return undefined;
  }

  /**
   * Lobby numbering is positional, 1..N: a leave closes the gap so the list and
   * the poll options never show a hole. Frozen once the game starts.
   */
  function renumber(session: Session): void {
    for (const [index, player] of session.players.entries()) {
      player.number = index + 1;
    }
  }

  function shuffle<T>(values: T[]): T[] {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      const current = values[index];
      const chosen = values[swap];
      if (current === undefined || chosen === undefined) continue;
      values[index] = chosen;
      values[swap] = current;
    }

    return values;
  }

  function nameOf(session: Session, id: string): string {
    return playerById(session, id)?.name ?? labelFor(id);
  }

  function lobbyText(session: Session): string {
    const host = nameOf(session, session.hostId);

    return [
      "🕵️ UNDERCOVER — lobby",
      `Players: ${session.players.length}/${MAX_PLAYERS}`,
      `Host: ${host}`,
      "",
      ...session.players.map((player) => `${player.number}. ${player.name}`),
      "",
      `${session.prefix}uc join to join · ${session.prefix}uc start to begin`,
      `${MIN_PLAYERS}-${MAX_PLAYERS} players.`,
    ].join("\n");
  }

  function statusText(session: Session): string {
    const alive = activePlayers(session).length;
    const lines = [
      "🕵️ UNDERCOVER — status",
      `Round ${session.round}/${MAX_ROUNDS} · ${PHASE_LABEL[session.phase]}`,
      "",
      ...session.players.map((player) => {
        if (player.status === "eliminated") {
          return `${player.number}. ${player.name} — eliminated (${roleLabel(player.role)})`;
        }
        if (player.status === "departed") {
          return `${player.number}. ${player.name} — left`;
        }
        return `${player.number}. ${player.name} — active`;
      }),
    ];

    if (session.phase === "CLUE_PHASE") {
      const player = currentTurnPlayer(session);
      if (player) lines.push("", `Turn: ${player.number}. ${player.name}`);
    }

    if (session.phase === "VOTING_PHASE" || session.phase === "REVOTE_PHASE") {
      lines.push("", `Votes: ${session.ballot?.votes.size ?? 0}/${alive}`);
    }

    return lines.join("\n");
  }

  function roleLabel(role: Player["role"]): string {
    return role === "MR_WHITE" ? "MR. WHITE" : (role ?? "?");
  }

  function summaryText(session: Session): string {
    const outcome = session.outcome;
    if (!outcome) return "🛑 Undercover closed.";

    if (outcome.type === "CANCELLED") {
      return `🛑 Undercover cancelled (${outcome.reason}).`;
    }
    if (outcome.type === "ERROR") {
      return "🚩 Undercover closed after an internal error.";
    }

    const headline =
      outcome.type === "DRAW"
        ? outcome.reason === "ROUND_LIMIT"
          ? `🤝 Draw — the ${MAX_ROUNDS}-round limit was reached.`
          : "🤝 Draw — nobody was left in the game."
        : outcome.team === "MR_WHITE"
          ? "🏆 Mr. White wins — the Civilian word was guessed."
          : `🏆 ${outcome.team} wins.`;

    const lines = [
      "GAME OVER",
      "",
      headline,
      "",
      `Civilian word: ${session.words?.civilian ?? "-"}`,
      `Undercover word: ${session.words?.undercover ?? "-"}`,
      "",
      "Roles:",
      ...session.players.map(
        (player) =>
          `${player.number}. ${player.name} — ${roleLabel(player.role)}${
            player.status === "eliminated"
              ? ` (round ${player.eliminatedRound})`
              : player.status === "departed"
                ? " (left)"
                : ""
          }`,
      ),
      "",
      `Rounds played: ${session.round}`,
    ];

    if (session.eliminations.length > 0) {
      lines.push("", "Eliminated:");
      for (const entry of session.eliminations) {
        lines.push(
          `${entry.number}. ${entry.name} — ${roleLabel(entry.role)}, ${entry.votes} vote(s)`,
        );
      }
    }

    if (session.guessResult) {
      const label =
        session.guessResult === "CORRECT"
          ? "correct"
          : session.guessResult === "WRONG"
            ? "wrong"
            : session.guessResult === "TIMEOUT"
              ? "timed out"
              : "forfeited";
      lines.push("", `Mr. White's guess: ${label}`);
    }

    return lines.join("\n");
  }

  function roleText(player: Player, session: Session): string {
    if (player.role === "MR_WHITE") {
      return [
        "🕵️ UNDERCOVER — ROLE",
        "Your role: MR. WHITE",
        "You have no word.",
        "Listen to the clues, pretend you know the word, survive the vote.",
      ].join("\n");
    }

    const word =
      player.role === "UNDERCOVER"
        ? session.words?.undercover
        : session.words?.civilian;

    if (player.role === "UNDERCOVER") {
      return [
        "🕵️ UNDERCOVER — ROLE",
        "Your role: UNDERCOVER",
        `Your word: ${word ?? "-"}`,
        "Blend in. Never reveal that your word differs.",
      ].join("\n");
    }

    return [
      "🕵️ UNDERCOVER — ROLE",
      "Your role: CIVILIAN",
      `Your word: ${word ?? "-"}`,
      "Find the players whose word differs. Never share your word.",
    ].join("\n");
  }

  async function promptTurn(session: Session): Promise<void> {
    const player = currentTurnPlayer(session);
    if (!player) {
      await startVote(session);
      return;
    }

    session.deadline = now() + CLUE_MS;
    arm(session);

    await sendText(
      session.groupJid,
      [
        `🗣️ Round ${session.round} — clue turn`,
        "",
        `${player.number}. ${player.name}, send your clue (max ${MAX_CLUE_WORDS} words):`,
        `${session.prefix}uc clue <words>`,
        "",
        `${CLUE_MS / 1000}s`,
      ].join("\n"),
    );
  }

  async function beginRound(session: Session, round: number): Promise<void> {
    session.round = round;
    session.phase = "CLUE_PHASE";
    session.turnOrder = shuffle(activePlayers(session).map((p) => p.id));
    session.turn = 0;
    session.clues = [];
    session.ballot = undefined;
    session.tied = [];
    session.revoted = false;
    session.guess = undefined;
    persist(session);
    await promptTurn(session);
  }

  async function advanceTurn(session: Session): Promise<void> {
    session.turn += 1;
    session.ballot = undefined;
    persist(session);

    const next = currentTurnPlayer(session);
    if (!next) {
      await startVote(session);
      return;
    }

    await promptTurn(session);
  }

  async function startVote(session: Session): Promise<void> {
    session.phase = "VOTING_PHASE";
    session.tied = [];
    session.revoted = false;
    session.ballot = undefined;
    persist(session);

    await openPoll(
      session,
      activePlayers(session),
      VOTE_MS,
      `Round ${session.round} vote — who is the impostor?`,
    );
  }

  async function openPoll(
    session: Session,
    candidates: Player[],
    durationMs: number,
    name: string,
  ): Promise<void> {
    const values = candidates.map((p) => `${p.number}. ${p.name}`);
    const secret = new Uint8Array(randomBytes(32));

    let messageId: string | null = null;
    for (let attempt = 0; attempt < 2 && !messageId; attempt += 1) {
      messageId = await sendPoll({
        jid: session.groupJid,
        name,
        values,
        secret,
      });
    }

    if (!messageId) {
      session.ballot = undefined;
      await sendText(
        session.groupJid,
        "🚩 The vote could not be opened, so nobody is eliminated this round.",
      );
      await afterVote(session);
      return;
    }

    session.ballot = {
      messageId,
      secret,
      options: values.map((value, index) => ({
        hash: sha256(Buffer.from(value)).toString("hex"),
        playerId: candidates[index]?.id ?? "",
      })),
      votes: new Map(),
    };
    session.deadline = now() + durationMs;
    arm(session);

    await sendText(
      session.groupJid,
      [
        `🗳️ ${name}`,
        "",
        `Tap an option. Closes as soon as everyone has voted, or after ${durationMs / 1000}s.`,
      ].join("\n"),
    );
  }

  async function closeVote(session: Session): Promise<void> {
    const ballot: Ballot | undefined = session.ballot;
    if (!ballot) {
      await afterVote(session);
      return;
    }

    clearTimer(session.groupJid);

    const tally = new Map<string, number>();
    for (const [voterId, targetId] of ballot.votes) {
      const voter = playerById(session, voterId);
      const target = playerById(session, targetId);
      if (voter?.status !== "active") continue;
      if (target?.status !== "active") continue;
      tally.set(targetId, (tally.get(targetId) ?? 0) + 1);
    }

    if (tally.size === 0) {
      await sendText(
        session.groupJid,
        "🗳️ No valid votes were cast. Nobody is eliminated.",
      );
      await afterVote(session);
      return;
    }

    const top = Math.max(...tally.values());
    const leaders = [...tally.entries()]
      .filter(([, count]) => count === top)
      .map(([id]) => id);

    if (leaders.length > 1) {
      if (session.revoted) {
        await sendText(
          session.groupJid,
          "🗳️ Still tied after the revote. Nobody is eliminated.",
        );
        await afterVote(session);
        return;
      }

      session.revoted = true;
      session.phase = "REVOTE_PHASE";
      session.tied = leaders;
      persist(session);

      const candidates = leaders
        .map((id) => playerById(session, id))
        .filter((player): player is Player => Boolean(player));

      await sendText(
        session.groupJid,
        `🗳️ Tie: ${candidates.map((p) => p.name).join(", ")}. One revote, ${REVOTE_MS / 1000}s.`,
      );
      await openPoll(
        session,
        candidates,
        REVOTE_MS,
        `Revote — round ${session.round}`,
      );
      return;
    }

    const eliminatedId = leaders[0];
    const eliminated = eliminatedId
      ? playerById(session, eliminatedId)
      : undefined;
    if (!eliminated) {
      await afterVote(session);
      return;
    }

    await eliminate(session, eliminated, top);
  }

  async function eliminate(
    session: Session,
    player: Player,
    votes: number,
  ): Promise<void> {
    if (player.status !== "active") return;

    player.status = "eliminated";
    player.eliminatedRound = session.round;
    player.votesReceived = votes;
    session.eliminations.push({
      number: player.number,
      name: player.name,
      role: player.role ?? "CIVILIAN",
      votes,
    });
    session.ballot = undefined;
    clearTimer(session.groupJid);
    persist(session);

    await sendText(
      session.groupJid,
      [
        "🚪 Eliminated",
        "",
        `${player.number}. ${player.name} was voted out.`,
        `Role: ${roleLabel(player.role)}`,
        `Votes: ${votes}`,
      ].join("\n"),
    );

    if (player.role === "MR_WHITE") {
      await openGuess(session, player);
      return;
    }

    await afterVote(session);
  }

  async function openGuess(session: Session, player: Player): Promise<void> {
    session.phase = "MR_WHITE_GUESS";
    session.deadline = now() + GUESS_MS;
    session.guess = {
      playerId: player.id,
      deadline: session.deadline,
      attemptUsed: false,
    };
    persist(session);
    arm(session);

    const text = [
      "You were eliminated, but you are MR. WHITE!",
      "",
      "You have one chance to name the Civilian word.",
      "",
      `${session.prefix}uc guess <word>`,
      "",
      `${GUESS_MS / 1000}s.`,
    ].join("\n");

    let delivered = await sendText(player.id, text);
    if (!delivered) delivered = await sendText(player.id, text);

    await sendText(
      session.groupJid,
      `🕵️ Mr. White has ${GUESS_MS / 1000}s to guess the Civilian word in DM.`,
    );

    if (!delivered) {
      await sendText(
        session.groupJid,
        "🚩 The guess prompt could not be delivered, so the guess is forfeited.",
      );
      await resolveGuess(session, "FORFEIT");
    }
  }

  async function resolveGuess(
    session: Session,
    result: "CORRECT" | "WRONG" | "TIMEOUT" | "FORFEIT",
  ): Promise<void> {
    const guess = session.guess;
    if (!guess) return;

    clearTimer(session.groupJid);
    session.guessResult = result;

    if (result === "CORRECT") {
      await finish(session, { type: "WIN", team: "MR_WHITE" });
      return;
    }

    session.guess = undefined;
    persist(session);
    await afterVote(session);
  }

  async function afterVote(session: Session): Promise<void> {
    const outcome = evaluateWin(session);
    if (outcome) {
      await finish(session, outcome);
      return;
    }

    if (session.round >= MAX_ROUNDS) {
      await finish(session, { type: "DRAW", reason: "ROUND_LIMIT" });
      return;
    }

    await beginRound(session, session.round + 1);
  }

  async function finish(session: Session, outcome: GameOutcome): Promise<void> {
    if (session.outcome) return;

    session.outcome = outcome;
    session.phase = "GAME_OVER";
    clearTimer(session.groupJid);
    const text = summaryText(session);
    forget(session);
    await sendText(session.groupJid, text);
  }

  async function expire(groupJid: string): Promise<void> {
    await queued(groupJid, async () => {
      const session = sessions.get(groupJid);
      if (!session) {
        clearTimer(groupJid);
        return;
      }
      if (now() < session.deadline) return;

      switch (session.phase) {
        case "LOBBY":
          await finish(session, { type: "CANCELLED", reason: "lobby idle" });
          return;
        case "CLUE_PHASE": {
          const player = currentTurnPlayer(session);
          if (player) {
            await sendText(
              session.groupJid,
              `⏭️ ${player.number}. ${player.name} ran out of time. Turn skipped.`,
            );
          }
          await advanceTurn(session);
          return;
        }
        case "VOTING_PHASE":
        case "REVOTE_PHASE":
          await closeVote(session);
          return;
        case "MR_WHITE_GUESS":
          await sendText(session.groupJid, "⏭️ Mr. White ran out of time.");
          await resolveGuess(session, "TIMEOUT");
          return;
        default:
          clearTimer(groupJid);
      }
    });
  }

  async function handlePollVote(
    sock: WASocket,
    raw: WAMessage,
  ): Promise<boolean> {
    const update = unwrapMessageContent(raw.message)?.pollUpdateMessage;
    const pollId = update?.pollCreationMessageKey?.id;
    if (!update?.vote || !pollId) return false;

    const target = [...sessions.values()].find(
      (session) => session.ballot?.messageId === pollId,
    );
    if (!target) return false;

    const voters = [raw.key?.participant, raw.key?.participantAlt].filter(
      (jid): jid is string => Boolean(jid),
    );
    const creators = [sock.user?.lid, sock.user?.id]
      .filter((jid): jid is string => Boolean(jid))
      .map(jidNormalizedUser);

    for (const creator of creators) {
      for (const voter of voters) {
        let decoded: { selectedOptions?: (Uint8Array | null)[] } | undefined;
        try {
          decoded = decryptPollVote(update.vote, {
            pollCreatorJid: creator,
            pollMsgId: pollId,
            pollEncKey: target.ballot?.secret ?? new Uint8Array(),
            voterJid: voter,
          });
        } catch {
          // Wrong identity pairing: the GCM tag fails, try the next one.
          continue;
        }

        const hashes = (decoded.selectedOptions ?? []).map((option) =>
          Buffer.from(option ?? new Uint8Array()).toString("hex"),
        );
        const chosen = hashes
          .map((hash) =>
            target.ballot?.options.find((option) => option.hash === hash),
          )
          .find((option) => option !== undefined);
        if (!chosen?.playerId) return true;

        await queued(target.groupJid, () =>
          recordVote(target.groupJid, voter, chosen.playerId),
        );
        return true;
      }
    }

    logToFile("UC_VOTE_DROPPED", {
      groupJid: target.groupJid,
      pollId,
      error: "no identity pair authenticated",
    });

    return true;
  }

  async function recordVote(
    groupJid: string,
    voterJid: string,
    targetId: string,
  ): Promise<void> {
    const session = sessions.get(groupJid);
    const ballot = session?.ballot;
    if (!session || !ballot) return;
    if (session.phase !== "VOTING_PHASE" && session.phase !== "REVOTE_PHASE") {
      return;
    }
    if (now() > session.deadline) return;

    const voter = findPlayer(session, voterJid);
    if (!voter || voter.status !== "active") return;
    if (ballot.votes.has(voter.id)) return;

    const voted = playerById(session, targetId);
    if (!voted || voted.status !== "active" || voted.id === voter.id) return;

    ballot.votes.set(voter.id, voted.id);
    persist(session);

    if (activePlayers(session).every((player) => ballot.votes.has(player.id))) {
      await closeVote(session);
    }
  }

  async function join(input: CommandInput): Promise<string> {
    const groupJid = input.chatJid;
    const elsewhere = [...sessions.values()].find(
      (session) =>
        session.groupJid !== groupJid && findPlayer(session, input.senderJid),
    );
    if (elsewhere) {
      return "🚩 You are already playing in another group.";
    }

    let session = sessions.get(groupJid);
    if (!session) {
      session = {
        id: randomBytes(8).toString("hex"),
        groupJid,
        prefix: input.prefix || ".",
        hostId: "",
        phase: "LOBBY",
        round: 0,
        players: [],
        turnOrder: [],
        turn: 0,
        clues: [],
        revoted: false,
        tied: [],
        deadline: now() + LOBBY_IDLE_MS,
        eliminations: [],
      };
      sessions.set(groupJid, session);
    }

    if (session.phase !== "LOBBY") {
      return "🚩 A game is already running in this group.";
    }
    if (findPlayer(session, input.senderJid)) {
      return "🚩 You already joined this lobby.";
    }
    if (session.players.length >= MAX_PLAYERS) {
      return `🚩 This lobby is full (${MAX_PLAYERS}).`;
    }

    const id = input.senderPn || input.senderLid || input.senderJid;
    session.players.push({
      id,
      pn: input.senderPn,
      lid: input.senderLid,
      name: input.name || labelFor(id),
      number: session.players.length + 1,
      status: "active",
    });
    if (!session.hostId) session.hostId = id;

    session.deadline = now() + LOBBY_IDLE_MS;
    persist(session);
    arm(session);

    return lobbyText(session);
  }

  async function leave(input: CommandInput): Promise<string> {
    const session = sessions.get(input.chatJid);
    if (!session || session.phase !== "LOBBY") {
      return "🚩 You can only leave a lobby that has not started.";
    }

    const player = findPlayer(session, input.senderJid);
    if (!player) return "🚩 You are not in this lobby.";

    session.players = session.players.filter((p) => p.id !== player.id);
    if (session.players.length === 0) {
      forget(session);
      return "🚪 The lobby is empty and has been closed.";
    }
    renumber(session);

    if (session.hostId === player.id) {
      session.hostId = session.players[0]?.id ?? "";
    }

    persist(session);
    arm(session);

    return lobbyText(session);
  }

  async function start(input: CommandInput): Promise<string | null> {
    const session = sessions.get(input.chatJid);
    if (!session) return noSession(input.prefix);
    if (session.phase !== "LOBBY") return "🚩 The game already started.";

    const actor = findPlayer(session, input.senderJid);
    const isHost = Boolean(actor && actor.id === session.hostId);
    if (!isHost && !input.isAdmin && !input.isOwner) {
      return "🚩 Only the host or a group admin can start.";
    }
    if (session.players.length < MIN_PLAYERS) {
      return `🚩 Need at least ${MIN_PLAYERS} players (${session.players.length}/${MAX_PLAYERS}).`;
    }

    const groupJid = session.groupJid;
    const pair = pickWordPair(random, lastPair(groupJid));
    if (!pair) return "🚩 No valid word pair is available.";

    session.phase = "ROLE_ASSIGNMENT";
    session.words = { civilian: pair.civilian, undercover: pair.undercover };
    session.canonical = {
      civilian: normalizeSecretWord(pair.civilian),
      undercover: normalizeSecretWord(pair.undercover),
    };
    assignRoles(session.players, random);
    clearTimer(groupJid);

    for (const player of session.players) {
      const delivered = await sendText(player.id, roleText(player, session));
      if (!delivered) {
        forget(session);
        await sendText(
          groupJid,
          `🚩 Start cancelled: a role could not be sent to ${player.name} in DM. Fix DM access, then build a new lobby.`,
        );
        return null;
      }
    }

    rememberPair(groupJid, pair.id);
    await sendText(
      groupJid,
      `🎮 UNDERCOVER started with ${session.players.length} players. Your role is in your DM.`,
    );
    await beginRound(session, 1);

    return null;
  }

  function lastPair(groupJid: string): string | null {
    try {
      return store().lastPair(groupJid);
    } catch {
      return null;
    }
  }

  function rememberPair(groupJid: string, pairId: string): void {
    try {
      store().setLastPair(groupJid, pairId);
    } catch (err) {
      console.error("Undercover last-pair write failed:", err);
    }
  }

  async function clue(
    input: CommandInput,
    text: string,
  ): Promise<string | null> {
    const session = sessions.get(input.chatJid);
    if (!session) return noSession(input.prefix);
    if (session.phase !== "CLUE_PHASE") return "🚩 No clue turn is open.";
    // The timer callback is what advances a turn; a clue that lands after the
    // deadline but before the callback must not slip in.
    if (now() > session.deadline) return "🚩 Time is up for this turn.";

    const player = findPlayer(session, input.senderJid);
    if (!player || player.status !== "active") {
      return "🚩 Only active players give clues.";
    }

    const current = currentTurnPlayer(session);
    if (!current || current.id !== player.id) {
      return "🚩 It is not your turn.";
    }

    const words = clueTokens(text);
    if (words.length === 0) {
      return `🚩 Send a clue: ${input.prefix}uc clue <1-${MAX_CLUE_WORDS} words>.`;
    }
    if (words.length > MAX_CLUE_WORDS) {
      return `🚩 A clue is at most ${MAX_CLUE_WORDS} words.`;
    }

    const own =
      player.role === "CIVILIAN"
        ? session.canonical?.civilian
        : player.role === "UNDERCOVER"
          ? session.canonical?.undercover
          : undefined;
    if (own && containsSecret(text, own)) {
      return "🚩 That clue contains your secret word. Send another one.";
    }

    session.clues.push({
      playerId: player.id,
      text: text.trim(),
      round: session.round,
    });
    persist(session);

    await sendText(
      session.groupJid,
      `💬 ${player.number}. ${player.name}: ${text.trim()}`,
    );
    await advanceTurn(session);

    return null;
  }

  async function guess(
    groupJid: string,
    input: CommandInput,
    text: string,
  ): Promise<string> {
    const session = sessions.get(groupJid);
    const guess = session?.guess;
    if (!session || !guess) return "🚩 No guess is open right now.";
    if (session.phase !== "MR_WHITE_GUESS")
      return "🚩 No guess is open right now.";
    if (now() > guess.deadline) return "🚩 The guess window has closed.";
    if (guess.attemptUsed) return "🚩 You already used your guess.";

    const trimmed = text.trim();
    const canonical = normalizeSecretWord(trimmed);
    if (!canonical) {
      return `🚩 Send a guess: ${input.prefix}uc guess <word>.`;
    }
    if ([...trimmed].length > MAX_GUESS_CODE_POINTS) {
      return `🚩 A guess is at most ${MAX_GUESS_CODE_POINTS} characters.`;
    }

    guess.attemptUsed = true;
    persist(session);

    if (canonical === session.canonical?.civilian) {
      await sendText(input.senderJid, "✅ Correct guess.");
      await resolveGuess(session, "CORRECT");
      return "";
    }

    await sendText(input.senderJid, "❌ Wrong guess.");
    await resolveGuess(session, "WRONG");

    return "";
  }

  async function status(input: CommandInput): Promise<string> {
    const session = sessions.get(input.chatJid);
    if (!session) return noSession(input.prefix);
    return statusText(session);
  }

  function info(input: CommandInput): string {
    const session = sessions.get(input.chatJid);
    if (session && session.phase !== "LOBBY") return statusText(session);
    return [
      "🕵️ UNDERCOVER — social deduction",
      "",
      "One group, one word for the Civilians, a different one for the",
      "Undercover, and Mr. White with no word at all.",
      "",
      `${input.prefix}uc join to start a lobby · ${input.prefix}uc help for the rules`,
    ].join("\n");
  }

  async function cancel(input: CommandInput): Promise<string | null> {
    const session = sessions.get(input.chatJid);
    if (!session) return noSession(input.prefix);

    const actor = findPlayer(session, input.senderJid);
    const allowed =
      Boolean(actor && actor.id === session.hostId) ||
      input.isAdmin ||
      input.isOwner;
    if (!allowed) return "🚩 Only the host or a group admin can cancel.";

    await finish(session, { type: "CANCELLED", reason: "cancelled by host" });
    return null;
  }

  async function depart(groupJid: string, playerId: string): Promise<void> {
    const session = sessions.get(groupJid);
    if (!session) return;

    const player = playerById(session, playerId);
    if (!player || player.status !== "active") return;

    if (session.phase === "LOBBY") {
      session.players = session.players.filter((p) => p.id !== player.id);
      if (session.players.length === 0) {
        forget(session);
        await sendText(groupJid, "🚪 The lobby is empty and has been closed.");
        return;
      }
      renumber(session);
      if (session.hostId === player.id) {
        session.hostId = session.players[0]?.id ?? "";
      }
      persist(session);
      arm(session);
      // The list changed: show it, or the group sees a roster that dropped
      // someone without saying so.
      await sendText(groupJid, lobbyText(session));
      return;
    }

    // Checked before the status change: currentTurnPlayer skips departed
    // players, so after the mutation the leaver is never the "current" one.
    const wasOnTurn =
      session.phase === "CLUE_PHASE" &&
      currentTurnPlayer(session)?.id === player.id;

    player.status = "departed";
    if (session.hostId === player.id) {
      const next = activePlayers(session)[0];
      session.hostId = next?.id ?? session.hostId;
    }
    persist(session);

    if (
      session.phase === "MR_WHITE_GUESS" &&
      session.guess?.playerId === player.id
    ) {
      await sendText(groupJid, "🕵️ Mr. White left; the guess is forfeited.");
      await resolveGuess(session, "FORFEIT");
      return;
    }

    if (session.phase === "CLUE_PHASE" && wasOnTurn) {
      await sendText(groupJid, `⏭️ ${player.name} left; turn skipped.`);
      await advanceTurn(session);
      return;
    }

    if (session.phase === "VOTING_PHASE" || session.phase === "REVOTE_PHASE") {
      session.ballot?.votes.delete(player.id);
      const ballot = session.ballot;
      if (
        ballot &&
        activePlayers(session).every((p) => ballot.votes.has(p.id))
      ) {
        await closeVote(session);
        return;
      }
    }

    const outcome = evaluateWin(session);
    if (outcome) await finish(session, outcome);
  }

  async function handle(input: CommandInput): Promise<string | null> {
    const [sub = "", ...rest] = input.args;
    const topic = sub.toLowerCase();
    const text = rest.join(" ");

    if (topic === "guess") {
      if (input.isGroup) return "🚩 Send your guess in a DM, not in the group.";
      const owner = [...sessions.values()].find(
        (session) =>
          session.phase === "MR_WHITE_GUESS" &&
          session.guess &&
          findPlayer(session, input.senderJid)?.id === session.guess.playerId,
      );
      if (!owner) return "🚩 No guess is open right now.";
      return queued(owner.groupJid, () => guess(owner.groupJid, input, text));
    }

    if (topic === "help") return helpText(input.prefix);
    if (!input.isGroup) return GROUP_ONLY;

    if (topic === "") {
      return queued(input.chatJid, async () => info(input));
    }

    if (
      topic !== "join" &&
      topic !== "leave" &&
      topic !== "start" &&
      topic !== "status" &&
      topic !== "cancel" &&
      topic !== "clue"
    ) {
      return `🚩 Unknown command: ${input.prefix}uc ${sub}\n\n${helpText(input.prefix)}`;
    }

    return queued(input.chatJid, async () => {
      switch (topic) {
        case "join":
          return join(input);
        case "leave":
          return leave(input);
        case "start":
          return start(input);
        case "status":
          return status(input);
        case "cancel":
          return cancel(input);
        default:
          return clue(input, text);
      }
    });
  }

  return {
    setSocket(next: WASocket): void {
      socket = next;
    },
    handle,
    handlePollVote,
    expire,
    async onParticipantsUpdate(update: {
      id: string;
      action: string;
      participants: GroupParticipant[];
    }): Promise<void> {
      if (update.action !== "remove") return;
      const session = sessions.get(update.id);
      if (!session) return;

      for (const participant of update.participants) {
        const player = session.players.find(
          (candidate) =>
            sameUser(candidate.id, participant.id) ||
            sameUser(candidate.pn, participant.phoneNumber) ||
            sameUser(candidate.lid, participant.lid) ||
            sameUser(candidate.pn, participant.id) ||
            sameUser(candidate.lid, participant.id),
        );
        if (!player) continue;
        await queued(session.groupJid, () =>
          depart(session.groupJid, player.id),
        );
      }
    },
    async recover(): Promise<void> {
      let rows: { groupJid: string }[] = [];
      try {
        rows = store().listLive();
      } catch (err) {
        console.error("Undercover recovery read failed:", err);
        return;
      }

      for (const row of rows) {
        // A reopen is not a restart: a game still in memory keeps playing, and
        // its row is what makes the next real restart able to warn the group.
        if (sessions.has(row.groupJid)) continue;

        try {
          store().drop(row.groupJid);
        } catch (err) {
          console.error("Undercover recovery drop failed:", err);
        }
        await sendText(
          row.groupJid,
          "🛑 The bot restarted, so this Undercover session is closed. Build a new lobby with .uc join.",
        );
      }
    },
  };
}

export const undercover = createUndercover();
