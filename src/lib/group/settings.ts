import type { Database } from "bun:sqlite";

export type AntilinkMode = "off" | "warn" | "delete";

export interface GroupSettings {
  welcome: boolean;
  welcome_text: string;
  goodbye: boolean;
  goodbye_text: string;
  antilink: AntilinkMode;
  warn_limit: number;
}

/** The two values that come from config.toml instead of being fixed. */
export interface SettingsDefaults {
  welcome_text: string;
  goodbye_text: string;
}

/** Lives here so the schema bootstrap in db.ts and the tests cannot drift. */
export const SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS group_settings (
  jid   TEXT NOT NULL,
  key   TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (jid, key)
) WITHOUT ROWID;
`;

export const ANTILINK_MODES: readonly AntilinkMode[] = [
  "off",
  "warn",
  "delete",
];

const DEFAULT_SETTINGS: Pick<
  GroupSettings,
  "welcome" | "goodbye" | "antilink" | "warn_limit"
> = {
  welcome: false,
  goodbye: false,
  antilink: "off",
  warn_limit: 3,
};

/**
 * One guard per field. A stored value that fails its guard is treated as
 * absent: a hand-edited row, or one written by a version that knew a different
 * set of settings, must not brick a group's configuration.
 */
const GUARDS: Record<keyof GroupSettings, (value: unknown) => boolean> = {
  welcome: (value) => typeof value === "boolean",
  welcome_text: (value) => typeof value === "string",
  goodbye: (value) => typeof value === "boolean",
  goodbye_text: (value) => typeof value === "string",
  antilink: (value) => ANTILINK_MODES.includes(value as AntilinkMode),
  warn_limit: (value) =>
    typeof value === "number" && Number.isInteger(value) && value > 0,
};

export function createSettingsStore(db: Database, defaults: SettingsDefaults) {
  const base: GroupSettings = { ...DEFAULT_SETTINGS, ...defaults };
  const cache = new Map<string, GroupSettings>();

  const select = db.query<{ key: string; value: string }, [string]>(
    "SELECT key, value FROM group_settings WHERE jid = ?",
  );
  const upsert = db.query<unknown, [string, string, string]>(
    `INSERT INTO group_settings (jid, key, value) VALUES (?, ?, ?)
     ON CONFLICT(jid, key) DO UPDATE SET value = excluded.value`,
  );

  function get(jid: string): GroupSettings {
    const hit = cache.get(jid);
    // Copies go out so a caller mutating the result cannot corrupt the cache
    // behind set()'s back.
    if (hit) return { ...hit };

    const settings: GroupSettings = { ...base };

    for (const row of select.all(jid)) {
      const key = row.key as keyof GroupSettings;
      const guard = GUARDS[key];
      if (!guard) continue; // a key this version does not know

      let parsed: unknown;
      try {
        parsed = JSON.parse(row.value);
      } catch {
        continue;
      }

      if (guard(parsed)) Object.assign(settings, { [key]: parsed });
    }

    cache.set(jid, settings);
    return { ...settings };
  }

  function set<K extends keyof GroupSettings>(
    jid: string,
    key: K,
    value: GroupSettings[K],
  ): void {
    upsert.run(jid, key, JSON.stringify(value));
    // Loads the group first: rows written by an earlier process must survive a
    // write that only touches one key.
    const next = get(jid);
    next[key] = value;
    cache.set(jid, next);
  }

  return { get, set };
}

/** The store the factory returns; no separate interface to keep in sync. */
export type SettingsStore = ReturnType<typeof createSettingsStore>;
