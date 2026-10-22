/**
 * The Werewolf engine: one session per group, an explicit phase table, a
 * per-group serialization queue and one deadline timer. Everything the game says
 * goes through `deps.send`; the socket is only the default transport.
 */
import { randomBytes } from "node:crypto";
import type { GroupParticipant, WASocket } from "@whiskeysockets/baileys";
import { getWerewolf } from "@/lib/core/db";
import { logToFile } from "@/lib/core/logger";
import { labelFor, sameUser } from "@/lib/message/identity";
import {
  DISCUSSION_MS,
  FACTION,
  LOBBY_IDLE_MS,
  MAX_PLAYERS,
  MAX_ROUNDS,
  MIN_PLAYERS,
  NIGHT_MS,
  RUNOFF_MS,
  VOTE_MS,
  assignRoles,
  evaluateWin,
  kill,
  livingPlayers,
  nightVictim,
  tallyVotes,
  type Faction,
  type GameOutcome,
  type Phase,
  type Player,
  type Role,
  type Session,
} from "@/lib/games/werewolf/rules";
import type { WerewolfStore } from "@/lib/games/werewolf/store";

export interface CommandInput {
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

export interface GameDeps {
  /** Test seam; the default sends through the socket. False = not sent. */
  send?: (jid: string, text: string) => Promise<boolean>;
  store?: WerewolfStore;
  now?: () => number;
  random?: () => number;
}

const GROUP_ONLY = "🚩 Play this in the group, not in a DM.";
const NO_GAME = "🚩 No Werewolf game is running.";
const NOT_IN_GAME = "🚩 You are not in this game.";

/** The spec's table, verbatim: an edge that is not listed cannot be taken. */
const TRANSITIONS: Record<Phase, Phase[]> = {
  LOBBY: ["ROLE_ASSIGNMENT", "GAME_OVER"],
  ROLE_ASSIGNMENT: ["NIGHT_ACTIONS", "GAME_OVER"],
  NIGHT_ACTIONS: ["NIGHT_RESOLUTION", "GAME_OVER"],
  NIGHT_RESOLUTION: ["DAWN", "GAME_OVER"],
  DAWN: ["DAY_DISCUSSION"],
  DAY_DISCUSSION: ["DAY_VOTING", "GAME_OVER"],
  DAY_VOTING: ["DAY_RUNOFF", "VOTE_RESOLUTION", "GAME_OVER"],
  DAY_RUNOFF: ["VOTE_RESOLUTION", "GAME_OVER"],
  VOTE_RESOLUTION: ["NIGHT_ACTIONS", "GAME_OVER"],
  GAME_OVER: [],
};

const PHASE_LABEL: Record<Phase, string> = {
  LOBBY: "lobby",
  ROLE_ASSIGNMENT: "assigning roles",
  NIGHT_ACTIONS: "werewolf night",
  NIGHT_RESOLUTION: "resolving the night",
  DAWN: "dawn",
  DAY_DISCUSSION: "discussion",
  DAY_VOTING: "voting",
  DAY_RUNOFF: "runoff",
  VOTE_RESOLUTION: "resolving the vote",
  GAME_OVER: "game over",
};

const FACTION_LABEL: Record<Faction, string> = {
  VILLAGE: "Village",
  WEREWOLF: "Werewolf",
};

/** The one place a role becomes text. */
function roleLabel(role: Role): string {
  return role;
}

function noSession(prefix: string): string {
  return `🚩 No Werewolf game here. Start one with ${prefix}ww join.`;
}

function helpText(prefix: string): string {
  return [
    "🐺 WEREWOLF — how to play",
    "",
    `${prefix}ww join — create or join a lobby`,
    `${prefix}ww leave — leave a lobby before the start`,
    `${prefix}ww start — host/admin starts the game (5-12 players)`,
    `${prefix}ww status — day, phase and who is alive`,
    `${prefix}ww vote <n> — your daytime vote`,
    `${prefix}ww act <n> — your night action (DM only)`,
    `${prefix}ww skip — host/admin ends the discussion early`,
    `${prefix}ww cancel — host/admin cancels the game`,
    "",
    "Village wins when every Werewolf is dead. Werewolves win at parity.",
  ].join("\n");
}

function infoText(prefix: string): string {
  return [
    "🐺 WEREWOLF — social deduction",
    "Villagers hunt the Werewolves by day; Werewolves hunt them by night.",
    "The Seer sees factions, the Doctor saves one life each night.",
    "",
    `${prefix}ww join to start a lobby · ${prefix}ww help for the rules`,
  ].join("\n");
}

/** `3. Cid` lines for a set of players, by their frozen lobby number. */
function rosterLines(players: Player[]): string[] {
  return players.map((player) => `${player.number}. ${player.name}`);
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function remainingSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

function seconds(ms: number): string {
  return `${ms / 1000}s`;
}

export function createWerewolf(deps: GameDeps = {}) {
  const now = deps.now ?? Date.now;
  const random =
    deps.random ?? (() => randomBytes(4).readUInt32BE(0) / 0x1_0000_0000);
  const store = (): WerewolfStore => deps.store ?? getWerewolf();

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
      logToFile("WW_SEND_FAILED", { jid, error: String(err) });
      return false;
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
      store().save(
        session.groupJid,
        session.hostId,
        session.phase,
        session.round,
      );
    } catch (err) {
      // A lost row only costs the restart notice; the game must keep playing.
      console.error("Werewolf persist failed:", err);
    }
  }

