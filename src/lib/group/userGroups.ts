import type { Database } from "bun:sqlite";

export const USER_GROUPS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS user_groups (
  user_jid  TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  PRIMARY KEY (user_jid, group_jid)
) WITHOUT ROWID;
`;

export function createUserGroupsStore(db: Database) {
  db.exec(USER_GROUPS_TABLE_SQL);

  const count = db.query<{ n: number }, [string]>(
    "SELECT COUNT(*) AS n FROM user_groups WHERE user_jid = ?",
  );
  const add = db.query<unknown, [string, string]>(
    `INSERT INTO user_groups (user_jid, group_jid) VALUES (?, ?)
     ON CONFLICT(user_jid, group_jid) DO NOTHING`,
  );
  const has = db.query<{ n: number }, [string, string]>(
    "SELECT COUNT(*) AS n FROM user_groups WHERE user_jid = ? AND group_jid = ?",
  );

  return {
    count: (userJid: string): number => count.get(userJid)?.n ?? 0,
    add: (userJid: string, groupJid: string): void => {
      add.run(userJid, groupJid);
    },
    has: (userJid: string, groupJid: string): boolean =>
      (has.get(userJid, groupJid)?.n ?? 0) > 0,
  };
}

export type UserGroupsStore = ReturnType<typeof createUserGroupsStore>;
