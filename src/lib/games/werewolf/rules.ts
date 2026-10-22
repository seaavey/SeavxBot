/** Werewolf's domain shapes, role table, win check and the one death path. Pure. */

export type Faction = "VILLAGE" | "WEREWOLF";

export type Role = "WEREWOLF" | "VILLAGER" | "SEER" | "DOCTOR";

export type PlayerStatus = "alive" | "dead" | "left";

export type DeathCause = "NIGHT" | "VOTE";

export type Phase =
  | "LOBBY"
  | "ROLE_ASSIGNMENT"
  | "NIGHT_ACTIONS"
  | "NIGHT_RESOLUTION"
  | "DAWN"
  | "DAY_DISCUSSION"
  | "DAY_VOTING"
  | "DAY_RUNOFF"
  | "VOTE_RESOLUTION"
  | "GAME_OVER";

export const FACTION: Record<Role, Faction> = {
  WEREWOLF: "WEREWOLF",
  VILLAGER: "VILLAGE",
  SEER: "VILLAGE",
  DOCTOR: "VILLAGE",
};

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 12;
export const MAX_ROUNDS = 10;
export const NIGHT_MS = 90_000;
export const DISCUSSION_MS = 120_000;
export const VOTE_MS = 60_000;
export const RUNOFF_MS = 30_000;
export const LOBBY_IDLE_MS = 600_000;

export interface Player {
  /** `pn || lid || senderJid`: the DM target and the session key. */
  id: string;
  pn: string;
  lid: string;
  /** pushName at join, or labelFor of the sender's jid when WhatsApp sent none. */
  name: string;
  /** Lobby numbering 1..N and positional; frozen once the game starts. */
  number: number;
  role?: Role;
  status: PlayerStatus;
}

export interface Death {
  number: number;
  name: string;
  role: Role;
  cause: DeathCause;
  round: number;
}

export type GameOutcome =
  | { type: "WIN"; team: Faction }
  | { type: "DRAW"; reason: "ROUND_LIMIT" | "NO_LIVING" }
  | { type: "CANCELLED"; reason: string };

export interface Session {
  id: string;
  groupJid: string;
  /** The prefix this lobby was built with; every engine hint quotes it. */
  prefix: string;
  hostId: string;
  phase: Phase;
  /** 1-based day number: night 1 resolves into day 1. */
  round: number;
  players: Player[];
  /** actorId -> targetId for the current night; cleared at the freeze. */
  night: Map<string, string>;
  /** voterId -> targetId for the current day vote; the newest write wins. */
  votes: Map<string, string>;
  tied: string[];
  deadline: number;
  deaths: Death[];
  outcome?: GameOutcome;
}

interface Composition {
  werewolf: number;
  seer: number;
  doctor: number;
  villager: number;
}

/** The single source of truth for the role table, 5..12 players. */
const COMPOSITION: Record<number, Composition> = {
  5: { werewolf: 1, seer: 1, doctor: 1, villager: 2 },
  6: { werewolf: 2, seer: 1, doctor: 1, villager: 2 },
  7: { werewolf: 2, seer: 1, doctor: 1, villager: 3 },
  8: { werewolf: 2, seer: 1, doctor: 1, villager: 4 },
  9: { werewolf: 3, seer: 1, doctor: 1, villager: 4 },
  10: { werewolf: 3, seer: 1, doctor: 1, villager: 5 },
  11: { werewolf: 3, seer: 1, doctor: 1, villager: 6 },
  12: { werewolf: 4, seer: 1, doctor: 1, villager: 6 },
};

/**
 * Throws instead of guessing: an out-of-range count is a caller bug, not a game
 * state (the contract `undercover/rules.ts` already uses for its own table).
 */
export function getComposition(playerCount: number): Composition {
  const row = COMPOSITION[playerCount];
  if (!row) {
    throw new Error(
      `player count must be an integer in ${MIN_PLAYERS}..${MAX_PLAYERS}`,
    );
  }

  const village = row.seer + row.doctor + row.villager;
  if (row.werewolf < 1) throw new Error("a game needs at least one Werewolf");
  if (village < row.werewolf + 1) {
    throw new Error("the village must start ahead of parity");
  }
  if (row.werewolf + village !== playerCount) {
    throw new Error("the role table does not sum to the roster");
  }

  return { ...row };
}