  function forget(session: Session): void {
    sessions.delete(session.groupJid);
    clearTimer(session.groupJid);
    try {
      store().drop(session.groupJid);
    } catch (err) {
      console.error("Werewolf drop failed:", err);
    }
  }

  function setPhase(session: Session, next: Phase): void {
    if (!TRANSITIONS[session.phase].includes(next)) {
      throw new Error(`illegal transition ${session.phase} -> ${next}`);
    }
    session.phase = next;
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

  function playerByNumber(
    session: Session,
    number: number,
  ): Player | undefined {
    return session.players.find((player) => player.number === number);
  }

  function nameOf(session: Session, id: string): string {
    return playerById(session, id)?.name ?? labelFor(id);
  }

  /** Lobby numbering is positional, 1..N; frozen once the game starts. */
  function renumber(session: Session): void {
    for (const [index, player] of session.players.entries()) {
      player.number = index + 1;
    }
  }

  function nightActors(session: Session): Player[] {
    return livingPlayers(session).filter(
      (player) =>
        player.role === "WEREWOLF" ||
        player.role === "DOCTOR" ||
        player.role === "SEER",
    );
  }

  function allNightActorsActed(session: Session): boolean {
    return nightActors(session).every((player) => session.night.has(player.id));
  }

  function allLivingVoted(session: Session): boolean {
    return livingPlayers(session).every((player) =>
      session.votes.has(player.id),
    );
  }

  function townOf(session: Session): Player[] {
    return livingPlayers(session);
  }

  function wolves(session: Session): Player[] {
    return livingPlayers(session).filter(
      (player) => player.role && FACTION[player.role] === "WEREWOLF",
    );
  }

  function isHostOrAdmin(session: Session, input: CommandInput): boolean {
    const actor = findPlayer(session, input.senderJid);
    return (
      Boolean(actor && actor.id === session.hostId) ||
      input.isAdmin ||
      input.isOwner
    );
  }

  // ---- message builders (the spec's "Message texts", verbatim) ----

  function lobbyText(session: Session): string {
    return [
      "🐺 WEREWOLF — lobby",
      `Players: ${session.players.length}/${MAX_PLAYERS}`,
      `Host: ${nameOf(session, session.hostId)}`,
      "",
      ...rosterLines(session.players),
      "",
      `${session.prefix}ww join to join · ${session.prefix}ww start to begin`,
      `${MIN_PLAYERS}-${MAX_PLAYERS} players.`,
    ].join("\n");
  }

  function roleCardText(player: Player, session: Session): string {
    const role = player.role;
    if (!role) throw new Error("role card for a player without a role");

    const head = [
      "🐺 WEREWOLF — ROLE",
      `Your role: ${roleLabel(role)}`,
      `Faction: ${FACTION_LABEL[FACTION[role]]}`,
    ];

    if (role === "WEREWOLF") {
      const pack = livingPlayers(session).filter(
        (mate) =>
          mate.id !== player.id &&
          mate.role !== undefined &&
          FACTION[mate.role] === "WEREWOLF",
      );
      return [
        ...head,
        `Your teammates: ${pack.length > 0 ? rosterLines(pack).join(", ") : "none."}`,
        "Each night your pack picks one victim.",
        `Send ${session.prefix}ww act <number> in this DM when the night opens.`,
      ].join("\n");
    }

    if (role === "VILLAGER") {
      return [
        ...head,
        "No night action. Argue well by day and vote out the wolves.",
      ].join("\n");
    }

    if (role === "SEER") {
      return [
        ...head,
        "Each night you may learn one player's faction.",
        `Send ${session.prefix}ww act <number> in this DM when the night opens.`,
      ].join("\n");
    }

    return [
      ...head,
      "Each night you may protect one player from the wolves, yourself included.",
      `Send ${session.prefix}ww act <number> in this DM when the night opens.`,
    ].join("\n");
  }

  function nightPromptText(player: Player, session: Session): string {
    const role = player.role;
    if (!role) throw new Error("night prompt for a player without a role");

    if (role === "WEREWOLF") {
      const pack = wolves(session).filter((mate) => mate.id !== player.id);
      const targets = livingPlayers(session).filter(
        (target) =>
          target.role !== undefined && FACTION[target.role] !== "WEREWOLF",
      );

      return [
        `🌙 NIGHT ${session.round} — WEREWOLF`,
        `Living teammates: ${pack.length > 0 ? rosterLines(pack).join(", ") : "none."}`,
        "",
        "Pick a victim:",
        ...rosterLines(targets),
        "",
        `${session.prefix}ww act <number> · ${seconds(NIGHT_MS)}.`,
      ].join("\n");
    }

    if (role === "DOCTOR") {
      return [
        `🌙 NIGHT ${session.round} — DOCTOR`,
        "Protect one player:",
        ...rosterLines(townOf(session)),
        "",
        `${session.prefix}ww act <number> · ${seconds(NIGHT_MS)}.`,
      ].join("\n");
    }

    return [
      `🌙 NIGHT ${session.round} — SEER`,
      "Inspect one player:",
      ...rosterLines(townOf(session)),
      "",
      `${session.prefix}ww act <number> · ${seconds(NIGHT_MS)}.`,
    ].join("\n");
  }

  function nightOpenText(session: Session): string {
    return [
      `🌙 NIGHT ${session.round}`,
      `The werewolves are choosing. ${seconds(NIGHT_MS)}.`,
    ].join("\n");
  }

  function actReceiptText(
    player: Player,
    target: Player,
    replaced: boolean,
  ): string {
    const verb = replaced ? "updated" : "recorded";
    return `✅ Target ${verb}: ${target.number}. ${target.name}.`;
  }

  function seerResultText(
    target: Player,
    isWolf: boolean,
    round: number,
  ): string {
    return [
      `🔮 NIGHT ${round} — RESULT`,
      `${target.number}. ${target.name} is ${isWolf ? "a WEREWOLF." : "not a WEREWOLF."}`,
    ].join("\n");
  }

  function dawnText(session: Session, dead: Player[]): string {
    const lines = [`🌅 DAY ${session.round} — dawn`];
    if (dead.length === 0) {
      lines.push("Nobody died in the night.");
    } else {
      for (const player of dead) {
        lines.push(
          `${player.number}. ${player.name} died in the night. Role: ${roleLabel(player.role ?? "VILLAGER")}.`,
        );
      }
    }
    return lines.join("\n");
  }

  function discussionPromptText(session: Session): string {
    return [
      `💬 DAY ${session.round} — discussion`,
      `Talk it out. Voting opens in ${seconds(DISCUSSION_MS)}.`,
    ].join("\n");
  }

  function votePromptText(session: Session): string {
    return [
      `🗳️ DAY ${session.round} — vote`,
      ...rosterLines(townOf(session)),
      "",
      `${session.prefix}ww vote <number> · ${seconds(VOTE_MS)}. Closes early when everyone has voted.`,
    ].join("\n");
  }

  function runoffPromptText(session: Session): string {
    const tied = session.tied
      .map((id) => playerById(session, id))
      .filter((player): player is Player => Boolean(player));

    return [
      `🗳️ DAY ${session.round} — runoff`,
      `Tie: ${tied.map((player) => player.name).join(", ")}.`,
      "",
      ...rosterLines(tied),
      "",
      `${session.prefix}ww vote <number> · ${seconds(RUNOFF_MS)}.`,
    ].join("\n");
  }

  function voteReceiptText(target: Player): string {
    return `✅ Vote recorded: ${target.number}. ${target.name}.`;
  }

  function eliminatedText(
    player: Player,
    votes: number,
    round: number,
  ): string {
    return [
      `🚪 DAY ${round} — eliminated`,
      `${player.number}. ${player.name} was voted out.`,
      `Role: ${roleLabel(player.role ?? "VILLAGER")}`,
      `Votes: ${votes}`,
    ].join("\n");
  }

  function runoffTiedText(session: Session): string {
    return [
      `🗳️ DAY ${session.round} — runoff result`,
      "Still tied. Nobody is eliminated.",
    ].join("\n");
  }

  function noVotesText(session: Session): string {
    return [
      `🗳️ DAY ${session.round} — result`,
      "No valid votes. Nobody is eliminated.",
    ].join("\n");
  }

  function gameOverText(session: Session): string {
    const outcome = session.outcome;
    if (!outcome) return "🛑 Werewolf closed.";

    const headline =
      outcome.type === "WIN"
        ? outcome.team === "VILLAGE"
          ? "🏆 Village wins — every Werewolf is dead."
          : "🏆 Werewolves win — they equal or outnumber the village."
        : outcome.type === "DRAW"
          ? outcome.reason === "ROUND_LIMIT"
            ? `🤝 Draw — the ${MAX_ROUNDS}-day limit was reached.`
            : "🤝 Draw — nobody was left in the game."
          : `🛑 Werewolf cancelled (${outcome.reason}).`;

    const lines = ["GAME OVER", "", headline, "", "Roles:"];

    for (const player of session.players) {
      const how =
        player.status === "left"
          ? " (left)"
          : player.status === "dead"
            ? deathNote(session, player)
            : "";
      lines.push(
        `${player.number}. ${player.name} — ${roleLabel(player.role ?? "VILLAGER")}${how}`,
      );
    }

    lines.push("", `Days played: ${session.round}`);
    return lines.join("\n");
  }

  function deathNote(session: Session, player: Player): string {
    const record = [...session.deaths]
      .reverse()
      .find((entry) => entry.number === player.number);
    if (!record) return " (dead)";
    return record.cause === "NIGHT"
      ? ` (killed, night ${record.round})`
      : ` (voted, day ${record.round})`;
  }

  function statusText(session: Session): string {
    const where = session.phase === "LOBBY" ? "Lobby" : `Day ${session.round}`;
    const lines = [
      "🐺 WEREWOLF — status",
      `${where} · ${PHASE_LABEL[session.phase]} · ${remainingSeconds(session.deadline, now())}s left`,
      "",
      ...session.players.map((player) => {
        if (player.status === "dead") {
          return `${player.number}. ${player.name} — dead (${roleLabel(player.role ?? "VILLAGER")})`;
        }
        if (player.status === "left") {
          return `${player.number}. ${player.name} — left`;
        }
        return `${player.number}. ${player.name} — alive`;
      }),
    ];

    if (session.phase === "NIGHT_ACTIONS") {
      lines.push(
        "",
        `Actions: ${session.night.size}/${nightActors(session).length}`,
      );
    }

    if (session.phase === "DAY_VOTING" || session.phase === "DAY_RUNOFF") {
      lines.push(
        "",
        `Votes: ${session.votes.size}/${livingPlayers(session).length}`,
      );
    }

    return lines.join("\n");
  }

  // ---- phase steps ----

  function beginNight(session: Session, round: number): Promise<void> {
    session.round = round;
    setPhase(session, "NIGHT_ACTIONS");
    session.night.clear();
    session.votes.clear();
    session.tied = [];
    session.deadline = now() + NIGHT_MS;
    persist(session);
    arm(session);
    return sendPrompts(session);
  }

  async function sendPrompts(session: Session): Promise<void> {
    await sendText(session.groupJid, nightOpenText(session));

    for (const actor of nightActors(session)) {
      await sendText(actor.id, nightPromptText(actor, session));
    }

    // Everyone alive answered before the DMs opened: nothing can arrive later.
    if (allNightActorsActed(session)) await closeNight(session);
  }

  function freezeNight(session: Session): Map<string, string> {
    const frozen = new Map(session.night);
    session.night.clear();
    return frozen;
  }

  async function closeNight(session: Session): Promise<void> {
    setPhase(session, "NIGHT_RESOLUTION");
    clearTimer(session.groupJid);

    const intents = freezeNight(session);
    const attackTargetId = nightVictim(session, intents);
    const doctorId = findActor(intents, session, "DOCTOR");
    const protectionTargetId = doctorId
      ? (intents.get(doctorId) ?? null)
      : null;
    const seerId = findActor(intents, session, "SEER");

    if (seerId) {
      const targetId = intents.get(seerId);
      const target = targetId ? playerById(session, targetId) : undefined;
      const isWolf = Boolean(
        target?.role && FACTION[target.role] === "WEREWOLF",
      );
      if (target) {
        await sendText(seerId, seerResultText(target, isWolf, session.round));
      }
    } else {
      const livingSeer = livingPlayers(session).find(
        (player) => player.role === "SEER",
      );
      if (livingSeer) {
        await sendText(
          livingSeer.id,
          "🔮 No investigation was recorded this night.",
        );
      }
    }

    const died: Player[] = [];
    if (attackTargetId && attackTargetId !== protectionTargetId) {
      const victim = kill(session, attackTargetId, "NIGHT", session.round);
      if (victim) died.push(victim);
    }

    logToFile("WW_NIGHT_RESOLVED", {
      groupJid: session.groupJid,
      round: session.round,
      attackTargetId,
      protectionTargetId,
      deaths: died.map((player) => player.number),
    });

    const outcome = evaluateWin(session);
    if (outcome) {
      await finish(session, outcome);
      return;
    }

    setPhase(session, "DAWN");
    await sendText(session.groupJid, dawnText(session, died));
    await beginDiscussion(session);
  }

  function findActor(
    intents: ReadonlyMap<string, string>,
    session: Session,
    role: Role,
  ): string | undefined {
    for (const actorId of intents.keys()) {
      if (playerById(session, actorId)?.role === role) return actorId;
    }
    return undefined;
  }

  async function beginDiscussion(session: Session): Promise<void> {
    setPhase(session, "DAY_DISCUSSION");
    session.deadline = now() + DISCUSSION_MS;
    persist(session);
    arm(session);
    await sendText(session.groupJid, discussionPromptText(session));
  }

  async function closeDiscussion(session: Session): Promise<void> {
    setPhase(session, "DAY_VOTING");
    session.votes.clear();
    session.tied = [];
    session.deadline = now() + VOTE_MS;
    persist(session);
    arm(session);
    await sendText(session.groupJid, votePromptText(session));
  }

  async function closeVote(session: Session): Promise<void> {
    const runoff = session.phase === "DAY_RUNOFF";
    clearTimer(session.groupJid);

    const ballots = new Map(session.votes);
    session.votes.clear();

    const allowed = runoff ? new Set(session.tied) : undefined;
    const { counts, leaders } = tallyVotes(session, ballots, allowed);

    // A tie in the main vote opens the runoff without a resolution step: the
    // phase table only allows DAY_VOTING -> DAY_RUNOFF for that edge.
    if (!runoff && leaders.length > 1) {
      session.tied = leaders;
      setPhase(session, "DAY_RUNOFF");
      session.deadline = now() + RUNOFF_MS;
      persist(session);
      arm(session);
      await sendText(session.groupJid, runoffPromptText(session));
      return;
    }

    setPhase(session, "VOTE_RESOLUTION");

    if (counts.size === 0) {
      session.tied = [];
      await sendText(session.groupJid, noVotesText(session));
      await afterVote(session);
      return;
    }

    if (leaders.length !== 1) {
      session.tied = [];
      await sendText(session.groupJid, runoffTiedText(session));
      await afterVote(session);
      return;
    }

    const eliminatedId = leaders[0];
    const votes = eliminatedId ? (counts.get(eliminatedId) ?? 0) : 0;
    const eliminated = eliminatedId
      ? kill(session, eliminatedId, "VOTE", session.round)
      : null;

    logToFile("WW_VOTE_RESOLVED", {
      groupJid: session.groupJid,
      round: session.round,
      tally: [...counts.entries()].map(([id, count]) => [
        playerById(session, id)?.number ?? 0,
        count,
      ]),
      runoff,
      eliminatedId: eliminated?.id ?? null,
    });

    session.tied = [];
    if (eliminated) {
      await sendText(
        session.groupJid,
        eliminatedText(eliminated, votes, session.round),
      );
    }
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

    await beginNight(session, session.round + 1);
  }

  async function finish(session: Session, outcome: GameOutcome): Promise<void> {
    if (session.outcome) return;

    session.outcome = outcome;
    setPhase(session, "GAME_OVER");
    clearTimer(session.groupJid);
    const text = gameOverText(session);

    logToFile("WW_WIN", {
      groupJid: session.groupJid,
      type: outcome.type,
      team: outcome.type === "WIN" ? outcome.team : null,
    });

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
        case "NIGHT_ACTIONS":
          await closeNight(session);
          return;
        case "DAY_DISCUSSION":
          await closeDiscussion(session);
          return;
        case "DAY_VOTING":
        case "DAY_RUNOFF":
          await closeVote(session);
          return;
        default:
          clearTimer(groupJid);
      }
    });
  }

  // ---- commands ----

  async function join(input: CommandInput): Promise<string> {
    const groupJid = input.chatJid;
    const elsewhere = [...sessions.values()].find(
      (session) =>
        session.groupJid !== groupJid && findPlayer(session, input.senderJid),
    );
    if (elsewhere) return "🚩 You are already playing in another group.";

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
        night: new Map(),
        votes: new Map(),
        tied: [],
        deadline: now() + LOBBY_IDLE_MS,
        deaths: [],
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
      status: "alive",
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

    session.players = session.players.filter((entry) => entry.id !== player.id);
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
    if (!isHostOrAdmin(session, input)) {
      return "🚩 Only the host or a group admin can start.";
    }
    if (session.players.length < MIN_PLAYERS) {
      return `🚩 Need at least ${MIN_PLAYERS} players (${session.players.length}/${MAX_PLAYERS}).`;
    }

    const groupJid = session.groupJid;
    setPhase(session, "ROLE_ASSIGNMENT");
    assignRoles(session.players, random);
    clearTimer(groupJid);

    for (const player of session.players) {
      const delivered = await sendText(
        player.id,
        roleCardText(player, session),
      );
      if (!delivered) {
        forget(session);
        await sendText(
          groupJid,
          `🚩 Start cancelled: a role could not be sent to ${player.name} in DM. Fix DM access, then build a new lobby.`,
        );
        return null;
      }
    }

    persist(session);
    await sendText(
      groupJid,
      `🎮 WEREWOLF started with ${session.players.length} players. Your role is in your DM.`,
    );
    await beginNight(session, 1);

    return null;
  }

  async function act(
    input: CommandInput,
    targetNumber: number,
  ): Promise<string> {
    const session = sessions.get(input.chatJid);
    if (!session) return NO_GAME;
    if (session.phase !== "NIGHT_ACTIONS") return "🚩 Not a night phase.";
    if (now() > session.deadline) return "🚩 Time is up.";

    const player = findPlayer(session, input.senderJid);
    if (!player || player.status !== "alive") {
      return "🚩 You are out of the game.";
    }
    if (
      player.role !== "WEREWOLF" &&
      player.role !== "DOCTOR" &&
      player.role !== "SEER"
    ) {
      return "🚩 You have no night action.";
    }

    const target = playerByNumber(session, targetNumber);
    if (!target) return "🚩 Invalid player number.";
    if (target.status !== "alive") return "🚩 That player is out of the game.";
    if (
      player.role === "WEREWOLF" &&
      target.role !== undefined &&
      FACTION[target.role] === "WEREWOLF"
    ) {
      return "🚩 You cannot attack a Werewolf.";
    }

    const replaced = session.night.has(player.id);
    session.night.set(player.id, target.id);
    persist(session);

    await sendText(player.id, actReceiptText(player, target, replaced));

    if (allNightActorsActed(session)) await closeNight(session);

    return "";
  }

  async function vote(
    input: CommandInput,
    targetNumber: number,
  ): Promise<string> {
    const session = sessions.get(input.chatJid);
    if (!session) return noSession(input.prefix);
    if (session.phase !== "DAY_VOTING" && session.phase !== "DAY_RUNOFF") {
      return "🚩 Voting is not open.";
    }
    if (now() > session.deadline) return "🚩 Time is up.";

    const voter = findPlayer(session, input.senderJid);
    if (!voter || voter.status !== "alive") return NOT_IN_GAME;

    const target = playerByNumber(session, targetNumber);
    if (!target) return "🚩 Invalid player number.";
    if (target.id === voter.id) return "🚩 You cannot vote for yourself.";
    if (target.status !== "alive") return "🚩 That player is out of the game.";
    if (session.phase === "DAY_RUNOFF" && !session.tied.includes(target.id)) {
      return "🚩 You can only vote for candidates in the runoff.";
    }

    session.votes.set(voter.id, target.id);
    persist(session);

    if (allLivingVoted(session)) await closeVote(session);

    return voteReceiptText(target);
  }

  async function skip(input: CommandInput): Promise<string> {
    const session = sessions.get(input.chatJid);
    if (!session) return noSession(input.prefix);
    if (session.phase !== "DAY_DISCUSSION") {
      return "🚩 Nothing to skip right now.";
    }
    if (!isHostOrAdmin(session, input)) {
      return "🚩 Only the host or a group admin can skip.";
    }

    await closeDiscussion(session);
    return "";
  }

  async function status(input: CommandInput): Promise<string> {
    const session = sessions.get(input.chatJid);
    if (!session) return noSession(input.prefix);
    return statusText(session);
  }

  async function cancel(input: CommandInput): Promise<string | null> {
    const session = sessions.get(input.chatJid);
    if (!session) return noSession(input.prefix);
    if (!isHostOrAdmin(session, input)) {
      return "🚩 Only the host or a group admin can cancel.";
    }

    await finish(session, { type: "CANCELLED", reason: "cancelled by host" });
    return null;
  }

  async function depart(groupJid: string, playerId: string): Promise<void> {
    const session = sessions.get(groupJid);
    if (!session) return;

    const player = playerById(session, playerId);
    if (!player || player.status !== "alive") return;

    if (session.phase === "LOBBY") {
      session.players = session.players.filter(
        (entry) => entry.id !== player.id,
      );
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
      await sendText(groupJid, lobbyText(session));
      return;
    }

    player.status = "left";
    session.night.delete(player.id);
    session.votes.delete(player.id);

    if (session.hostId === player.id) {
      session.hostId = livingPlayers(session)[0]?.id ?? session.hostId;
    }

    persist(session);
    await sendText(groupJid, `🚪 ${player.name} left the game.`);

    const outcome = evaluateWin(session);
    if (outcome) {
      await finish(session, outcome);
      return;
    }

    if (session.phase === "NIGHT_ACTIONS" && allNightActorsActed(session)) {
      await closeNight(session);
      return;
    }

    if (
      (session.phase === "DAY_VOTING" || session.phase === "DAY_RUNOFF") &&
      session.votes.size > 0 &&
      allLivingVoted(session)
    ) {
      await closeVote(session);
    }
  }

  async function actFromDm(input: CommandInput, text: string): Promise<string> {
    const owner = [...sessions.values()].find((session) =>
      findPlayer(session, input.senderJid),
    );
    if (!owner) return NO_GAME;

    const number = parseNumber(text);
    if (number === null) {
      return text.trim() === ""
        ? `🚩 Usage: ${input.prefix}ww act <number>`
        : "🚩 Invalid player number.";
    }

    return queued(owner.groupJid, () =>
      act({ ...input, chatJid: owner.groupJid }, number),
    );
  }

  async function handle(input: CommandInput): Promise<string | null> {
    const [sub = "", ...rest] = input.args;
    const topic = sub.toLowerCase();
    const text = rest.join(" ");

    if (topic === "help") return helpText(input.prefix);

    if (topic === "act") {
      if (input.isGroup) return "🚩 Send your night action in a DM.";
      return actFromDm(input, text);
    }

    if (!input.isGroup) return GROUP_ONLY;

    if (topic === "") {
      const session = sessions.get(input.chatJid);
      return session ? statusText(session) : infoText(input.prefix);
    }

    if (
      topic !== "join" &&
      topic !== "leave" &&
      topic !== "start" &&
      topic !== "skip" &&
      topic !== "status" &&
      topic !== "cancel" &&
      topic !== "vote"
    ) {
      return `🚩 Unknown command: ${input.prefix}ww ${sub}\n\n${helpText(input.prefix)}`;
    }

    return queued(input.chatJid, async () => {
      switch (topic) {
        case "join":
          return join(input);
        case "leave":
          return leave(input);
        case "start":
          return start(input);
        case "skip":
          return skip(input);
        case "status":
          return status(input);
        case "cancel":
          return cancel(input);
        default: {
          const number = parseNumber(text);
          if (number === null) {
            return text.trim() === ""
              ? `🚩 Usage: ${input.prefix}ww vote <number>`
              : "🚩 Invalid player number.";
          }
          return vote(input, number);
        }
      }
    });
  }

  return {
    setSocket(next: WASocket): void {
      socket = next;
    },
    handle,
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
        console.error("Werewolf recovery read failed:", err);
        return;
      }

      for (const row of rows) {
        // A reopen is not a restart: a game still in memory keeps playing, and
        // its row is what makes the next real restart able to warn the group.
        if (sessions.has(row.groupJid)) continue;

        try {
          store().drop(row.groupJid);
        } catch (err) {
          console.error("Werewolf recovery drop failed:", err);
        }
        await sendText(
          row.groupJid,
          "🛑 The bot restarted, so this Werewolf game is closed. Build a new lobby with .ww join.",
        );
      }
    },
  };
}

export const werewolf = createWerewolf();
