import type { Database } from "bun:sqlite";

export const WARNINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS warnings (
  jid      TEXT NOT NULL,
  user_jid TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (jid, user_jid)
) WITHOUT ROWID;
`;

export function createWarningsStore(db: Database) {
  db.exec(WARNINGS_TABLE_SQL);
  const select = db.query<{ count: number }, [string, string]>(
    "SELECT count FROM warnings WHERE jid = ? AND user_jid = ?",
  );
  const upsert = db.query<unknown, [string, string, number]>(
    `INSERT INTO warnings (jid, user_jid, count) VALUES (?, ?, ?)
     ON CONFLICT(jid, user_jid) DO UPDATE SET count = excluded.count`,
  );
  const remove = db.query<unknown, [string, string]>(
    "DELETE FROM warnings WHERE jid = ? AND user_jid = ?",
  );

  function get(jid: string, userJid: string): number {
    const row = select.get(jid, userJid);
    return row?.count ?? 0;
  }

  function increment(jid: string, userJid: string): number {
    const next = get(jid, userJid) + 1;
    upsert.run(jid, userJid, next);
    return next;
  }

  function reset(jid: string, userJid: string): void {
    remove.run(jid, userJid);
  }

  return { get, increment, reset };
}

export type WarningsStore = ReturnType<typeof createWarningsStore>;
