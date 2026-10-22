/** Undercover's domain shapes, role distribution and win evaluation. Pure. */

export type Role = "CIVILIAN" | "UNDERCOVER" | "MR_WHITE";

export type PlayerStatus = "active" | "eliminated" | "departed";

export type Phase =
  | "LOBBY"
  | "ROLE_ASSIGNMENT"
  | "CLUE_PHASE"
  | "VOTING_PHASE"
  | "REVOTE_PHASE"
  | "MR_WHITE_GUESS"
  | "GAME_OVER";

export interface Player {
  /** `pn || lid`: the DM target and the session key. */
  id: string;
  pn: string;
  lid: string;
  /** pushName at join, or labelFor of the player's jid when WhatsApp sent none. */
  name: string;
  /** Lobby numbering, 1..N and positional; frozen once the game starts. */
  number: number;
  role?: Role;
  status: PlayerStatus;
  eliminatedRound?: number;
  votesReceived?: number;
}

export interface Ballot {
  /** The poll's own message id, the `pollMsgId` the vote is decrypted with. */
  messageId: string;
  /** The 32 bytes handed to `sendMessage`; without them a vote cannot be read. */
  secret: Uint8Array;
  options: { hash: string; playerId: string }[];
  /** voterId -> targetId; the first accepted vote is final. */
  votes: Map<string, string>;
}

export interface Session {
  id: string;
  groupJid: string;
  /** The prefix this lobby was built with; every hint quotes the caller's own. */
  prefix: string;
  hostId: string;
  phase: Phase;
  round: number;
  players: Player[];
  /** Display forms, shown only at game over. */
  words?: { civilian: string; undercover: string };
  /** Comparison forms; never sent anywhere. */
  canonical?: { civilian: string; undercover: string };
  turnOrder: string[];
  turn: number;
  clues: { playerId: string; text: string; round: number }[];
  ballot?: Ballot;
  revoted: boolean;
  tied: string[];
  guess?: { playerId: string; deadline: number; attemptUsed: boolean };
  /** How the guess ended, for the game-over summary. */
  guessResult?: "CORRECT" | "WRONG" | "TIMEOUT" | "FORFEIT";
  deadline: number;
  eliminations: { number: number; name: string; role: Role; votes: number }[];
  outcome?: GameOutcome;
}

export type GameOutcome =
  | { type: "WIN"; team: "CIVILIAN" | "UNDERCOVER" | "MR_WHITE" }
  | { type: "DRAW"; reason: "ROUND_LIMIT" | "NO_ACTIVE_PLAYERS" }
  | { type: "CANCELLED"; reason: string }
  | { type: "ERROR"; reason: string };

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 12;
export const MAX_CLUE_WORDS = 3;
export const MAX_GUESS_CODE_POINTS = 100;
export const MAX_ROUNDS = 10;
export const CLUE_MS = 30_000;
export const VOTE_MS = 45_000;
export const REVOTE_MS = 20_000;
export const GUESS_MS = 30_000;
export const LOBBY_IDLE_MS = 600_000;

export function activePlayers(session: Session): Player[] {
  return session.players.filter((player) => player.status === "active");
}

export function countRole(session: Session, role: Role): number {
  return activePlayers(session).filter((player) => player.role === role).length;
}

/**
 * The single source of truth for the role table. Throws instead of guessing:
 * an out-of-range count is a bug in the caller, not a game state.
 */
export function getRoleCounts(playerCount: number): {
  civilian: number;
  undercover: number;
  mrWhite: number;
} {
  if (
    !Number.isInteger(playerCount) ||
    playerCount < MIN_PLAYERS ||
    playerCount > MAX_PLAYERS
  ) {
    throw new Error(
      `player count must be an integer in ${MIN_PLAYERS}..${MAX_PLAYERS}`,
    );
  }

  const undercover = Math.floor((playerCount - 1) / 3);
  const mrWhite = 1;
  const civilian = playerCount - undercover - mrWhite;

  if (
    civilian + undercover + mrWhite !== playerCount ||
    undercover < 1 ||
    mrWhite !== 1 ||
    civilian < 1
  ) {
    throw new Error("role distribution invariant failed");
  }

  return { civilian, undercover, mrWhite };
}

/** Fisher–Yates over the role multiset; writes nothing until it is coherent. */
export function assignRoles(players: Player[], random: () => number): void {
  const { civilian, undercover, mrWhite } = getRoleCounts(players.length);

  const roles: Role[] = [
    ...new Array<Role>(civilian).fill("CIVILIAN"),
    ...new Array<Role>(undercover).fill("UNDERCOVER"),
    ...new Array<Role>(mrWhite).fill("MR_WHITE"),
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

  if (roles.filter((role) => role === "MR_WHITE").length !== mrWhite) {
    throw new Error("role shuffle broke the Mr. White invariant");
  }

  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const role = roles[index];
    if (!player || !role) throw new Error("role assignment lost a player");
    player.role = role;
  }
}

/**
 * The one win check. Mr. White counts as neither team, and a pending guess is
 * never overtaken by it: the phase machine only reaches this after the guess
 * phase has resolved.
 */
export function evaluateWin(session: Session): GameOutcome | null {
  const activeCivilian = countRole(session, "CIVILIAN");
  const activeUndercover = countRole(session, "UNDERCOVER");
  const activeMrWhite = countRole(session, "MR_WHITE");

  if (activeCivilian + activeUndercover + activeMrWhite === 0) {
    return { type: "DRAW", reason: "NO_ACTIVE_PLAYERS" };
  }

  if (activeCivilian > 0 && activeUndercover === 0 && activeMrWhite === 0) {
    return { type: "WIN", team: "CIVILIAN" };
  }

  if (activeUndercover > 0 && activeUndercover >= activeCivilian) {
    return { type: "WIN", team: "UNDERCOVER" };
  }

  return null;
}
