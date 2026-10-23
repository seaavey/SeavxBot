import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  databasePath,
  settingsDefaults,
  stickerDefaults,
} from "@/lib/core/config";
import {
  SETTINGS_TABLE_SQL,
  createSettingsStore,
  type SettingsStore,
} from "@/lib/group/settings";
import {
  BOT_SETTINGS_TABLE_SQL,
  createStickerPackStore,
  type StickerPackStore,
} from "@/lib/media/stickerPack";
import {
  UNDERCOVER_TABLE_SQL,
  createUndercoverStore,
  type UndercoverStore,
} from "@/lib/games/undercover/store";
import {
  WEREWOLF_TABLE_SQL,
  createWerewolfStore,
  type WerewolfStore,
} from "@/lib/games/werewolf/store";
import {
  USERS_TABLE_SQL,
  createUserStore,
  type UserStore,
} from "@/lib/user/users";
import {
  WARNINGS_TABLE_SQL,
  createWarningsStore,
  type WarningsStore,
} from "@/lib/group/warnings";
import {
  USER_GROUPS_TABLE_SQL,
  createUserGroupsStore,
  type UserGroupsStore,
} from "@/lib/group/userGroups";

const SCHEMA_VERSION = 7;

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
    if (version < 3) db.exec(BOT_SETTINGS_TABLE_SQL);
    if (version < 4) db.exec(UNDERCOVER_TABLE_SQL);
    if (version < 5) db.exec(WEREWOLF_TABLE_SQL);
    if (version < 6) db.exec(WARNINGS_TABLE_SQL);
    if (version < 7) db.exec(USER_GROUPS_TABLE_SQL);
    // A literal: PRAGMA does not accept bound parameters.
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  })();
}

function openDatabase(file: string): Database {
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
let stickerPack: StickerPackStore | undefined;
let undercover: UndercoverStore | undefined;
let werewolf: WerewolfStore | undefined;
let warnings: WarningsStore | undefined;
let userGroups: UserGroupsStore | undefined;

/** Opened on first use so importing this module never touches the disk. */
function getDb(): Database {
  handle ??= openDatabase(databasePath);
  return handle;
}

export function getGroupSettings(jid: string): SettingsStore {
  store ??= createSettingsStore(getDb(), settingsDefaults);
  return store;
}

export function getStickerPack(): StickerPackStore {
  stickerPack ??= createStickerPackStore(getDb(), stickerDefaults);
  return stickerPack;
}

export function getUsers(): UserStore {
  users ??= createUserStore(getDb());
  return users;
}

export function getUndercover(): UndercoverStore {
  undercover ??= createUndercoverStore(getDb());
  return undercover;
}

export function getWerewolf(): WerewolfStore {
  werewolf ??= createWerewolfStore(getDb());
  return werewolf;
}

export function getWarnings(jid: string): WarningsStore {
  warnings ??= createWarningsStore(getDb());
  return warnings;
}

export function getUserGroups(): UserGroupsStore {
  userGroups ??= createUserGroupsStore(getDb());
  return userGroups;
}
