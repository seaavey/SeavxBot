import type { Database } from "bun:sqlite";

export const UNDERCOVER_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS undercover_sessions (
  group_jid  TEXT PRIMARY KEY,
  host_jid   TEXT NOT NULL,
  state      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS undercover_last_pair (
  group_jid TEXT PRIMARY KEY,
  pair_id   TEXT NOT NULL
) WITHOUT ROWID;
`;

export function createUndercoverStore(db: Database) {
  const saveStatement = db.query<unknown, [string, string, string, number]>(
    `INSERT INTO undercover_sessions (group_jid, host_jid, state, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(group_jid) DO UPDATE SET
       host_jid = excluded.host_jid,
       state = excluded.state,
       updated_at = excluded.updated_at`,
  );
  const listLiveStatement = db.query<
    { group_jid: string; host_jid: string },
    []
  >("SELECT group_jid, host_jid FROM undercover_sessions");
  const dropStatement = db.query<unknown, [string]>(
    "DELETE FROM undercover_sessions WHERE group_jid = ?",
  );
  const lastPairStatement = db.query<{ pair_id: string }, [string]>(
    "SELECT pair_id FROM undercover_last_pair WHERE group_jid = ?",
  );
  const setLastPairStatement = db.query<unknown, [string, string]>(
    `INSERT INTO undercover_last_pair (group_jid, pair_id)
     VALUES (?, ?)
     ON CONFLICT(group_jid) DO UPDATE SET pair_id = excluded.pair_id`,
  );

  function save(groupJid: string, hostJid: string, state: string): void {
    saveStatement.run(groupJid, hostJid, state, Date.now());
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

  function lastPair(groupJid: string): string | null {
    return lastPairStatement.get(groupJid)?.pair_id ?? null;
  }

  function setLastPair(groupJid: string, pairId: string): void {
    setLastPairStatement.run(groupJid, pairId);
  }

  return { save, listLive, drop, lastPair, setLastPair };
}

export type UndercoverStore = ReturnType<typeof createUndercoverStore>;