/** Fisher–Yates over the exact role multiset; writes nothing until it is coherent. */
export function assignRoles(players: Player[], random: () => number): void {
  const { werewolf, seer, doctor, villager } = getComposition(players.length);

  const roles: Role[] = [
    ...new Array<Role>(werewolf).fill("WEREWOLF"),
    ...new Array<Role>(seer).fill("SEER"),
    ...new Array<Role>(doctor).fill("DOCTOR"),
    ...new Array<Role>(villager).fill("VILLAGER"),
  ];

  if (roles.length !== players.length) {
    throw new Error("role multiset does not match the roster");
  }

  for (let index = roles.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = roles[index];
    const chosen = roles[swap];
    if (!current || !chosen) throw new Error("role shuffle left a hole");
    roles[index] = chosen;
    roles[swap] = current;
  }

  for (const [index, player] of players.entries()) {
    const role = roles[index];
    if (!role) throw new Error("role assignment lost a player");
    player.role = role;
  }
}

export function livingPlayers(session: Session): Player[] {
  return session.players.filter((player) => player.status === "alive");
}

export function countLiving(session: Session): {
  werewolf: number;
  village: number;
} {
  let werewolf = 0;
  let village = 0;

  for (const player of livingPlayers(session)) {
    if (player.role && FACTION[player.role] === "WEREWOLF") werewolf += 1;
    else village += 1;
  }

  return { werewolf, village };
}

function playerById(session: Session, id: string): Player | undefined {
  return session.players.find((player) => player.id === id);
}

/** The id with a strictly highest count, or null on a tie or an empty tally. */
function uniqueLeader(counts: ReadonlyMap<string, number>): string | null {
  let top = 0;
  let leader: string | null = null;
  let tied = false;

  for (const [id, count] of counts) {
    if (count > top) {
      top = count;
      leader = id;
      tied = false;
    } else if (count === top) {
      tied = true;
    }
  }

  return tied ? null : leader;
}

/**
 * The werewolves' attack: living pack votes over living non-werewolves only. A
 * tie at the top and an empty tally both mean no attack.
 */
export function nightVictim(
  session: Session,
  votes: ReadonlyMap<string, string>,
): string | null {
  const counts = new Map<string, number>();

  for (const [actorId, targetId] of votes) {
    const actor = playerById(session, actorId);
    const target = playerById(session, targetId);
    if (actor?.status !== "alive") continue;
    if (!actor.role || FACTION[actor.role] !== "WEREWOLF") continue;
    if (target?.status !== "alive") continue;
    if (!target.role || FACTION[target.role] === "WEREWOLF") continue;
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }

  return uniqueLeader(counts);
}

/**
 * The day tally: only a living voter's vote for a living target counts, and only
 * inside `allowed` when the runoff narrows the field.
 */
export function tallyVotes(
  session: Session,
  votes: ReadonlyMap<string, string>,
  allowed?: ReadonlySet<string>,
): { counts: Map<string, number>; leaders: string[] } {
  const counts = new Map<string, number>();

  for (const [voterId, targetId] of votes) {
    const voter = playerById(session, voterId);
    const target = playerById(session, targetId);
    if (voter?.status !== "alive") continue;
    if (target?.status !== "alive") continue;
    if (allowed && !allowed.has(target.id)) continue;
    counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
  }

  const top = Math.max(0, ...counts.values());
  const leaders = [...counts.entries()]
    .filter(([, count]) => count === top && count > 0)
    .map(([id]) => id);

  return { counts, leaders };
}

/** The one win check; call it only once every effect of the phase is applied. */
export function evaluateWin(session: Session): GameOutcome | null {
  if (livingPlayers(session).length === 0) {
    return { type: "DRAW", reason: "NO_LIVING" };
  }

  const { werewolf, village } = countLiving(session);

  if (werewolf === 0 && village > 0) return { type: "WIN", team: "VILLAGE" };
  if (werewolf > 0 && werewolf >= village) {
    return { type: "WIN", team: "WEREWOLF" };
  }

  return null;
}

/**
 * The only way a player dies: refuses a player who is not alive, so a repeated
 * resolution cannot record the same death twice.
 */
export function kill(
  session: Session,
  playerId: string,
  cause: DeathCause,
  round: number,
): Player | null {
  const player = playerById(session, playerId);
  if (!player || player.status !== "alive" || !player.role) return null;

  player.status = "dead";
  session.deaths.push({
    number: player.number,
    name: player.name,
    role: player.role,
    cause,
    round,
  });

  return player;
}
