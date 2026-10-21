/**
 * The single reader of the environment: `config.toml` and `SEAVXBOT_DB_PATH`
 * are read here and nowhere else. Every other module imports the resolved
 * values below, never the raw object. The shape and its validation live in
 * `configSchema.ts`, which has no file access and is therefore testable.
 */
import { parseConfig } from "@/lib/core/configSchema";

let raw: unknown;
try {
  raw = (await import("../../../config.toml")).default;
} catch {
  throw new Error(
    "Missing config.toml — copy config.example.toml to config.toml and set your owner numbers.",
  );
}

const cfg = parseConfig(raw);

export const botName = cfg.bot_name;
export const prefixes = cfg.prefixes;
export const ownerNumbers = cfg.owners;
export const logLevel = cfg.logging.level;
export const readMessages = Boolean(cfg.features?.read_message);

export const authOptions = {
  dir: cfg.auth.dir,
  defaultMethod: cfg.auth.default_method,
  phoneNumber: cfg.auth.phone_number,
};

/** The env override keeps tests and one-off scripts off the live database. */
export const databasePath =
  process.env.SEAVXBOT_DB_PATH || cfg.storage?.path || "data/seavxbot.db";

/** The text a guard refusal shows when the config does not override it. */
export const guardMessages = {
  ownerOnly: cfg.messages?.owner_only || "🚩 Owner access required.",
  adminOnly: cfg.messages?.admin_only || "🚩 Group admin required.",
  groupOnly: cfg.messages?.group_only || "🚩 Group chat required.",
  botAdminOnly:
    cfg.messages?.bot_admin_only || "🚩 Bot admin privileges required.",
  error: cfg.messages?.error || "🚩 Command execution failed.",
};

export const stickerDefaults = {
  pack: cfg.sticker?.pack || botName,
  author: cfg.sticker?.author || botName,
};

/** The templates a group falls back to when it has none of its own. */
export const settingsDefaults = {
  welcome_text: cfg.messages?.welcome_text || "Welcome {mention} to *{group}*!",
  goodbye_text: cfg.messages?.goodbye_text || "Goodbye {name}.",
};
