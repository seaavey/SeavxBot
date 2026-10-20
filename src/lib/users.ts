import type { Database } from "bun:sqlite";

export type UserRole = "free" | "premium";

export interface UserIdentity {
  jid: string;
  lid?: string | null;
  name?: string | null;
}

export interface User {
  id: number;
  jid: string;
  lid: string | null;
  name: string | null;
  role: UserRole;
  premiumUntil: number | null;
  premiumSince: number | null;
  premiumGrantedBy: string | null;
  messageCount: number;
  commandCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface UserStore {
  touch(identity: UserIdentity, isCommand: boolean): void;
  ensure(identity: UserIdentity): void;
  ensureMany(identities: UserIdentity[]): void;
  get(jid: string): User | null;
  list(limit: number): User[];
  count(): number;
  grantPremium(jid: string, until: number | null, grantedBy: string): User;
  ensurePremium(jid: string, grantedBy: string): User;
  revokePremium(jid: string): User | null;
}

/** Lives here so the schema bootstrap in db.ts and the tests cannot drift. */
export const USERS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY,
  jid                TEXT NOT NULL UNIQUE,
  lid                TEXT UNIQUE,
  name               TEXT,
  role               TEXT NOT NULL DEFAULT 'free' CHECK (role IN ('free', 'premium')),
  premium_until      INTEGER,
  premium_since      INTEGER,
  premium_granted_by TEXT,
  message_count      INTEGER NOT NULL DEFAULT 0,
  command_count      INTEGER NOT NULL DEFAULT 0,
  first_seen_at      INTEGER NOT NULL,
  last_seen_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS users_role ON users(role);
CREATE INDEX IF NOT EXISTS users_premium_until ON users(premium_until);
`;

/** A NULL expiry on a premium row means permanent. */
export function isPremium(user: User, now = Date.now()): boolean {
  return (
    user.role === "premium" &&
    (user.premiumUntil === null || user.premiumUntil > now)
  );
}

interface UserRow {
  id: number;
  jid: string;
  lid: string | null;
  name: string | null;
  role: UserRole;
  premium_until: number | null;
  premium_since: number | null;
  premium_granted_by: string | null;
  message_count: number;
  command_count: number;
  first_seen_at: number;
  last_seen_at: number;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  jid: row.jid,
  lid: row.lid,
  name: row.name,
  role: row.role,
  premiumUntil: row.premium_until,
  premiumSince: row.premium_since,
  premiumGrantedBy: row.premium_granted_by,
  messageCount: row.message_count,
  commandCount: row.command_count,
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
});

export function createUserStore(db: Database): UserStore {
  const selectJid = db.query<UserRow, [string]>(
    "SELECT * FROM users WHERE jid = ?",
  );
  const selectLid = db.query<UserRow, [string]>(
    "SELECT * FROM users WHERE lid = ?",
  );
  const insert = db.query<
    unknown,
    [string, string | null, string | null, number, number, number, number]
  >(
    `INSERT INTO users
       (jid, lid, name, message_count, command_count, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const bump = db.query<
    unknown,
    [string | null, string | null, number, number, number]
  >(
    `UPDATE users SET
       lid = COALESCE(?, lid),
       name = COALESCE(?, name),
       message_count = message_count + 1,
       command_count = command_count + ?,
       last_seen_at = ?
     WHERE id = ?`,
  );
  const adoptJid = db.query<unknown, [string, number]>(
    "UPDATE users SET jid = ? WHERE id = ?",
  );
  const setIdentity = db.query<unknown, [string | null, string | null, number]>(
    "UPDATE users SET lid = COALESCE(?, lid), name = COALESCE(?, name) WHERE id = ?",
  );
  const grant = db.query<unknown, [number | null, number, string, number]>(
    `UPDATE users SET
       role = 'premium',
       premium_until = ?,
       premium_since = ?,
       premium_granted_by = ?
     WHERE id = ?`,
  );
  const revoke = db.query<unknown, [number]>(
    `UPDATE users SET
       role = 'free',
       premium_until = NULL,
       premium_since = NULL,
       premium_granted_by = NULL
     WHERE id = ?`,
  );
  const demoteExpired = db.query<unknown, [number]>(
    `UPDATE users SET
       role = 'free',
       premium_until = NULL,
       premium_since = NULL,
       premium_granted_by = NULL
     WHERE role = 'premium' AND premium_until IS NOT NULL AND premium_until <= ?`,
  );
  const listRecent = db.query<UserRow, [number]>(
    "SELECT * FROM users ORDER BY last_seen_at DESC LIMIT ?",
  );
  const countAll = db.query<{ n: number }, []>(
    "SELECT COUNT(*) AS n FROM users",
  );

  // One sweep per process; get() and list() cover rows that expire later.
  demoteExpired.run(Date.now());

  function get(jid: string): User | null {
    const row = selectJid.get(jid);
    if (!row) return null;

    if (
      row.role === "premium" &&
      row.premium_until !== null &&
      row.premium_until <= Date.now()
    ) {
      revoke.run(row.id);
      return toUser({
        ...row,
        role: "free",
        premium_until: null,
        premium_since: null,
        premium_granted_by: null,
      });
    }

    return toUser(row);
  }

  function ensure(identity: UserIdentity): void {
    // A sender JID falls back to the chat JID when WhatsApp omits the
    // participant; a group must never become a user row.
    if (identity.jid.endsWith("@g.us")) return;

    const lid = identity.lid || null;
    const name = identity.name || null;
    const now = Date.now();
    const seen =
      selectJid.get(identity.jid) ?? (lid ? selectLid.get(lid) : null);

    if (!seen) {
      insert.run(identity.jid, lid, name, 0, 0, now, now);
      return;
    }

    if (seen.jid !== identity.jid) adoptJid.run(identity.jid, seen.id);
    setIdentity.run(lid, name, seen.id);
  }

  // A group sync seeds every member at once; one transaction keeps it fast.
  function ensureMany(identities: UserIdentity[]): void {
    db.transaction(() => {
      for (const identity of identities) ensure(identity);
    })();
  }

  function touch(identity: UserIdentity, isCommand: boolean): void {
    // A sender JID falls back to the chat JID when WhatsApp omits the
    // participant; a group must never become a user row.
    if (identity.jid.endsWith("@g.us")) return;

    const now = Date.now();
    const lid = identity.lid || null;
    const name = identity.name || null;
    // A LID-first row adopts the PN the first time WhatsApp exposes it, so one
    // person never splits into two rows with two sets of counters.
    const seen =
      selectJid.get(identity.jid) ?? (lid ? selectLid.get(lid) : null);

    if (!seen) {
      insert.run(identity.jid, lid, name, 1, isCommand ? 1 : 0, now, now);
      return;
    }

    if (seen.jid !== identity.jid) adoptJid.run(identity.jid, seen.id);
    bump.run(lid, name, isCommand ? 1 : 0, now, seen.id);
  }

  function grantPremium(
    jid: string,
    until: number | null,
    grantedBy: string,
  ): User {
    const now = Date.now();
    let row = selectJid.get(jid);

    // An owner may grant before the user ever messages the bot.
    if (!row) {
      insert.run(jid, null, null, 0, 0, now, now);
      row = selectJid.get(jid)!;
    }

    grant.run(until, now, grantedBy, row.id);

    return toUser({
      ...row,
      role: "premium",
      premium_until: until,
      premium_since: now,
      premium_granted_by: grantedBy,
    });
  }

  /** Owners are premium by definition; a permanent grant is never rewritten. */
  function ensurePremium(jid: string, grantedBy: string): User {
    const row = selectJid.get(jid);
    if (row?.role === "premium" && row.premium_until === null) {
      return toUser(row);
    }
    return grantPremium(jid, null, grantedBy);
  }

  function revokePremium(jid: string): User | null {
    const row = selectJid.get(jid);
    if (!row) return null;

    revoke.run(row.id);

    return toUser({
      ...row,
      role: "free",
      premium_until: null,
      premium_since: null,
      premium_granted_by: null,
    });
  }

  function list(limit: number): User[] {
    // Expiry can pass while the process runs; a list must not show stale premium.
    demoteExpired.run(Date.now());
    return listRecent.all(limit).map(toUser);
  }

  function count(): number {
    return countAll.get()?.n ?? 0;
  }

  return {
    touch,
    ensure,
    ensureMany,
    get,
    list,
    count,
    grantPremium,
    ensurePremium,
    revokePremium,
  };
}
