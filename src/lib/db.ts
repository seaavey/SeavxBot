import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { databasePath, settingsDefaults } from "@/lib/config";
import {
  SETTINGS_TABLE_SQL,
  createSettingsStore,
  type SettingsStore,
} from "@/lib/settings";
import { USERS_TABLE_SQL, createUserStore, type UserStore } from "@/lib/users";

const SCHEMA_VERSION = 2;

/**
 * SQLite's own `user_version` doubles as the migration cursor, so there is no
 * bookkeeping table to keep in sync with the schema it describes.
 */
function migrate(db: Database): void {
  const row = db
    .query<{ user_version: number }, []>("PRAGMA user_version")
    .get();
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;

  db.transaction(() => {
    if (version < 1) db.exec(SETTINGS_TABLE_SQL);
    if (version < 2) db.exec(USERS_TABLE_SQL);
    // A literal: PRAGMA does not accept bound parameters.
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  })();
}

export function openDatabase(file: string): Database {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  // WAL keeps a slow reader from blocking the write that a command just made.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  migrate(db);
  return db;
}

let handle: Database | undefined;
let store: SettingsStore | undefined;
let users: UserStore | undefined;

/** Opened on first use so importing this module never touches the disk. */
export function getDb(): Database {
  handle ??= openDatabase(databasePath);
  return handle;
}

export function getGroupSettings(): SettingsStore {
  store ??= createSettingsStore(getDb(), settingsDefaults);
  return store;
}

export function getUsers(): UserStore {
  users ??= createUserStore(getDb());
  return users;
}
