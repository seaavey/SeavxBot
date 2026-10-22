import type { Database } from "bun:sqlite";

export const WEREWOLF_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS werewolf_sessions (
  group_jid  TEXT PRIMARY KEY,
  host_jid   TEXT NOT NULL,
  phase      TEXT NOT NULL,
  round      INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
`;

export function createWerewolfStore(db: Database) {
  const saveStatement = db.query<
    unknown,
    [string, string, string, number, number]
  >(
    `INSERT INTO werewolf_sessions (group_jid, host_jid, phase, round, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(group_jid) DO UPDATE SET
       host_jid = excluded.host_jid,
       phase = excluded.phase,
       round = excluded.round,
       updated_at = excluded.updated_at`,
  );
  const listLiveStatement = db.query<
    { group_jid: string; host_jid: string },
    []
  >("SELECT group_jid, host_jid FROM werewolf_sessions");
  const dropStatement = db.query<unknown, [string]>(
    "DELETE FROM werewolf_sessions WHERE group_jid = ?",
  );

  function save(
    groupJid: string,
    hostJid: string,
    phase: string,
    round: number,
  ): void {
    saveStatement.run(groupJid, hostJid, phase, round, Date.now());
  }

  function listLive(): { groupJid: string; hostJid: string }[] {
    return listLiveStatement.all().map(({ group_jid, host_jid }) => ({
      groupJid: group_jid,
      hostJid: host_jid,
    }));
  }

  function drop(groupJid: string): void {
    dropStatement.run(groupJid);
  }

  return { save, listLive, drop };
}

export type WerewolfStore = ReturnType<typeof createWerewolfStore>;
